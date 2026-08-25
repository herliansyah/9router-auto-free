#!/usr/bin/env node

/**
 * Free Models Sync for 9router
 * (OpenAgentic.id + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama Cloud + API.airforce + Bazaarlink + Groq + Cerebras + Mistral + Cloudflare AI + NVIDIA NIM + 9router OpenCode Free)
 *
 * Automatically synchronizes today's free models from:
 *   1. OpenAgentic.id (Web & API /v1/models)
 *   2. Kilo.ai (Gateway API /api/gateway/models)
 *   3. OpenRouter (API /api/v1/models)
 *   4. Poolside (Inference API /v1/models)
 *   5. Google Gemini API (/v1beta/models)
 *   6. Ollama Cloud API (api.ollama.com/v1/models)
 *   7. API.airforce API (api.airforce/v1/models)
 *   8. Bazaarlink API (bazaarlink.ai/api/v1/models)
 *   9. 9router OpenCode (oc/* free models directly from 9router)
 *   10. Groq API (api.groq.com/openai/v1/models)
 *   11. Cerebras API (api.cerebras.ai/v1/models)
 *   12. Mistral La Plateforme free tier (api.mistral.ai/v1/models)
 *   13. Cloudflare Workers AI free neurons (native "cloudflare-ai" connection in 9router)
 *   14. NVIDIA NIM free tier (integrate.api.nvidia.com/v1/models, native "nvidia" connection)
 *   15. B.ai OpenAI-compatible free tier (api.b.ai/v1/models, native "b.ai" connection)
 * 
 * Pre-tests all candidates against 9router to drop expired/dead/paid models,
 * sorts them by coding capability specification (best to worst),
 * and injects valid models into 9router combos:
 *   - my9model-free   : Unified super-combo across all providers
 *   - openagentic-free: Dedicated OpenAgentic free combo
 *   - kilo-free       : Dedicated Kilo.ai free combo
 *   - openrouter-free : Dedicated OpenRouter free combo
 *   - poolside-free   : Dedicated Poolside free combo
 *   - gemini-free     : Dedicated Gemini free combo
 *   - ollama-free     : Dedicated Ollama Cloud free combo
 *   - b.ai-free       : Dedicated B.ai free combo
 *   - airforce-free   : Dedicated API.airforce free combo
 *   - bazaarlink-free : Dedicated Bazaarlink free combo
 *   - opencode-free   : Dedicated OpenCode free combo
 *   - groq-free       : Dedicated Groq free combo
 *   - cerebras-free   : Dedicated Cerebras free combo
 *   - mistral-free    : Dedicated Mistral free combo (requires Mistral connection)
 *   - cloudflare-free : Dedicated Cloudflare Workers AI free combo ("cloudflare-ai" connection)
 *   - nvidia-free     : Dedicated NVIDIA NIM free combo ("nvidia" connection)
 *   - my9model-smart  : Thinking / high-benchmark subset of the super-combo
 *   - my9model-fast   : Low-latency non-thinking subset of the super-combo
 *   - my9model-cooldown : Parking combo for temporarily quota-exhausted models;
 *                       the watchdog moves them back to the main combos once they recover
 *
 * Modes:
 *   node sync.js              -> Full daily sync (scrape + live-test + inject)
 *   node sync.js --refresh    -> Intra-day watchdog: re-test existing combo models,
 *                                park quota-exhausted (429) in my9model-cooldown, drop dead ones
 *   node sync.js --dry-run    -> Simulate without writing
 *   node sync.js --setup-cron -> Install scheduler (systemd timer w/ Persistent=true, cron fallback)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

// Database and 9router paths
const HOME = os.homedir();
const NINE_ROUTER_DIR = path.join(HOME, '.9router');
const DB_PATH = path.join(NINE_ROUTER_DIR, 'db', 'data.sqlite');
const BETTER_SQLITE_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', 'better-sqlite3');
const CLIENT_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', '9router', 'src', 'cli', 'api', 'client.js');

// Options
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRefreshMode = args.includes('--refresh') || args.includes('--watchdog');
const isCronSetup = args.includes('--setup-cron') || args.includes('--setup-scheduler');
const isLiveBenchmarks = args.includes('--live-benchmarks') || args.includes('--update-benchmarks');

// ponytail: single-user local tool, thresholds hardcoded; promote to config file when a second machine appears
const AGENTIC_MIN_CONTEXT = 100000;      // super-combo agentic floor (supports 128k/256k/1M models)
const QUOTA_RETRY_DELAY_MS = 1200;       // wait before re-testing a transient failure
const QUOTA_LATENCY_SENTINEL = 999998;   // latency marker that forces quota-exhausted models to the bottom
const CANDIDATES_STATE_PATH = path.join(__dirname, 'candidates-state.json'); // last full-sync candidate pool (watchdog recovery)
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

// ponytail: shared better-sqlite3 loader helper
function getDbClass() {
  try {
    return require(BETTER_SQLITE_PATH);
  } catch {
    return require('better-sqlite3');
  }
}

// Read 9router internal CLI auth token for API calls
function get9routerCliToken() {
  try {
    const machineId = fs.readFileSync(path.join(NINE_ROUTER_DIR, 'machine-id'), 'utf8').trim();
    const secret = fs.readFileSync(path.join(NINE_ROUTER_DIR, 'auth', 'cli-secret'), 'utf8').trim();
    return crypto.createHash('sha256').update(machineId + '9r-cli-auth' + secret).digest('hex').substring(0, 16);
  } catch {
    return '';
  }
}

// Load blacklist / exclusion rules from exclusions.json
const EXCLUSIONS_PATH = path.join(__dirname, 'exclusions.json');

function getExclusionConfig() {
  let excludedModels = [];
  let excludedProviders = [];

  try {
    if (fs.existsSync(EXCLUSIONS_PATH)) {
      const content = fs.readFileSync(EXCLUSIONS_PATH, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        for (const item of data) {
          const str = String(item).trim().toLowerCase();
          if (str.startsWith('provider:')) {
            excludedProviders.push(str.replace(/^provider:/, '').trim());
          } else if (str) {
            excludedModels.push(str);
          }
        }
      } else if (typeof data === 'object' && data !== null) {
        if (Array.isArray(data.excludedModels)) {
          excludedModels = data.excludedModels.map(m => String(m).trim().toLowerCase()).filter(Boolean);
        }
        if (Array.isArray(data.excludedProviders)) {
          excludedProviders = data.excludedProviders.map(p => String(p).trim().toLowerCase()).filter(Boolean);
        }
      }
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read exclusions.json: ${err.message}`);
  }

  // CLI argument support: --exclude-provider=api-airforce,ollama
  const cliExcludeArg = args.find(a => a.startsWith('--exclude-provider='));
  if (cliExcludeArg) {
    const list = cliExcludeArg.split('=')[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    excludedProviders.push(...list);
  }

  return {
    excludedModels,
    excludedProviders: Array.from(new Set(excludedProviders))
  };
}

function getExclusionList() {
  return getExclusionConfig().excludedModels;
}

function getExcludedProviders() {
  return getExclusionConfig().excludedProviders;
}

// Check if a provider is excluded
function isProviderExcluded(providerName, excludedProviders = null) {
  const list = excludedProviders || getExcludedProviders();
  if (!list || list.length === 0) return false;
  const name = String(providerName).trim().toLowerCase();
  return list.some(p => p === name || name.includes(p) || (p === 'airforce' && name === 'api-airforce') || (p === 'bzl' && name === 'bazaarlink') || (p === 'bazaarlink' && name === 'bzl'));
}

// Check if a model matches any exclusion rule (exact or substring)
function isModelExcluded(modelIdentifier, exclusions) {
  if (!exclusions || exclusions.length === 0) return false;
  const str = String(modelIdentifier).toLowerCase();
  for (const item of exclusions) {
    if (!item) continue;
    if (str === item || str.includes(item)) {
      return item;
    }
  }
  return false;
}

// Load empirical benchmarks database
const BENCHMARKS_PATH = path.join(__dirname, 'benchmarks.json');
function getBenchmarksDatabase() {
  try {
    if (fs.existsSync(BENCHMARKS_PATH)) {
      const content = fs.readFileSync(BENCHMARKS_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read benchmarks.json: ${err.message}`);
  }
  return {};
}

// Find matched benchmark item for a given model identifier
function findBenchmarkMatch(modelIdentifier, benchmarks) {
  if (!benchmarks || Object.keys(benchmarks).length === 0) return null;
  const str = String(modelIdentifier).toLowerCase()
    .replace(/^(?:openrouter|kc|oc|openagentic|poolside|gemini|ollama|api-airforce|airforce|bazaarlink|bzl)\//, '')
    .replace(/:(?:free|thinking)$/, '')
    .replace(/-free$/, '');

  // 1. Direct exact key match
  if (benchmarks[str]) return benchmarks[str];

  // 2. Substring / slug matching
  for (const [key, data] of Object.entries(benchmarks)) {
    if (str === key || str.includes(key) || key.includes(str)) {
      return data;
    }
  }
  return null;
}

// Coding capability scoring engine
// Uses Empirical Benchmarks (SWE-bench / LiveCodeBench) with Heuristic Spec fallback
function getCodingScore(modelIdentifier, customBenchmarks = null) {
  const str = String(modelIdentifier).toLowerCase();

  // Heavy penalty for image / non-coding models
  if (str.includes('image') || str.includes('flux') || str.includes('wan2') || str.includes('video') || str.includes('safety') || str.includes('lyria')) {
    return -10000;
  }

  const benchmarks = customBenchmarks || getBenchmarksDatabase();
  const benchmarkMatch = findBenchmarkMatch(modelIdentifier, benchmarks);

  if (benchmarkMatch && typeof benchmarkMatch.score === 'number') {
    let score = Math.round(benchmarkMatch.score * 100);
    if (str.includes('thinking') || str.includes('reasoning') || str.includes('reasoner')) score += 400;
    if (str.includes('flash') || str.includes('lightning')) score += 150;
    return score;
  }

  // Heuristic Fallback
  let score = 0;

  // 1. Family Base Score
  if (str.includes('claude') || str.includes('anthropic') || str.includes('sonnet') || str.includes('opus')) {
    score += 5000;
  } else if (str.includes('gpt') || str.includes('openai') || str.includes('o3') || str.includes('o4')) {
    score += 5000;
  } else if (str.includes('deepseek')) {
    score += 4800;
  } else if (str.includes('gemini')) {
    score += 4600;
  } else if (str.includes('qwen')) {
    score += 4400;
  } else if (str.includes('glm') || str.includes('zhipu') || str.includes('zai')) {
    score += 4200;
  } else if (str.includes('kimi') || str.includes('moonshot') || str.includes('step')) {
    score += 4200;
  } else if (str.includes('poolside') || str.includes('laguna')) {
    score += 4100;
  } else if (str.includes('minimax')) {
    score += 3800;
  } else if (str.includes('nemotron')) {
    score += 3600;
  } else if (str.includes('kilo-auto') || str.includes('auto')) {
    score += 3500;
  } else if (str.includes('mimo') || str.includes('xiaomi')) {
    score += 3400;
  } else if (str.includes('open-agentic') || str.includes('openagentic') || str.includes('opencode')) {
    score += 3300;
  } else if (str.includes('north-mini-code') || str.includes('cohere')) {
    score += 3300;
  } else {
    score += 3000;
  }

  // 2. Version multiplier / bonus (e.g. 5.6 -> 5600, 4.5 -> 4500, 3.7 -> 3700)
  //    Strip parameter-count tokens first (8b, 70b, 16x9b) so they are never mistaken for a version.
  const versionMatch = str.replace(/\d+(?:\.\d+)?[xb]\b/g, '').match(/(?:v|gpt-|claude-|gemini-|qwen|glm-|kimi-k|mimo-v|minimax-m|step-|lfm-)?(\d+(?:\.\d+)?)/);
  if (versionMatch) {
    const ver = parseFloat(versionMatch[1]);
    if (!isNaN(ver) && ver > 0 && ver <= 10) {
      score += Math.round(ver * 1000);
    }
  }

  // 3. Coding and Reasoning Specific Modifiers
  if (str.includes('codex') || str.includes('code') || str.includes('coder')) score += 1200;
  if (str.includes('thinking') || str.includes('reasoning') || str.includes('reasoner')) score += 400;
  if (str.includes('opus') || str.includes('sol') || str.includes('terra') || str.includes('luna') || str.includes('max')) score += 500;
  if (str.includes('sonnet') || str.includes('pro')) score += 350;
  if (str.includes('plus') || str.includes('flash') || str.includes('lightning')) score += 150;
  if (str.includes('ultra') || str.includes('super')) score += 100;

  return score;
}

// Load user-defined custom model priorities list (priorities.json)
const PRIORITIES_PATH = path.join(__dirname, 'priorities.json');
function getPrioritiesList() {
  try {
    if (fs.existsSync(PRIORITIES_PATH)) {
      const content = fs.readFileSync(PRIORITIES_PATH, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        return data.map(p => String(p).trim().toLowerCase()).filter(Boolean);
      }
      if (data && Array.isArray(data.priorities)) {
        return data.priorities.map(p => String(p).trim().toLowerCase()).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read priorities.json: ${err.message}`);
  }
  return [];
}

// Find user priority rank index for a model (0 = highest priority, Infinity = no custom priority)
function getModelPriorityRank(modelIdentifier, priorities) {
  if (!priorities || priorities.length === 0) return Infinity;
  const str = String(modelIdentifier).toLowerCase();
  for (let i = 0; i < priorities.length; i++) {
    const p = priorities[i];
    if (!p) continue;
    if (str === p || str.includes(p)) {
      return i;
    }
  }
  return Infinity;
}

// ============================================================================
// Usage Feedback Loop (real-world reliability signal from 9router usageHistory)
// Models that error a lot in real traffic get a ranking penalty, so benchmark
// score alone never keeps a broken free endpoint at the top of the combo.
// ============================================================================
const USAGE_PROVIDER_MAP = {
  'oa': 'openagentic', 'openagentic': 'openagentic',
  'kc': 'kilocode',
  'oc': 'opencode',
  'openrouter': 'openrouter',
  'poolside': 'poolside',
  'gemini': 'gemini',
  'ollama': 'ollama',
  'api-airforce': 'api-airforce', 'airforce': 'api-airforce',
  'bazaarlink': 'bazaarlink', 'bzl': 'bazaarlink',
  'groq': 'groq',
  'cerebras': 'cerebras',
  'mistral': 'mistral',
  'cloudflare': 'cloudflare', 'cloudflare-ai': 'cloudflare', 'cf': 'cloudflare',
  'nvidia': 'nvidia', 'nim': 'nvidia'
};
const USAGE_LOOKBACK_DAYS = 7;
const USAGE_MIN_SAMPLES = 5;

let usageFeedbackCache = null;
let usageFeedbackLoadedAt = 0;

function loadUsageFeedback(forceReload = false) {
  // ponytail: 60s in-process cache; a long-lived daemon would want TTL invalidation
  if (!forceReload && usageFeedbackCache && (Date.now() - usageFeedbackLoadedAt) < 60000) {
    return usageFeedbackCache;
  }
  const stats = new Map();
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const since = new Date(Date.now() - USAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      "SELECT provider, model, status, COUNT(*) as cnt FROM usageHistory WHERE timestamp >= ? GROUP BY provider, model, status"
    ).all(since);
    db.close();

    for (const row of rows) {
      if (!row.provider || !row.model) continue;
      const key = `${String(row.provider).toLowerCase()}|${String(row.model).toLowerCase()}`;
      if (!stats.has(key)) stats.set(key, { ok: 0, err: 0 });
      const entry = stats.get(key);
      if (String(row.status).toLowerCase() === 'ok') entry.ok += row.cnt;
      else entry.err += row.cnt;
    }
  } catch (err) {
    console.warn(`[!] Usage feedback unavailable (${err.message}). Ranking without usage penalty.`);
  }
  usageFeedbackCache = stats;
  usageFeedbackLoadedAt = Date.now();
  return stats;
}

// Compute real-world reliability penalty for a combo model id (0 = no penalty)
function getUsagePenalty(fullId) {
  const stats = loadUsageFeedback();
  if (!stats || stats.size === 0) return 0;

  const slash = String(fullId).indexOf('/');
  if (slash <= 0) return 0;
  const provider = USAGE_PROVIDER_MAP[String(fullId).slice(0, slash).toLowerCase()];
  if (!provider) return 0;
  const model = String(fullId).slice(slash + 1).toLowerCase();

  // Exact match first, then without a :free / -free suffix (usage rows may store either form)
  const entry = stats.get(`${provider}|${model}`)
    || stats.get(`${provider}|${model.replace(/:free$/, '')}`)
    || stats.get(`${provider}|${model.replace(/-free$/, '')}`);
  if (!entry) return 0;

  const total = entry.ok + entry.err;
  if (total < USAGE_MIN_SAMPLES) return 0;
  const errorRate = entry.err / total;
  if (errorRate >= 0.5) return -800;
  if (errorRate >= 0.25) return -400;
  return 0;
}

// Extract canonical full model id from a model entry (string or object)
function getModelFullId(m) {
  return typeof m === 'string' ? m : (m.fullId || m.id || m.name || '');
}

// Classify a failed pre-test: quota exhaustion (demote, keep) vs hard failure (drop)
function isQuotaExhaustedResult(result) {
  return Boolean(result && result.quotaExhausted);
}

// Sort models array with User Custom Priorities -> Benchmark Capability -> Usage Reliability -> Latency Tie-Breaker
function sortModelsByCodingQuality(models, latencyMap = null, customPriorities = null) {
  const priorities = customPriorities || getPrioritiesList();
  const benchmarks = getBenchmarksDatabase();

  return [...models].sort((a, b) => {
    const idA = getModelFullId(a);
    const idB = getModelFullId(b);

    const latA = typeof a === 'object' && a.latencyMs != null ? a.latencyMs : (latencyMap ? latencyMap.get(idA) ?? 99999 : 99999);
    const latB = typeof b === 'object' && b.latencyMs != null ? b.latencyMs : (latencyMap ? latencyMap.get(idB) ?? 99999 : 99999);

    // 0. Quota-exhausted models ALWAYS sink to the bottom, above every other rule
    //    (user priorities included). Detected via object flag or the latency sentinel.
    const quotaA = (typeof a === 'object' && (a.quotaExhausted === true || a.latencyMs >= QUOTA_LATENCY_SENTINEL)) || latA >= QUOTA_LATENCY_SENTINEL;
    const quotaB = (typeof b === 'object' && (b.quotaExhausted === true || b.latencyMs >= QUOTA_LATENCY_SENTINEL)) || latB >= QUOTA_LATENCY_SENTINEL;
    if (quotaA !== quotaB) {
      return quotaA ? 1 : -1;
    }

    // 1. User defined priorities (e.g. priorities.json: rank 0 > rank 1 > rank 2...)
    const rankA = getModelPriorityRank(idA, priorities);
    const rankB = getModelPriorityRank(idB, priorities);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    // 2. If both matched the SAME priority rule, prioritize lowest latency first
    if (rankA !== Infinity && rankB !== Infinity) {
      if (latA !== latB) return latA - latB;
    }

    // 3. Empirical benchmark / capability score minus real-world usage penalty
    const scoreA = getCodingScore(idA, benchmarks) + getUsagePenalty(idA);
    const scoreB = getCodingScore(idB, benchmarks) + getUsagePenalty(idB);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    // 4. Secondary tie-breaker: fastest response latency
    return latA - latB;
  });
}

// Extract OpenAgentic API Key and Provider Prefix from 9router Database
function getOpenAgenticCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM providerConnections WHERE isActive = 1").all();
    db.close();

    for (const row of rows) {
      if (row.data) {
        try {
          const parsed = JSON.parse(row.data);
          const baseUrl = parsed?.providerSpecificData?.baseUrl || '';
          if (baseUrl.includes('openagentic.id') || baseUrl.includes('aimurah.my.id') || row.name?.toLowerCase().includes('openagentic')) {
            return {
              apiKey: parsed.apiKey,
              prefix: parsed?.providerSpecificData?.prefix || 'openagentic',
              baseUrl: baseUrl || 'https://openagentic.id/api/v1'
            };
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for OpenAgentic credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'openagentic', baseUrl: 'https://openagentic.id/api/v1' };
}

// Extract Kilo.ai (KiloCode) Access Token from 9router Database
function getKiloCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'kilocode' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      if (parsed.accessToken) {
        return {
          accessToken: parsed.accessToken,
          prefix: 'kc',
          gatewayUrl: 'https://api.kilo.ai/api/gateway'
        };
      }
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Kilo credentials: ${err.message}`);
  }

  return { accessToken: null, prefix: 'kc', gatewayUrl: 'https://api.kilo.ai/api/gateway' };
}

// Extract OpenRouter API Key and Provider Prefix from 9router Database
function getOpenRouterCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'openrouter' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for OpenRouter credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
}

// Extract Poolside API Key and Provider Prefix from 9router Database
function getPoolsideCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'poolside' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'poolside',
        baseUrl: parsed?.providerSpecificData?.baseUrl || 'https://inference.poolside.ai/v1'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Poolside credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'poolside', baseUrl: 'https://inference.poolside.ai/v1' };
}

// Extract Gemini API Key and Provider Prefix from 9router Database
function getGeminiCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'gemini' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Gemini credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
}

// Extract Ollama Cloud API Key and Provider Prefix from 9router Database
function getOllamaCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'ollama' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'ollama',
        baseUrl: parsed?.providerSpecificData?.baseUrl || 'https://api.ollama.com/v1'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Ollama credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'ollama', baseUrl: 'https://api.ollama.com/v1' };
}

// Extract API.airforce API Key and Provider Prefix from 9router Database
function getAirforceCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'api-airforce' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'api-airforce',
        baseUrl: parsed?.providerSpecificData?.baseUrl || 'https://api.airforce/v1'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for API.airforce credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'api-airforce', baseUrl: 'https://api.airforce/v1' };
}

// Extract Bazaarlink API Key and Provider Prefix from 9router Database
function getBazaarlinkCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = 'bazaarlink' AND isActive = 1").get();
    db.close();

    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'bazaarlink',
        baseUrl: parsed?.providerSpecificData?.baseUrl || 'https://bazaarlink.ai/api/v1'
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Bazaarlink credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'bazaarlink', baseUrl: 'https://bazaarlink.ai/api/v1' };
}

// Extract B.ai API Key from 9router Database. Preferred: a native "b.ai" provider
// connection. Fallback: an openai-compatible connection whose baseUrl points at api.b.ai.
function getBAiCredentials() {
  const native = getProviderConnection('b.ai');
  if (native && native.apiKey) {
    return {
      apiKey: native.apiKey,
      prefix: native?.providerSpecificData?.prefix || 'b.ai',
      baseUrl: native?.providerSpecificData?.baseUrl || 'https://api.b.ai/v1'
    };
  }
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM providerConnections WHERE isActive = 1").all();
    db.close();

    for (const row of rows) {
      const provider = String(row.provider || '').toLowerCase();
      if (!provider.startsWith('openai-compatible')) continue;
      let parsed = null;
      try { parsed = JSON.parse(row.data || '{}'); } catch { continue; }
      const baseUrl = parsed?.providerSpecificData?.baseUrl || '';
      if (!baseUrl.includes('api.b.ai')) continue;
      return {
        apiKey: parsed.apiKey || null,
        prefix: parsed?.providerSpecificData?.prefix || 'b-ai',
        baseUrl
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for B.ai credentials: ${err.message}`);
  }

  return { apiKey: null, prefix: 'b-ai', baseUrl: 'https://api.b.ai/v1' };
}

// Scrape free models from OpenAgentic HTML landing page
async function scrapeFreeModelsFromWeb() {
  const freeModels = new Set();
  try {
    console.log('[-] Scraping OpenAgentic.id web for free tier models...');
    const res = await fetch('https://openagentic.id/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const html = await res.text();
      const freeCardRegex = /data-tier="free"[\s\S]*?<div class="truncate text-sm font-medium text-stone-100">([^<]+)<\/div>/g;
      let match;
      while ((match = freeCardRegex.exec(html)) !== null) {
        const rawName = match[1].trim();
        const slug = rawName.toLowerCase()
          .replace(/\s*\(thinking\)/i, '-thinking')
          .replace(/\s*\(free\)/i, '-free')
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        freeModels.add({ id: slug, name: rawName, source: 'oa-web-free-tier' });
      }

      if (html.includes('Gratis Claude Sonnet 4.5') || html.includes('claude-sonnet-4.5')) {
        freeModels.add({ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', source: 'oa-web-hero-promo' });
      }
    }
  } catch (err) {
    console.warn(`[!] Web scraping notice: ${err.message}`);
  }
  return Array.from(freeModels);
}

// Fetch free models from OpenAgentic API
async function fetchFreeModelsFromApi(apiKey, baseUrl) {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching model list from OpenAgentic API (/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const data = json.data || [];

      for (const m of data) {
        const id = m.id || '';
        const name = m.name || '';
        const isExplicitFree = id.endsWith('-free') || name.toLowerCase().includes('free') || name.toLowerCase().includes('(free)');

        if (isExplicitFree) {
          freeModels.push({
            id: id,
            name: name || id,
            source: 'oa-api-free-model'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] OpenAgentic API fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Fetch free models from Kilo.ai Gateway API
async function fetchKiloFreeModels(accessToken, gatewayUrl) {
  const freeModels = [];
  if (!accessToken) return freeModels;

  try {
    console.log('[-] Fetching free models from Kilo.ai Gateway (/api/gateway/models)...');
    const endpoint = `${gatewayUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json) ? json : (json.data || []);

      for (const m of models) {
        const id = m.id || '';
        const name = m.name || id;
        const promptPrice = m.pricing?.prompt;
        const isZeroPrice = promptPrice === '0' || promptPrice === '0.000000000000';
        const isFree = m.isFree === true || isZeroPrice || id.endsWith(':free') || id.includes('/free');

        if (isFree && !id.includes('content-safety') && !id.includes('lyria')) {
          freeModels.push({
            id: id,
            name: name,
            source: 'kilo-gateway-free'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] Kilo.ai fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Fetch free models from OpenRouter API
async function fetchOpenRouterFreeModels(apiKey, baseUrl = 'https://openrouter.ai/api/v1') {
  const freeModels = [];
  try {
    console.log('[-] Fetching free models from OpenRouter API (/api/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json) ? json : (json.data || []);

      for (const m of models) {
        const id = m.id || '';
        const name = m.name || id;
        const promptPrice = m.pricing?.prompt;
        const isZeroPrice = promptPrice === '0' || promptPrice === '0.000000000000' || parseFloat(promptPrice) === 0;
        const isFree = m.isFree === true || isZeroPrice || id.endsWith(':free') || id.includes('/free');

        if (isFree && !id.includes('content-safety') && !id.includes('lyria') && !id.includes('embed') && !id.includes('tts')) {
          freeModels.push({
            id: id,
            name: name,
            source: 'openrouter-api-free'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] OpenRouter fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Fetch free models from Poolside Inference API
async function fetchPoolsideFreeModels(apiKey, baseUrl = 'https://inference.poolside.ai/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching free models from Poolside API (/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = json.data || [];

      for (const m of models) {
        const id = m.id || '';
        const name = m.name || id;
        const promptPrice = m.pricing?.prompt;
        const isZeroPrice = promptPrice === '0' || promptPrice === '0.000000000000' || parseFloat(promptPrice) === 0;
        const isFree = m.is_free === true || isZeroPrice || id.endsWith(':free') || id.includes('/free');

        if (isFree && !id.includes('content-safety') && !id.includes('lyria') && !id.includes('embed') && !id.includes('tts')) {
          freeModels.push({
            id: id,
            name: name,
            source: 'poolside-api-free'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] Poolside fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Extract OpenCode free models directly from 9router (oc/*)
function getTodaysOpenCodeFreeModels() {
  console.log('[-] Extracting OpenCode free models directly from 9router...');
  const baseOcFree = [
    'oc/mimo-v2.5-free',
    'oc/laguna-s-2.1-free',
    'oc/deepseek-v4-flash-free',
    'oc/qwen3.6-plus-free',
    'oc/minimax-m3-free',
    'oc/nemotron-3-ultra-free',
    'oc/ling-3.0-flash-free',
    'oc/north-mini-code-free'
  ];

  const modelObjects = baseOcFree.map(fullId => ({
    id: fullId.replace(/^oc\//, ''),
    fullId: fullId,
    name: fullId.replace(/^oc\//, ''),
    source: '9router-opencode'
  }));

  return {
    prefix: 'oc',
    models: sortModelsByCodingQuality(modelObjects)
  };
}

// Merge and discover all free models from OpenAgentic
async function getTodaysOpenAgenticFreeModels() {
  const creds = getOpenAgenticCredentials();
  const [webModels, apiModels] = await Promise.all([
    scrapeFreeModelsFromWeb(),
    fetchFreeModelsFromApi(creds.apiKey, creds.baseUrl)
  ]);

  const modelMap = new Map();
  for (const m of apiModels) modelMap.set(m.id, m);
  for (const m of webModels) {
    if (!modelMap.has(m.id)) modelMap.set(m.id, m);
  }

  const baselineFreeIds = ['hy3-free', 'nemotron-3-ultra-free', 'mimo-v2.5-free'];
  for (const id of baselineFreeIds) {
    if (!modelMap.has(id)) {
      modelMap.set(id, { id, name: id, source: 'oa-baseline' });
    }
  }

  return {
    prefix: creds.prefix || 'openagentic',
    models: sortModelsByCodingQuality(Array.from(modelMap.values()))
  };
}

// Merge and discover all free models from Kilo.ai
async function getTodaysKiloFreeModels() {
  const creds = getKiloCredentials();
  const models = await fetchKiloFreeModels(creds.accessToken, creds.gatewayUrl);

  return {
    prefix: creds.prefix || 'kc',
    models: sortModelsByCodingQuality(models)
  };
}

// Merge and discover all free models from OpenRouter
async function getTodaysOpenRouterFreeModels() {
  const creds = getOpenRouterCredentials();
  const models = await fetchOpenRouterFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'openrouter',
    models: sortModelsByCodingQuality(models)
  };
}

// Merge and discover all free models from Poolside
async function getTodaysPoolsideFreeModels() {
  const creds = getPoolsideCredentials();
  const models = await fetchPoolsideFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'poolside',
    models: sortModelsByCodingQuality(models)
  };
}

// Fetch free models from Google Gemini API
async function fetchGeminiFreeModels(apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching model list from Google Gemini API (/v1beta/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models?key=${apiKey}`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = json.models || [];

      for (const m of models) {
        if (!m.supportedGenerationMethods || !m.supportedGenerationMethods.includes('generateContent')) {
          continue;
        }

        const rawName = m.name || '';
        const id = rawName.replace(/^models\//, '');
        const name = m.displayName || id;
        const lowerId = id.toLowerCase();

        // Skip non-coding / audio / preview image / tts / robotics / custom tools
        if (
          lowerId.includes('image') ||
          lowerId.includes('banana') ||
          lowerId.includes('tts') ||
          lowerId.includes('lyria') ||
          lowerId.includes('robotics') ||
          lowerId.includes('customtools') ||
          lowerId.includes('embed')
        ) {
          continue;
        }

        freeModels.push({
          id: id,
          name: name,
          source: 'gemini-api-free'
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Gemini API fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Merge and discover all free models from Gemini
async function getTodaysGeminiFreeModels() {
  const creds = getGeminiCredentials();
  const models = await fetchGeminiFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'gemini',
    models: sortModelsByCodingQuality(models)
  };
}

// Fetch candidate models from Ollama Cloud API
async function fetchOllamaFreeModels(apiKey, baseUrl = 'https://api.ollama.com/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching model list from Ollama Cloud API (/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json) ? json : (json.data || json.models || []);

      for (const m of models) {
        const id = m.id || m.name || m.model || '';
        if (!id) continue;
        const name = m.name || id;

        // Skip non-coding / audio / embed / video
        const lowerId = id.toLowerCase();
        if (
          lowerId.includes('embed') ||
          lowerId.includes('tts') ||
          lowerId.includes('vision') ||
          lowerId.includes('flux') ||
          lowerId.includes('video') ||
          lowerId.includes('safety')
        ) {
          continue;
        }

        // Skip models that strictly require a paid subscription on Ollama Cloud
        if (
          lowerId.includes('deepseek') ||
          lowerId.includes('kimi') ||
          lowerId.includes('glm') ||
          lowerId.includes('mistral') ||
          lowerId.includes('qwen') ||
          lowerId.includes('minimax-m2.7')
        ) {
          continue;
        }

        freeModels.push({
          id: id,
          name: name,
          source: 'ollama-cloud-free'
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Ollama Cloud fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Merge and discover all free models from Ollama Cloud
async function getTodaysOllamaFreeModels() {
  const creds = getOllamaCredentials();
  const models = await fetchOllamaFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'ollama',
    models: sortModelsByCodingQuality(models)
  };
}

// Fetch free models from API.airforce API (/v1/models)
async function fetchAirforceFreeModels(apiKey, baseUrl = 'https://api.airforce/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching free models from API.airforce API (/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = json.data || [];

      for (const m of models) {
        if (m.tier !== 'free' || m.status !== 'operational' || m.supports_chat === false) {
          continue;
        }

        const id = m.id || '';
        const name = m.name || id;
        const lowerId = id.toLowerCase();

        // Skip non-coding, music, audio, tts, reranker, image, upload
        if (
          lowerId.includes('suno') ||
          lowerId.includes('voxtral') ||
          lowerId.includes('rnj') ||
          lowerId.includes('reranker') ||
          lowerId.includes('embed') ||
          lowerId.includes('tts') ||
          lowerId.includes('mj_upload') ||
          lowerId.includes('diffusion') ||
          lowerId.includes('image')
        ) {
          continue;
        }

        freeModels.push({
          id: id,
          name: name,
          source: 'airforce-api-free'
        });
      }
    }
  } catch (err) {
    console.warn(`[!] API.airforce fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Merge and discover all free models from API.airforce
async function getTodaysAirforceFreeModels() {
  const creds = getAirforceCredentials();
  const models = await fetchAirforceFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'api-airforce',
    models: sortModelsByCodingQuality(models)
  };
}

// Fetch free models from Bazaarlink API (/v1/models)
async function fetchBazaarlinkFreeModels(apiKey, baseUrl = 'https://bazaarlink.ai/api/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;

  try {
    console.log('[-] Fetching free models from Bazaarlink API (/v1/models)...');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0'
      },
      signal: AbortSignal.timeout(20000)
    });

    if (res.ok) {
      const json = await res.json();
      const models = Array.isArray(json) ? json : (json.data || []);

      for (const m of models) {
        const id = m.id || '';
        const name = m.name || id;
        const promptPrice = m.pricing?.prompt;
        const isZeroPrice = promptPrice === '0' || promptPrice === '0.000000000000' || parseFloat(promptPrice) === 0;
        const isFree = m.isFree === true || m.is_free === true || isZeroPrice || id.endsWith(':free') || id.includes('/free');

        if (isFree && !id.includes('content-safety') && !id.includes('lyria') && !id.includes('embed') && !id.includes('tts') && !id.includes('image') && !id.includes('diffusion')) {
          freeModels.push({
            id: id,
            name: name,
            source: 'bazaarlink-api-free'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] Bazaarlink fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Merge and discover all free models from Bazaarlink
async function getTodaysBazaarlinkFreeModels() {
  const creds = getBazaarlinkCredentials();
  const models = await fetchBazaarlinkFreeModels(creds.apiKey, creds.baseUrl);

  return {
    prefix: creds.prefix || 'bazaarlink',
    models: sortModelsByCodingQuality(models)
  };
}

// Merge and discover all free models from B.ai (OpenAI-compatible /v1/models)

async function getTodaysBAiFreeModels() {
  const creds = getBAiCredentials();
  const models = await fetchOpenAiCompatibleFreeModels({
    label: 'B.ai', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
    skipPatterns: ['tts', 'embed', 'image', 'whisper', 'diffusion', 'rerank', 'guard', 'audio', 'speech']
  });
  return { prefix: creds.prefix || 'b.ai', models: sortModelsByCodingQuality(models) };
}

// ============================================================================
// Additional free providers: Groq, Cerebras, Mistral, Cloudflare Workers AI
// Each is optional: without a matching 9router connection the source is
// skipped gracefully, and every candidate still passes the live pre-test
// before it can enter any combo.
// ============================================================================

// Shared helper: read one active provider connection from the 9router database
function getProviderConnection(providerName) {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT * FROM providerConnections WHERE provider = ? AND isActive = 1").get(providerName);
    db.close();
    if (row && row.data) return JSON.parse(row.data);
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for ${providerName}: ${err.message}`);
  }
  return null;
}

// Extract Groq API Key from 9router Database
function getGroqCredentials() {
  const parsed = getProviderConnection('groq');
  return {
    apiKey: parsed?.apiKey || null,
    prefix: parsed?.providerSpecificData?.prefix || 'groq',
    baseUrl: 'https://api.groq.com/openai/v1'
  };
}

// Extract Cerebras API Key from 9router Database
function getCerebrasCredentials() {
  const parsed = getProviderConnection('cerebras');
  return {
    apiKey: parsed?.apiKey || null,
    prefix: parsed?.providerSpecificData?.prefix || 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1'
  };
}

// Extract Mistral API Key from 9router Database (native 9router provider type)
function getMistralCredentials() {
  const parsed = getProviderConnection('mistral');
  return {
    apiKey: parsed?.apiKey || null,
    prefix: parsed?.providerSpecificData?.prefix || 'mistral',
    baseUrl: 'https://api.mistral.ai/v1'
  };
}

// Extract NVIDIA NIM API Key from 9router Database (native 9router provider type)
function getNvidiaCredentials() {
  const parsed = getProviderConnection('nvidia');
  return {
    apiKey: parsed?.apiKey || null,
    prefix: parsed?.providerSpecificData?.prefix || 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1'
  };
}

// Cloudflare Workers AI credentials. Preferred: the native "cloudflare-ai" provider
// connection in 9router (apiKey + providerSpecificData.accountId). Fallback: a
// user-added openai-compatible connection whose baseUrl points at api.cloudflare.com.
function getCloudflareCredentials() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM providerConnections WHERE isActive = 1").all();
    db.close();

    for (const row of rows) {
      const provider = String(row.provider || '').toLowerCase();
      if (provider !== 'cloudflare-ai') continue;
      let parsed = null;
      try { parsed = JSON.parse(row.data || '{}'); } catch { continue; }
      const accountId = parsed?.providerSpecificData?.accountId || null;
      if (!parsed.apiKey || !accountId) continue;
      return { apiKey: parsed.apiKey, accountId, prefix: 'cloudflare-ai', baseUrl: '' };
    }

    for (const row of rows) {
      const provider = String(row.provider || '').toLowerCase();
      if (!provider.startsWith('openai-compatible')) continue;
      let parsed = null;
      try { parsed = JSON.parse(row.data || '{}'); } catch { continue; }
      const baseUrl = parsed?.providerSpecificData?.baseUrl || '';
      if (!baseUrl.includes('api.cloudflare.com')) continue;
      const accountMatch = baseUrl.match(/accounts\/([^/]+)/);
      return {
        apiKey: parsed.apiKey || null,
        accountId: accountMatch ? accountMatch[1] : null,
        prefix: parsed?.providerSpecificData?.prefix || 'cloudflare-ai',
        baseUrl
      };
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB for Cloudflare: ${err.message}`);
  }
  return { apiKey: null, accountId: null, prefix: 'cloudflare-ai', baseUrl: '' };
}

// Generic OpenAI-compatible /models fetcher with per-provider free filtering
async function fetchOpenAiCompatibleFreeModels({ label, apiKey, baseUrl, prefix, skipPatterns = [], requireApiKey = true }) {
  const freeModels = [];
  if (requireApiKey && !apiKey) {
    console.log(`[⊘] ${label}: no API key/connection found in 9router, skipping (add the connection to enable).`);
    return freeModels;
  }

  try {
    console.log(`[-] Fetching free models from ${label} (/models)...`);
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.warn(`[!] ${label} fetch notice: HTTP ${res.status}`);
      return freeModels;
    }

    const json = await res.json();
    const models = Array.isArray(json) ? json : (json.data || json.models || []);

    // Alias-aware dedupe: providers like Mistral list canonical ids, dated snapshots
    // and marketing names as SEPARATE rows that reference each other through
    // circular `aliases` arrays. Group ids connected via aliases (union-find) and
    // keep exactly one representative per group, preferring the "-latest" id.
    const parentMap = new Map();
    const findRoot = x => {
      // Iterative find with path halving; always advance x toward the root
      while (parentMap.get(x) !== x) {
        const next = parentMap.get(parentMap.get(x));
        if (next == null || next === undefined) break;
        parentMap.set(x, next);
        x = next;
      }
      return parentMap.get(x) ?? x;
    };
    const unionIds = (a, b) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) parentMap.set(ra, rb);
    };
    const ensureId = x => { if (!parentMap.has(x)) parentMap.set(x, x); };

    const modelById = new Map();
    for (const m of models) {
      const id = String(m.id || m.name || m.model || '').toLowerCase();
      if (!id) continue;
      ensureId(id);
      modelById.set(id, m);
      for (const alias of (Array.isArray(m?.aliases) ? m.aliases : [])) {
        const key = String(alias).toLowerCase();
        if (!key) continue;
        ensureId(key);
        unionIds(id, key);
      }
    }

    const representativeOfRoot = new Map();
    const preferCandidate = (candidate, incumbent) => {
      if (!incumbent) return true;
      const candidateLatest = candidate.endsWith('-latest');
      const incumbentLatest = incumbent.endsWith('-latest');
      if (candidateLatest !== incumbentLatest) return candidateLatest;
      return candidate.length < incumbent.length;
    };
    for (const id of modelById.keys()) {
      const root = findRoot(id);
      if (preferCandidate(id, representativeOfRoot.get(root))) {
        representativeOfRoot.set(root, id);
      }
    }
    const keepIds = new Set(representativeOfRoot.values());

    const seenIds = new Set();
    for (const m of models) {
      const id = m.id || m.name || m.model || '';
      if (!id || seenIds.has(id)) continue;
      const name = m.name || m.summary || id;
      const lowerId = id.toLowerCase();

      if (skipPatterns.some(pat => lowerId.includes(pat))) continue;
      if (!keepIds.has(lowerId)) continue;
      seenIds.add(id);

      freeModels.push({
        id,
        name,
        source: `${prefix}-api-free`,
        contextLength: Number(m.context_window || m.context_length || m.max_context_length || 0) || undefined
      });
    }
  } catch (err) {
    console.warn(`[!] ${label} fetch notice: ${err.message}`);
  }
  return freeModels;
}

// Fetch zero-cost text-generation models from Cloudflare Workers AI (free daily neurons)
async function fetchCloudflareFreeModels(creds) {
  const freeModels = [];
  if (!creds.apiKey || !creds.accountId) {
    console.log('[⊘] Cloudflare Workers AI: no "cloudflare-ai" connection found in 9router, skipping.');
    console.log('    Add one in 9router (provider "Cloudflare", API token + Account ID from dash.cloudflare.com).');
    return freeModels;
  }

  try {
    console.log('[-] Fetching free models from Cloudflare Workers AI (models/search)...');
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/models/search`;
    const perPage = 100;

    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${endpoint}?task=${encodeURIComponent('Text Generation')}&per_page=${perPage}&page=${page}`, {
        headers: { 'Authorization': `Bearer ${creds.apiKey}`, 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) {
        console.warn(`[!] Cloudflare models/search notice: HTTP ${res.status}`);
        break;
      }

      const json = await res.json();
      const models = json.data || json.result || [];

      for (const m of models) {
        // The search API returns a UUID in `id`; the real model name (e.g.
        // "@cf/zai-org/glm-5.2") lives in `name` and is what the API routes on.
        const id = m.name || '';
        if (!id) continue;
        const lowerId = id.toLowerCase();

        // Text-generation models only; drop embed/image/audio/tts/rerank/moderation
        if (/embed|image|audio|speech|tts|whisper|flux|diffusion|rerank|guard|moderation/.test(lowerId)) continue;

        // properties is an array of { property_id, value } pairs
        const props = Object.fromEntries((Array.isArray(m.properties) ? m.properties : [])
          .map(prop => [prop.property_id, prop.value]));

        // Keep only models runnable on the free plan: no per-token price entry and
        // no explicit "requires Workers paid plan" flag. Priced models answer 403
        // on free accounts, so fetching them would only create combo churn.
        const hasPrice = Array.isArray(props.price) && props.price.length > 0;
        const needsPaid = String(props.require_workers_paid) === 'true';
        if (hasPrice || needsPaid) continue;

        freeModels.push({
          id,
          name: m.name || id,
          source: 'cloudflare-workersai-free',
          contextLength: Number(props.context_window || 0) || undefined
        });
      }

      if (models.length < perPage) break;
    }
  } catch (err) {
    console.warn(`[!] Cloudflare models/search notice: ${err.message}`);
  }
  return freeModels;
}

// Merge and discover all free models from Groq
async function getTodaysGroqFreeModels() {
  const creds = getGroqCredentials();
  const models = await fetchOpenAiCompatibleFreeModels({
    label: 'Groq', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
    skipPatterns: ['whisper', 'tts', 'guard', 'embed', 'playai']
  });
  return { prefix: creds.prefix || 'groq', models: sortModelsByCodingQuality(models) };
}

// Merge and discover all free models from Cerebras
async function getTodaysCerebrasFreeModels() {
  const creds = getCerebrasCredentials();
  const models = await fetchOpenAiCompatibleFreeModels({
    label: 'Cerebras', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
    skipPatterns: ['embed']
  });
  return { prefix: creds.prefix || 'cerebras', models: sortModelsByCodingQuality(models) };
}

// Merge and discover all free models from Mistral (free "Experiment" tier)
async function getTodaysMistralFreeModels() {
  const creds = getMistralCredentials();
  const models = await fetchOpenAiCompatibleFreeModels({
    label: 'Mistral', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
    // Paid-only / non-coding entries; anything else that needs payment is dropped by the live pre-test (HTTP 402/403)
    skipPatterns: ['embed', 'moderation', 'ocr', 'tts', 'voxtral', 'mistral-saba']
  });
  return { prefix: creds.prefix || 'mistral', models: sortModelsByCodingQuality(models) };
}

// Merge and discover all free models from NVIDIA NIM (build.nvidia.com free credits)
// The catalog response carries no pricing fields: every model on integrate.api.nvidia.com
// runs on the account's free developer credits, so usability is decided by the live
// pre-test. Skip patterns only remove non-LLM entries (embed/rerank/audio/vision/guard).
async function getTodaysNvidiaFreeModels() {
  const creds = getNvidiaCredentials();
  const models = await fetchOpenAiCompatibleFreeModels({
    label: 'NVIDIA NIM', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
    skipPatterns: [
      // embeddings / retrieval / document parsing
      'embed', 'bge-m3', 'arctic', 'rerank', 'retriever', 'parse',
      // audio / speech / translation
      'tts', 'speech', 'audio', 'asr', 'riva', 'parakeet', 'whisper',
      // vision / image / video
      'vision', '-vl', 'vlm', 'fuyu', 'kosmos', 'neva', 'vila', 'deplot', 'clip', 'diffusion', 'image', 'video', 'detector',
      // guardrails / reward models
      'guard', 'safety', 'topic-control', 'reward', 'moderation'
    ]
  });
  return { prefix: creds.prefix || 'nvidia', models: sortModelsByCodingQuality(models) };
}

// Merge and discover all free models from Cloudflare Workers AI
async function getTodaysCloudflareFreeModels() {
  const creds = getCloudflareCredentials();
  const models = await fetchCloudflareFreeModels(creds);
  return { prefix: creds.prefix || 'cloudflare-ai', models: sortModelsByCodingQuality(models) };
}

/**
 * Pre-test a model via 9router internal test endpoint
 * - Definitive failures (401 promo ended, 402 paid, 403 subscription, 404 missing): dropped immediately.
 * - Transient failures (timeouts, network errors, 408/429/5xx): retried once before a verdict,
 *   so a single hiccup or burst rate-limit never evicts a healthy model for the whole day.
 * - Quota exhaustion (429 / "quota exceeded" after retry): flagged `quotaExhausted` so callers
 *   can demote the model to the bottom of the combo instead of dropping it. It comes back
 *   automatically once its upstream quota resets.
 * Measures response latency (ms) to prioritize faster connections.
 */
async function testModelWith9router(fullModelId, token, attempt = 1) {
  if (!token) return { valid: true, ok: true, latencyMs: 9999, note: '9router token unavailable' };

  const startTime = Date.now();
  try {
    const res = await fetch('http://127.0.0.1:20128/api/models/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-9r-cli-token': token
      },
      body: JSON.stringify({ model: fullModelId, kind: 'llm' }),
      signal: AbortSignal.timeout(20000)
    });

    const latencyMs = Date.now() - startTime;
    const data = await res.json().catch(() => ({}));

    // 200 OK -> Reachable & Active
    if (data.ok) return { valid: true, ok: true, latencyMs };

    const status = Number(data.status || res.status);
    // Keep enough of the error body for reliable classification (some providers bury
    // "Resource Exhausted" / quota markers deep in JSON), but display a short slice.
    const fullReason = String(data.error || `HTTP ${data.status || res.status}`).replace(/\s+/g, ' ').trim();
    const reason = fullReason.slice(0, 75);
    const quotaish = status === 429 || /quota|rate.?limit|resource.?exhaust|capacity/i.test(fullReason.slice(0, 400));

    // Transient status -> retry once before judging
    if (TRANSIENT_HTTP_STATUSES.has(status) && attempt < 2) {
      await new Promise(r => setTimeout(r, QUOTA_RETRY_DELAY_MS));
      return { ...(await testModelWith9router(fullModelId, token, attempt + 1)), retried: true };
    }

    const result = { valid: false, ok: false, latencyMs, status, reason };
    if (quotaish) {
      result.quotaExhausted = true;
    }
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    // Network error / timeout -> transient, retry once before judging
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, QUOTA_RETRY_DELAY_MS));
      return { ...(await testModelWith9router(fullModelId, token, attempt + 1)), retried: true };
    }
    const result = { valid: false, ok: false, latencyMs, reason: err.message.slice(0, 75) };
    if (/timed?\s*out|abort/i.test(err.message)) result.timedOut = true;
    return result;
  }
}

/**
 * Filter model candidate list using exclusions and concurrency pool testing
 */
async function validateCandidateModels(models, prefix) {
  const exclusions = getExclusionList();
  const nonExcludedModels = [];

  for (const m of models) {
    const fullId = m.fullId || `${prefix}/${m.id}`;
    const matchedRule = isModelExcluded(fullId, exclusions) || isModelExcluded(m.id, exclusions);
    if (matchedRule) {
      console.log(`    [⊘ Excluded] ${fullId} -> Matched rule "${matchedRule}"`);
    } else {
      nonExcludedModels.push(m);
    }
  }

  const token = get9routerCliToken();
  if (!token) {
    console.log('[-] 9router CLI auth token not found or server offline, skipping live test.');
    return nonExcludedModels;
  }

  const activeModels = [];
  const quotaLimitedModels = [];
  const concurrency = (prefix === 'ollama' || prefix === 'api-airforce' || prefix === 'airforce') ? 1 : 5;
  const queue = [...nonExcludedModels];

  console.log(`[*] Pre-testing ${nonExcludedModels.length} candidate models for [${prefix}]...`);

  async function worker() {
    while (queue.length > 0) {
      const m = queue.shift();
      const fullId = m.fullId || `${prefix}/${m.id}`;

      // API.airforce has a 1-req/sec global rate limit on free tier
      if (prefix === 'api-airforce' || prefix === 'airforce') {
        await new Promise(r => setTimeout(r, 1200));
      }

      const result = await testModelWith9router(fullId, token);

      if (result.valid) {
        const msText = `${result.latencyMs}ms`;
        console.log(`    [✓ Active] ${fullId} (${msText}) ${result.note ? '(' + result.note + ')' : ''}`);
        activeModels.push({ ...m, latencyMs: result.latencyMs });
      } else if (isQuotaExhaustedResult(result)) {
        // Quota exhausted today: keep the model but park it at the very bottom of the
        // combo so IDE fallback never wastes latency on it first. It returns to its
        // natural rank on the next sync once the upstream quota resets.
        console.log(`    [⏳ Quota] ${fullId} -> Kept at bottom (${result.reason})`);
        quotaLimitedModels.push({ ...m, latencyMs: QUOTA_LATENCY_SENTINEL, quotaExhausted: true });
      } else {
        console.log(`    [✗ Dropped] ${fullId} -> ${result.reason}${result.retried ? ' (after retry)' : ''}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, nonExcludedModels.length) }, () => worker());
  await Promise.all(workers);

  return [
    ...sortModelsByCodingQuality(activeModels),
    ...sortModelsByCodingQuality(quotaLimitedModels)
  ];
}

// ============================================================================
// Delta notifications (optional): Telegram bot or Discord webhook via env vars
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   and/or   DISCORD_WEBHOOK_URL
// Unset -> silently skipped, sync keeps working without any notification.
// ============================================================================

async function sendTextNotification(text) {
  const results = [];
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;

  const post = async (label, url, body) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      results.push(`${label}: HTTP ${res.status}`);
    } catch (err) {
      results.push(`${label}: ${err.message.slice(0, 60)}`);
    }
  };

  const jobs = [];
  if (tgToken && tgChat) {
    jobs.push(post('telegram', `https://api.telegram.org/bot${tgToken}/sendMessage`, {
      chat_id: tgChat,
      text
    }));
  }
  if (discordUrl) {
    jobs.push(post('discord', discordUrl, { content: text }));
  }
  if (jobs.length > 0) {
    await Promise.all(jobs);
    console.log(`[*] Notification results: ${results.join(', ')}`);
  }
}

function buildDeltaMessage({ mode, added, removed, total }) {
  const lines = [`9router free sync (${mode}) done.`];
  lines.push(`Total active models: ${total}`);
  if (added.length === 0 && removed.length === 0) {
    lines.push('No changes since last run.');
  } else {
    if (added.length > 0) lines.push(`+ Added (${added.length}): ${added.slice(0, 10).join(', ')}${added.length > 10 ? ', ...' : ''}`);
    if (removed.length > 0) lines.push(`- Removed (${removed.length}): ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ', ...' : ''}`);
  }
  return lines.join('\n');
}

// Compute set difference between two model id lists
function computeComboDelta(oldList, newList) {
  const oldSet = new Set((oldList || []).map(String));
  const newSet = new Set((newList || []).map(String));
  return {
    added: [...newSet].filter(id => !oldSet.has(id)),
    removed: [...oldSet].filter(id => !newSet.has(id))
  };
}

// Read a combo's current model list straight from SQLite (pre-write snapshot)
function readCurrentComboModels(comboName) {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT models FROM combos WHERE name = ?").get(comboName);
    db.close();
    if (row && row.models) {
      const parsed = JSON.parse(row.models);
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch {}
  return [];
}

// All free combos managed by this tool
const MANAGED_COMBOS = [
  'my9model-free', 'my9model-smart', 'my9model-fast',
  'openagentic-free', 'kilo-free', 'opencode-free', 'openrouter-free',
  'poolside-free', 'gemini-free', 'ollama-free', 'airforce-free',
  'bazaarlink-free', 'b.ai-free', 'groq-free', 'cerebras-free', 'mistral-free', 'cloudflare-free',
  'nvidia-free'
];

// Combo name -> model-id prefixes belonging to it (first segment of fullId)
const PROVIDER_COMBO_PREFIXES = {
  'openagentic-free': ['openagentic', 'oa'],
  'kilo-free': ['kilocode', 'kc'],
  'opencode-free': ['opencode', 'oc'],
  'openrouter-free': ['openrouter'],
  'poolside-free': ['poolside'],
  'gemini-free': ['gemini'],
  'ollama-free': ['ollama'],
  'airforce-free': ['api-airforce', 'airforce'],
  'bazaarlink-free': ['bazaarlink', 'bzl'],
  'b.ai-free': ['b-ai', 'b.ai', 'bai'],
  'groq-free': ['groq'],
  'cerebras-free': ['cerebras'],
  'mistral-free': ['mistral'],
  'cloudflare-free': ['cloudflare-ai', 'cloudflare', 'cf'],
  'nvidia-free': ['nvidia']
};

function idMatchesPrefixes(fullId, prefixes) {
  const head = String(fullId).split('/')[0].toLowerCase();
  return prefixes.includes(head);
}

// Persist the full validated candidate pool after a successful full sync so the
// watchdog can re-admit models that recover from quota exhaustion later in the day.
function saveCandidateState(defs, prefixedByProvider) {
  try {
    const providers = {};
    for (const [key, data] of defs) {
      const ids = prefixedByProvider[key];
      if (!Array.isArray(ids) || ids.length === 0) continue;
      providers[key] = { prefix: data.prefix, ids };
    }
    fs.writeFileSync(CANDIDATES_STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), providers }, null, 2));
  } catch (err) {
    console.warn(`[!] Warning: Could not save candidates-state.json: ${err.message}`);
  }
}

// Load the candidate pool as prefix -> Set(fullId). Returns an empty Map when absent.
function loadCandidatePool() {
  try {
    if (!fs.existsSync(CANDIDATES_STATE_PATH)) return new Map();
    const data = JSON.parse(fs.readFileSync(CANDIDATES_STATE_PATH, 'utf8'));
    const pool = new Map();
    for (const entry of Object.values(data.providers || {})) {
      if (!entry || !entry.prefix) continue;
      const set = pool.get(entry.prefix) || new Set();
      for (const id of entry.ids || []) set.add(String(id));
      pool.set(entry.prefix, set);
    }
    return pool;
  } catch (err) {
    console.warn(`[!] Warning: Could not read candidates-state.json: ${err.message}`);
    return new Map();
  }
}

// Derive the smart/fast tier sub-lists from an already-ranked super-combo list.
function deriveTierLists(rankedAll) {
  let smartList = rankedAll.filter(id => isSmartTierModel(id));
  let fastList = rankedAll.filter(id => !isSmartTierModel(id) && !isThinkingVariant(id));
  if (smartList.length < 3) smartList = rankedAll.slice(0, 5);
  if (fastList.length < 3) fastList = rankedAll.slice(0, 5);
  return { smartList, fastList };
}

/**
 * Write combo updates: 9router API first (live server), SQLite as fallback.
 * Also snapshots the pre-write my9model-free list and notifies the delta.
 */
async function persistCombos(comboMap, mode = 'daily-sync') {
  const previousUnified = readCurrentComboModels('my9model-free');
  const delta = computeComboDelta(previousUnified, comboMap.get('my9model-free') || []);

  // 1. Try updating via 9router API client if server is running
  let updatedViaApi = false;
  try {
    const client = require(CLIENT_PATH);
    if (client && typeof client.getCombos === 'function') {
      const res = await client.getCombos();
      if (res.success && res.data && res.data.combos) {
        for (const combo of res.data.combos) {
          const newList = comboMap.get(combo.name);
          if (!Array.isArray(newList)) continue;
          await client.updateCombo(combo.id, { name: combo.name, models: newList });
          console.log(`[✓] Updated combo '${combo.name}' via 9router API (${newList.length} models)`);
          updatedViaApi = true;
        }
      }
    }
  } catch {}

  // 2. Direct SQLite update (also creates brand-new combos on first run)
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH);
    const existingCombos = db.prepare("SELECT * FROM combos").all();
    const now = new Date().toISOString();

    for (const [comboName, modelList] of comboMap) {
      if (!Array.isArray(modelList)) continue;
      const found = existingCombos.find(c => c.name === comboName);
      if (found) {
        db.prepare("UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?").run(
          JSON.stringify(modelList),
          now,
          found.id
        );
        console.log(`[✓] Synchronized combo '${comboName}' in 9router SQLite (${modelList.length} models)`);
      } else {
        const newId = crypto.randomUUID();
        db.prepare("INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
          newId,
          comboName,
          null,
          JSON.stringify(modelList),
          now,
          now
        );
        console.log(`[✓] Created combo '${comboName}' in 9router SQLite (${modelList.length} models)`);
      }
    }

    db.close();
  } catch (err) {
    if (!updatedViaApi) {
      console.error(`[X] Error updating 9router database: ${err.message}`);
      process.exit(1);
    }
  }

  // 3. Notify the delta (silent no-op when no webhook/token configured)
  try {
    await sendTextNotification(buildDeltaMessage({
      mode,
      added: delta.added,
      removed: delta.removed,
      total: (comboMap.get('my9model-free') || []).length
    }));
  } catch {}
}

/**
 * Watchdog refresh (--refresh): intra-day health pass over existing combo members.
 * - Never discovers/adds new models (that is the daily sync's job).
 * - Re-tests every member: healthy keep their rank (fresh latency),
 *   quota-exhausted are demoted to the bottom instead of dropped,
 *   hard-dead models (401 promo ended / 402 paid / 404 gone) are removed.
 */
async function refreshCombos() {
  console.log('[*] Watchdog refresh: re-testing existing combo members (no discovery)...');
  const token = get9routerCliToken();
  if (!token) {
    console.error('[X] 9router CLI auth token unavailable; live re-test impossible. Aborting without changes.');
    process.exit(1);
  }

  // Load current managed combos
  const current = new Map(); // name -> [ids]
  for (const name of MANAGED_COMBOS) {
    const models = readCurrentComboModels(name);
    if (models.length > 0) current.set(name, models);
  }
  const previousMembers = new Set(MANAGED_COMBOS.flatMap(n => current.get(n) || []));

  // Candidate pool saved by the last full sync: lets models that recover from
  // quota exhaustion rejoin their provider combo within the hour.
  const candidatePool = loadCandidatePool();
  const poolIds = Array.from(new Set([...candidatePool.values()].flatMap(s => [...s])));
  if (poolIds.length > 0) {
    console.log(`[*] Candidate pool: ${poolIds.length} ids from last full sync (recovered models can rejoin).`);
  } else {
    console.log('[*] No candidates-state.json yet — run a full sync once to enable recovery.');
  }

  const superIds = current.get('my9model-free') || [];
  const extraSuper = new Set([
    ...(current.get('my9model-smart') || []),
    ...(current.get('my9model-fast') || []),
    ...(current.get('my9model-cooldown') || []) // parked models must keep being re-tested for recovery
  ]);
  const allIds = Array.from(new Set([
    ...superIds,
    ...extraSuper,
    ...MANAGED_COMBOS.filter(n => !n.startsWith('my9model')).flatMap(n => current.get(n) || []),
    ...poolIds
  ]));

  if (allIds.length === 0) {
    console.log('[!] No managed combos found to refresh. Run a full sync first.');
    return;
  }

  // Live re-test with a bounded worker pool (staggered for rate-limited providers)
  const activeSet = new Set();
  const quotaSet = new Set();
  const latencyRefresh = new Map();
  const queue = [...allIds];
  const CONCURRENCY = 8;

  console.log(`[*] Re-testing ${queue.length} unique combo members...`);

  async function worker() {
    while (queue.length > 0) {
      const fullId = queue.shift();
      const providerPrefix = String(fullId).split('/')[0].toLowerCase();
      if (providerPrefix === 'api-airforce') await new Promise(r => setTimeout(r, 1200));

      const result = await testModelWith9router(fullId, token);
      if (result.valid) {
        latencyRefresh.set(fullId, result.latencyMs);
        activeSet.add(fullId);
      } else if (isQuotaExhaustedResult(result)) {
        console.log(`    [⏳ Quota] ${fullId} demoted to bottom (${result.reason})`);
        quotaSet.add(fullId);
      } else {
        console.log(`    [✗ Removed] ${fullId} -> ${result.reason}${result.retried ? ' (after retry)' : ''}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allIds.length) }, () => worker()));

  // Rank helpers for rebuilds
  const rankedActive = sortModelsByCodingQuality(Array.from(activeSet), latencyRefresh);
  const rankedQuota = sortModelsByCodingQuality(Array.from(quotaSet), latencyRefresh);

  let recoveredCount = 0;
  for (const id of activeSet) {
    if (!previousMembers.has(id)) recoveredCount++;
  }

  const comboMap = new Map();
  // Main super-combo is active-only; quota-exhausted models park in my9model-cooldown
  // and are moved back automatically once they pass a live test again.
  comboMap.set('my9model-free', rankedActive);
  const tiers = deriveTierLists(rankedActive);
  if (tiers.smartList.length > 0) comboMap.set('my9model-smart', tiers.smartList);
  if (tiers.fastList.length > 0) comboMap.set('my9model-fast', tiers.fastList);
  comboMap.set('my9model-cooldown', rankedQuota);

  // Provider combos are CLEAN lists: only currently-active models qualify.
  // Quota-exhausted models sit them out until they pass a live test again.
  for (const name of MANAGED_COMBOS) {
    if (name === 'my9model-free' || name === 'my9model-smart' || name === 'my9model-fast') continue;
    const prefixes = PROVIDER_COMBO_PREFIXES[name];
    if (!prefixes) continue;
    const eligible = new Set([
      ...(current.get(name) || []),
      ...poolIds.filter(id => idMatchesPrefixes(id, prefixes))
    ]);
    if (eligible.size === 0) continue;
    // Fresh test evidence backs this write: an empty list means every member was
    // re-tested this run and none passed — an honest empty state beats a stale list.
    comboMap.set(name, rankedActive.filter(id => eligible.has(id)));
  }

  console.log(`\n[Σ] Refresh result: ${activeSet.size} active, ${quotaSet.size} parked in cooldown, ${allIds.length - activeSet.size - quotaSet.size} removed permanently, ${recoveredCount} recovered into provider combos.`);

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  await persistCombos(comboMap, 'watchdog-refresh');
  console.log('\n[🎉] Watchdog refresh completed successfully.');
}

// ============================================================================
// Agentic readiness helpers (super-combo quality gate)
// ============================================================================

// A model is "smart tier" when it has an empirical benchmark >= 60 or is a thinking/reasoning variant
function isSmartTierModel(modelIdentifier) {
  const str = String(modelIdentifier).toLowerCase();
  if (/thinking|reasoning|reasoner|r1\b/.test(str)) return true;
  const match = findBenchmarkMatch(str, getBenchmarksDatabase());
  return Boolean(match && typeof match.score === 'number' && match.score >= 60);
}

// Thinking variants always belong to the smart combo, never the fast one
function isThinkingVariant(modelIdentifier) {
  return /thinking|reasoning|reasoner/.test(String(modelIdentifier).toLowerCase());
}

// Super-combo agentic gate: drop models whose provider metadata explicitly says
// tool-calling is unsupported, and require a usable context window when known.
function passesAgenticGate(meta) {
  if (!meta) return true; // unknown metadata -> let it in (live pre-test already passed)
  if (meta.toolsUnsupported === true) return false;
  if (meta.contextLength != null && meta.contextLength > 0 && meta.contextLength < AGENTIC_MIN_CONTEXT) return false;
  return true;
}

/**
 * Inject free models into 9router combos.
 * Accepts a single providers object:
 *   { oa, kilo, oc, openrouter, poolside, gemini, ollama, airforce, bazaarlink,
 *     groq, cerebras, mistral, cloudflare, nvidia }
 * Each entry: { prefix, models: [...] , excluded?: true }
 */
async function injectInto9router(providers) {
  const p = providers || {};
  const defs = [
    ['oa', p.oa, 'openagentic'],
    ['kilo', p.kilo, 'kilo'],
    ['oc', p.oc, 'opencode'],
    ['openrouter', p.openrouter, 'openrouter'],
    ['poolside', p.poolside, 'poolside'],
    ['gemini', p.gemini, 'gemini'],
    ['ollama', p.ollama, 'ollama'],
    ['airforce', p.airforce, 'api-airforce'],
    ['bazaarlink', p.bazaarlink, 'bazaarlink'],
    ['bai', p.bai, 'b.ai'],
    ['groq', p.groq, 'groq'],
    ['cerebras', p.cerebras, 'cerebras'],
    ['mistral', p.mistral, 'mistral'],
    ['cloudflare', p.cloudflare, 'cloudflare'],
    ['nvidia', p.nvidia, 'nvidia']
  ];

  // Live-test each source (skipped when the whole provider is excluded)
  for (const [key, data] of defs) {
    if (data && !data.excluded && Array.isArray(data.models)) {
      data.validated = await validateCandidateModels(data.models, data.prefix);
    } else {
      data.validated = [];
    }
  }

  // Prefixed id list + metadata map per provider
  const prefixedByProvider = {};
  const activeByProvider = {}; // CLEAN lists: quota-exhausted models excluded
  const metaMap = new Map(); // fullId -> { contextLength?, toolsUnsupported? }
  const latencyMap = new Map();

  for (const [key, data] of defs) {
    const prefix = data.prefix;
    prefixedByProvider[key] = (data.validated || []).map(m => m.fullId || `${prefix}/${m.id}`);
    activeByProvider[key] = (data.validated || [])
      .filter(m => !(m.quotaExhausted === true || m.latencyMs >= QUOTA_LATENCY_SENTINEL))
      .map(m => m.fullId || `${prefix}/${m.id}`);
    for (const m of (data.validated || [])) {
      const fullId = m.fullId || `${prefix}/${m.id}`;
      const meta = {};
      if (m.contextLength != null) meta.contextLength = m.contextLength;
      if (m.toolsUnsupported != null) meta.toolsUnsupported = m.toolsUnsupported;
      if (Object.keys(meta).length > 0) metaMap.set(fullId, meta);
      if (m.latencyMs != null) latencyMap.set(fullId, m.latencyMs);
    }
  }

  // Per-provider validation report
  for (const [key, data, label] of defs) {
    if (data.excluded) {
      console.log(`\n[⊘] ${label}: Skipped (provider excluded)`);
      continue;
    }
    console.log(`\n[+] Validated ${label}: ${(data.validated || []).length} models:`);
    for (const m of (data.validated || [])) {
      const rawId = m.fullId || `${data.prefix}/${m.id}`;
      const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
      const quotaStr = m.quotaExhausted ? ' [QUOTA-BOTTOM]' : '';
      console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr}${quotaStr} (${m.name})`);
    }
  }

  // Super-combo candidates: union of every provider, deduplicated
  const allIds = Array.from(new Set(defs.flatMap(([key]) => prefixedByProvider[key])));

  // Agentic gate only applies to the super-combos (per-provider combos stay untouched)
  const gatedIds = allIds.filter(id => passesAgenticGate(metaMap.get(id)));
  const gatedOut = allIds.length - gatedIds.length;
  if (gatedOut > 0) {
    console.log(`\n[⚙] Agentic gate: ${gatedOut} model(s) left out of super-combo (no tools support or context < ${AGENTIC_MIN_CONTEXT}). Still kept in their dedicated provider combo.`);
  }

  // Active-only main list; quota-exhausted models park in my9model-cooldown
  const gatedActiveIds = gatedIds.filter(id => (latencyMap.get(id) ?? 0) < QUOTA_LATENCY_SENTINEL);
  const gatedQuotaIds = gatedIds.filter(id => !gatedActiveIds.includes(id));
  const unifiedList = sortModelsByCodingQuality(gatedActiveIds, latencyMap);
  const cooldownList = sortModelsByCodingQuality(gatedQuotaIds, latencyMap);

  // Fast / smart split (both fall back to the unified top-5 so they are never empty)
  const tiers = deriveTierLists(unifiedList);
  const smartList = tiers.smartList;
  const fastList = tiers.fastList;

  console.log(`\n[+] Super-combo my9model-free: ${unifiedList.length} models (all active)`);
  console.log(`[+] my9model-smart: ${smartList.length} models | my9model-fast: ${fastList.length} models`);
  console.log(`[+] my9model-cooldown: ${cooldownList.length} model(s) parked (quota-exhausted)`);

  // Notice when a whole provider is temporarily quota-exhausted
  for (const [key, data, label] of defs) {
    if (!data.excluded && (data.validated || []).length > 0 && activeByProvider[key].length === 0) {
      console.log(`[i] ${label}: all ${(data.validated || []).length} models currently quota-exhausted — ${label}-free cleared until they recover.`);
    }
  }

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  const comboMap = new Map([
    ['my9model-free', unifiedList],
    ['my9model-smart', smartList],
    ['my9model-fast', fastList],
    ['my9model-cooldown', cooldownList],
    ['openagentic-free', (!p.oa?.excluded && (p.oa?.validated?.length || 0) > 0) ? activeByProvider.oa : null],
    ['kilo-free', (!p.kilo?.excluded && (p.kilo?.validated?.length || 0) > 0) ? activeByProvider.kilo : null],
    ['opencode-free', (!p.oc?.excluded && (p.oc?.validated?.length || 0) > 0) ? activeByProvider.oc : null],
    ['openrouter-free', (!p.openrouter?.excluded && (p.openrouter?.validated?.length || 0) > 0) ? activeByProvider.openrouter : null],
    ['poolside-free', (!p.poolside?.excluded && (p.poolside?.validated?.length || 0) > 0) ? activeByProvider.poolside : null],
    ['gemini-free', (!p.gemini?.excluded && (p.gemini?.validated?.length || 0) > 0) ? activeByProvider.gemini : null],
    ['ollama-free', (!p.ollama?.excluded && (p.ollama?.validated?.length || 0) > 0) ? activeByProvider.ollama : null],
    ['airforce-free', (!p.airforce?.excluded && (p.airforce?.validated?.length || 0) > 0) ? activeByProvider.airforce : null],
    ['bazaarlink-free', (!p.bazaarlink?.excluded && (p.bazaarlink?.validated?.length || 0) > 0) ? activeByProvider.bazaarlink : null],
    ['b.ai-free', (!p.bai?.excluded && (p.bai?.validated?.length || 0) > 0) ? activeByProvider.bai : null],
    ['groq-free', (!p.groq?.excluded && (p.groq?.validated?.length || 0) > 0) ? activeByProvider.groq : null],
    ['cerebras-free', (!p.cerebras?.excluded && (p.cerebras?.validated?.length || 0) > 0) ? activeByProvider.cerebras : null],
    ['mistral-free', (!p.mistral?.excluded && (p.mistral?.validated?.length || 0) > 0) ? activeByProvider.mistral : null],
    ['cloudflare-free', (!p.cloudflare?.excluded && (p.cloudflare?.validated?.length || 0) > 0) ? activeByProvider.cloudflare : null],
    ['nvidia-free', (!p.nvidia?.excluded && (p.nvidia?.validated?.length || 0) > 0) ? activeByProvider.nvidia : null]
  ]);
  for (const [name, list] of Array.from(comboMap)) {
    if (!Array.isArray(list)) comboMap.delete(name);
  }

  await persistCombos(comboMap);
  saveCandidateState(defs, prefixedByProvider);

  console.log('\n[🎉] Synchronization completed successfully.');
}

// ============================================================================
// Scheduler installation: systemd user timers first (Persistent=true gives
// catch-up after the machine was off), crontab as fallback. Installs three jobs:
//   - daily full sync      00:05
//   - hourly watchdog      hh:35 (--refresh)
//   - weekly benchmarks    Monday 04:17
// ============================================================================
function writeSystemdUnit(unitsDir, name, content) {
  fs.mkdirSync(unitsDir, { recursive: true });
  fs.writeFileSync(path.join(unitsDir, name), content);
}

function installScheduler() {
  console.log('[*] Installing scheduler (systemd timers preferred, cron fallback)...');
  const scriptPath = path.resolve(__filename);
  const benchPath = path.join(path.dirname(scriptPath), 'update-benchmarks.js');
  const logPath = path.join(path.dirname(scriptPath), 'sync.log');
  const unitsDir = path.join(HOME, '.config', 'systemd', 'user');

  const serviceUnit = `[Unit]
Description=9router free models daily full sync

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${scriptPath}
`;

  const serviceTimer = `[Unit]
Description=Daily 00:05 full sync of free models into 9router

[Timer]
OnCalendar=*-*-* 00:05:00
Persistent=true
Unit=9router-auto-free.service

[Install]
WantedBy=timers.target
`;

  const watchdogService = `[Unit]
Description=9router free combo watchdog (intra-day quota re-check)

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${scriptPath} --refresh
`;

  const watchdogTimer = `[Unit]
Description=Hourly watchdog re-test of free combos (quota demotion)

[Timer]
OnCalendar=*-*-* *:35:00
Persistent=true
Unit=9router-free-watchdog.service

[Install]
WantedBy=timers.target
`;

  const benchService = `[Unit]
Description=Weekly live coding-benchmark database update

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${benchPath}
`;

  const benchTimer = `[Unit]
Description=Weekly benchmark update (Monday 04:17)

[Timer]
OnCalendar=Mon *-*-* 04:17:00
Persistent=true
Unit=9router-bench-update.service

[Install]
WantedBy=timers.target
`;

  // 1) Try systemd user timers
  if (fs.existsSync('/run/systemd/system') || fs.existsSync('/usr/bin/systemctl')) {
    try {
      writeSystemdUnit(unitsDir, '9router-auto-free.service', serviceUnit);
      writeSystemdUnit(unitsDir, '9router-auto-free.timer', serviceTimer);
      writeSystemdUnit(unitsDir, '9router-free-watchdog.service', watchdogService);
      writeSystemdUnit(unitsDir, '9router-free-watchdog.timer', watchdogTimer);
      writeSystemdUnit(unitsDir, '9router-bench-update.service', benchService);
      writeSystemdUnit(unitsDir, '9router-bench-update.timer', benchTimer);

      // Avoid double-runs: strip any legacy cron lines installed by older versions
      removeLegacyCronLines(scriptPath);

      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable --now 9router-auto-free.timer 9router-free-watchdog.timer 9router-bench-update.timer');

      let lingerNote = '';
      try {
        execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'ignore' });
      } catch {
        lingerNote = '\n    Note: could not enable linger; timers run while you are logged in.\n    Run `sudo loginctl enable-linger ' + os.userInfo().username + '` for boot-level persistence.';
      }

      console.log('[✓] systemd user timers installed:');
      console.log('    - 9router-auto-free.timer     daily 00:05 (full sync, Persistent=true)');
      console.log('    - 9router-free-watchdog.timer hourly :35   (--refresh quota watchdog)');
      console.log('    - 9router-bench-update.timer  Mon 04:17    (benchmark update)');
      console.log(`    Log file: ${logPath}${lingerNote}`);
      return;
    } catch (err) {
      console.warn(`[!] systemd installation failed (${String(err.message).split('\n')[0]}); falling back to crontab.`);
    }
  }

  // 2) Crontab fallback
  try {
    const lines = [
      '# Free Models Sync for 9router (installed by sync.js)',
      `5 0 * * * /usr/bin/node ${scriptPath} >> ${logPath} 2>&1`,
      `35 * * * * /usr/bin/node ${scriptPath} --refresh >> ${logPath} 2>&1`,
      `17 4 * * 1 /usr/bin/node ${benchPath} >> ${logPath} 2>&1`
    ];

    let currentCrontab = '';
    try { currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }); } catch {}

    const filtered = currentCrontab.split('\n')
      .filter(line => !line.includes('9router-auto-free') && !line.includes(scriptPath))
      .filter(line => line.trim().length > 0);

    filtered.push(...lines);
    const newCrontab = filtered.join('\n') + '\n';
    execSync(`echo "${newCrontab.replace(/"/g, '\"')}" | crontab -`);

    console.log('[✓] Cron fallback installed:');
    console.log('    - daily 00:05 full sync');
    console.log('    - hourly :35 watchdog refresh (--refresh)');
    console.log('    - Monday 04:17 benchmark update');
    console.log(`    Log file: ${logPath}`);
  } catch (err) {
    console.error(`[X] Failed to install any scheduler: ${err.message}`);
    console.log("    You can manually add the schedules shown above to 'crontab -e'.");
  }
}

// Remove legacy per-version cron entries for this script (prevents double-runs)
function removeLegacyCronLines(scriptPath) {
  try {
    const currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    const filtered = currentCrontab.split('\n')
      .filter(line => line.trim().length > 0)
      .filter(line => !(line.includes('9router-auto-free') || line.includes(scriptPath)));

    if (filtered.length === 0) {
      execSync('crontab -r 2>/dev/null');
      return;
    }
    execSync(`echo "${filtered.join('\n').replace(/"/g, '\"')}" | crontab -`);
  } catch {}
}

// Main execution
async function main() {
  const mode = isRefreshMode ? 'WATCHDOG REFRESH' : (isCronSetup ? 'SETUP SCHEDULER' : 'DAILY FULL SYNC');
  console.log('====================================================');
  console.log('  Free Models Sync -> 9router Combos               ');
  console.log('  Sources: OpenAgentic + Kilo + OpenRouter + Poolside + Gemini + Ollama + Airforce + Bazaarlink + B.ai');
  console.log('           + Groq + Cerebras + Mistral + Cloudflare AI + NVIDIA NIM + OC');
  console.log(`  Mode: ${mode}  `);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  if (isCronSetup) {
    installScheduler();
    console.log('\n[*] Scheduler installed. Exiting (run `npm run sync` manually anytime).');
    return;
  }

  if (isLiveBenchmarks) {
    try {
      const { updateBenchmarks } = require('./update-benchmarks.js');
      await updateBenchmarks();
    } catch (err) {
      console.warn(`[!] Failed to update live benchmarks: ${err.message}`);
    }
  }

  if (isRefreshMode) {
    await refreshCombos();
    return;
  }

  const excludedProviders = getExcludedProviders();
  if (excludedProviders.length > 0) {
    console.log(`[⊘] Excluded providers via config (${excludedProviders.length}): ${excludedProviders.join(', ')}\n`);
  }

  const excludedOr = (name) => isProviderExcluded(name, excludedProviders);
  const skipData = (prefix) => Promise.resolve({ prefix, models: [], excluded: true });

  const [oaData, kiloData, orData, poolsideData, geminiData, ollamaData, airforceData, bazaarlinkData, baiData, groqData, cerebrasData, mistralData, cloudflareData, nvidiaData] = await Promise.all([
    excludedOr('openagentic') ? skipData('openagentic') : getTodaysOpenAgenticFreeModels(),
    (excludedOr('kilocode') || excludedOr('kilo')) ? skipData('kc') : getTodaysKiloFreeModels(),
    excludedOr('openrouter') ? skipData('openrouter') : getTodaysOpenRouterFreeModels(),
    excludedOr('poolside') ? skipData('poolside') : getTodaysPoolsideFreeModels(),
    excludedOr('gemini') ? skipData('gemini') : getTodaysGeminiFreeModels(),
    excludedOr('ollama') ? skipData('ollama') : getTodaysOllamaFreeModels(),
    (excludedOr('api-airforce') || excludedOr('airforce')) ? skipData('api-airforce') : getTodaysAirforceFreeModels(),
    (excludedOr('bazaarlink') || excludedOr('bzl')) ? skipData('bazaarlink') : getTodaysBazaarlinkFreeModels(),
    (excludedOr('b.ai') || excludedOr('bai')) ? skipData('b.ai') : getTodaysBAiFreeModels(),
    excludedOr('groq') ? skipData('groq') : getTodaysGroqFreeModels(),
    excludedOr('cerebras') ? skipData('cerebras') : getTodaysCerebrasFreeModels(),
    excludedOr('mistral') ? skipData('mistral') : getTodaysMistralFreeModels(),
    excludedOr('cloudflare') ? skipData('cloudflare') : getTodaysCloudflareFreeModels(),
    excludedOr('nvidia') ? skipData('nvidia') : getTodaysNvidiaFreeModels()
  ]);

  const ocData = (excludedOr('opencode') || excludedOr('oc'))
    ? { prefix: 'oc', models: [], excluded: true }
    : getTodaysOpenCodeFreeModels();

  await injectInto9router({
    oa: oaData,
    kilo: kiloData,
    oc: ocData,
    openrouter: orData,
    poolside: poolsideData,
    gemini: geminiData,
    ollama: ollamaData,
    airforce: airforceData,
    bazaarlink: bazaarlinkData,
    bai: baiData,
    groq: groqData,
    cerebras: cerebrasData,
    mistral: mistralData,
    cloudflare: cloudflareData,
    nvidia: nvidiaData
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('[!] Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = {
  getCodingScore,
  sortModelsByCodingQuality,
  getPrioritiesList,
  getModelPriorityRank,
  getModelFullId,
  getBenchmarksDatabase,
  findBenchmarkMatch,
  getUsagePenalty,
  loadUsageFeedback,
  isQuotaExhaustedResult,
  isSmartTierModel,
  isThinkingVariant,
  passesAgenticGate,
  AGENTIC_MIN_CONTEXT,
  computeComboDelta,
  buildDeltaMessage,
  readCurrentComboModels,
  MANAGED_COMBOS,
  getExclusionConfig,
  getExclusionList,
  getExcludedProviders,
  isProviderExcluded,
  isModelExcluded,
  getOpenAgenticCredentials,
  getKiloCredentials,
  getOpenRouterCredentials,
  getPoolsideCredentials,
  getGeminiCredentials,
  getOllamaCredentials,
  getAirforceCredentials,
  getBazaarlinkCredentials,
  getBAiCredentials,
  getGroqCredentials,
  getCerebrasCredentials,
  getMistralCredentials,
  getCloudflareCredentials,
  getNvidiaCredentials,
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenRouterFreeModels,
  getTodaysPoolsideFreeModels,
  getTodaysGeminiFreeModels,
  getTodaysOllamaFreeModels,
  getTodaysAirforceFreeModels,
  getTodaysBazaarlinkFreeModels,
  getTodaysBAiFreeModels,
  getTodaysGroqFreeModels,
  getTodaysCerebrasFreeModels,
  getTodaysMistralFreeModels,
  getTodaysCloudflareFreeModels,
  getTodaysNvidiaFreeModels,
  getTodaysOpenCodeFreeModels,
  testModelWith9router,
  validateCandidateModels,
  scrapeFreeModelsFromWeb,
  fetchFreeModelsFromApi,
  fetchKiloFreeModels,
  fetchOpenRouterFreeModels,
  fetchPoolsideFreeModels,
  fetchGeminiFreeModels,
  fetchOllamaFreeModels,
  fetchAirforceFreeModels,
  fetchBazaarlinkFreeModels,
  fetchOpenAiCompatibleFreeModels,
  fetchCloudflareFreeModels,
  refreshCombos,
  injectInto9router,
  saveCandidateState,
  loadCandidatePool,
  deriveTierLists,
  PROVIDER_COMBO_PREFIXES,
  idMatchesPrefixes,
  getCodingScore
};
