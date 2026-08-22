#!/usr/bin/env node

/**
 * Free Models Sync for 9router
 * (OpenAgentic.id + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama Cloud + API.airforce + Bazaarlink + 9router OpenCode Free)
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
 *   - airforce-free   : Dedicated API.airforce free combo
 *   - bazaarlink-free : Dedicated Bazaarlink free combo
 *   - opencode-free   : Dedicated OpenCode free combo
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
const isCronSetup = args.includes('--setup-cron');
const isSkipTest = args.includes('--skip-test');
const isLiveBenchmarks = args.includes('--live-benchmarks') || args.includes('--update-benchmarks');

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
  const versionMatch = str.match(/(?:v|gpt-|claude-|gemini-|qwen|glm-|kimi-k|mimo-v|minimax-m|step-|lfm-)?(\d+(?:\.\d+)?)/);
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

// Sort models array with User Custom Priorities -> Benchmark Capability -> Latency Tie-Breaker
function sortModelsByCodingQuality(models, latencyMap = null, customPriorities = null) {
  const priorities = customPriorities || getPrioritiesList();
  const benchmarks = getBenchmarksDatabase();

  return [...models].sort((a, b) => {
    const idA = typeof a === 'string' ? a : (a.fullId || a.id || a.name || '');
    const idB = typeof b === 'string' ? b : (b.fullId || b.id || b.name || '');

    const latA = typeof a === 'object' && a.latencyMs != null ? a.latencyMs : (latencyMap ? latencyMap.get(idA) ?? 99999 : 99999);
    const latB = typeof b === 'object' && b.latencyMs != null ? b.latencyMs : (latencyMap ? latencyMap.get(idB) ?? 99999 : 99999);

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

    // 3. Empirical benchmark / capability score
    const scoreA = getCodingScore(idA, benchmarks);
    const scoreB = getCodingScore(idB, benchmarks);

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

/**
 * Pre-test a model via 9router internal test endpoint
 * Filters out dead/expired promotions (401), paid models (402), 404s, and timeouts.
 * Measures response latency (ms) to prioritize faster connections.
 */
async function testModelWith9router(fullModelId, token) {
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

    // Any non-200 (429 quota exceeded, 401 promo ended, 402 paid, 404, timeout) -> Dropped
    const reason = (data.error || `HTTP ${data.status || res.status}`).replace(/\n/g, ' ').slice(0, 75);
    return { valid: false, ok: false, latencyMs, status: data.status || res.status, reason };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return { valid: false, ok: false, latencyMs, reason: err.message.slice(0, 75) };
  }
}

/**
 * Filter model candidate list using exclusions and concurrency pool testing
 */
async function validateCandidateModels(models, prefix, skipTest = false) {
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

  if (skipTest) return nonExcludedModels;

  const token = get9routerCliToken();
  if (!token) {
    console.log('[-] 9router CLI auth token not found or server offline, skipping live test.');
    return nonExcludedModels;
  }

  const validModels = [];
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
        validModels.push({ ...m, latencyMs: result.latencyMs });
      } else {
        console.log(`    [✗ Dropped] ${fullId} -> ${result.reason}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, nonExcludedModels.length) }, () => worker());
  await Promise.all(workers);

  return sortModelsByCodingQuality(validModels);
}

// Inject free models into 9router combos
async function injectInto9router(oaData, kiloData, ocData, orData, poolsideData, geminiData, ollamaData, airforceData, bazaarlinkData) {
  // Validate each source's free models against 9router live test (skip if provider is excluded)
  const validOaModels = oaData?.excluded ? [] : await validateCandidateModels(oaData.models, oaData.prefix, isSkipTest);
  const validKiloModels = kiloData?.excluded ? [] : await validateCandidateModels(kiloData.models, kiloData.prefix, isSkipTest);
  const validOcModels = ocData?.excluded ? [] : await validateCandidateModels(ocData.models, ocData.prefix, isSkipTest);
  const validOrModels = orData?.excluded ? [] : (orData ? await validateCandidateModels(orData.models, orData.prefix, isSkipTest) : []);
  const validPoolsideModels = poolsideData?.excluded ? [] : (poolsideData ? await validateCandidateModels(poolsideData.models, poolsideData.prefix || 'poolside', isSkipTest) : []);
  const validGeminiModels = geminiData?.excluded ? [] : (geminiData ? await validateCandidateModels(geminiData.models, geminiData.prefix || 'gemini', isSkipTest) : []);
  const validOllamaModels = ollamaData?.excluded ? [] : (ollamaData ? await validateCandidateModels(ollamaData.models, ollamaData.prefix || 'ollama', isSkipTest) : []);
  const validAirforceModels = airforceData?.excluded ? [] : (airforceData ? await validateCandidateModels(airforceData.models, airforceData.prefix || 'api-airforce', isSkipTest) : []);
  const validBazaarlinkModels = bazaarlinkData?.excluded ? [] : (bazaarlinkData ? await validateCandidateModels(bazaarlinkData.models, bazaarlinkData.prefix || 'bazaarlink', isSkipTest) : []);

  const oaPrefixed = validOaModels.map(m => `${oaData.prefix}/${m.id}`);
  const kiloPrefixed = validKiloModels.map(m => `${kiloData.prefix}/${m.id}`);
  const ocPrefixed = validOcModels.map(m => m.fullId || `${ocData.prefix}/${m.id}`);
  const orPrefixed = validOrModels.map(m => m.fullId || `${orData.prefix}/${m.id}`);
  const psPrefixed = validPoolsideModels.map(m => m.fullId || `${poolsideData.prefix || 'poolside'}/${m.id}`);
  const geminiPrefixed = validGeminiModels.map(m => m.fullId || `${geminiData.prefix || 'gemini'}/${m.id}`);
  const ollamaPrefixed = validOllamaModels.map(m => m.fullId || `${ollamaData.prefix || 'ollama'}/${m.id}`);
  const airforcePrefixed = validAirforceModels.map(m => m.fullId || `${airforceData.prefix || 'api-airforce'}/${m.id}`);
  const bzlPrefixed = validBazaarlinkModels.map(m => m.fullId || `${bazaarlinkData.prefix || 'bazaarlink'}/${m.id}`);

  // Build global latency lookup map for tie-breaking
  const latencyMap = new Map();
  for (const m of [...validOaModels, ...validKiloModels, ...validOcModels, ...validOrModels, ...validPoolsideModels, ...validGeminiModels, ...validOllamaModels, ...validAirforceModels, ...validBazaarlinkModels]) {
    const key = m.fullId || (m.prefix ? `${m.prefix}/${m.id}` : m.id);
    if (m.latencyMs != null) latencyMap.set(key, m.latencyMs);
  }

  if (!oaData?.excluded) {
    console.log(`\n[+] Validated OpenAgentic: ${validOaModels.length} models:`);
    for (const m of validOaModels) {
      const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
      console.log(`    - ${oaData.prefix}/${m.id} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
    }
  } else {
    console.log(`\n[⊘] OpenAgentic: Skipped (provider excluded)`);
  }

  if (!kiloData?.excluded) {
    console.log(`\n[+] Validated Kilo.ai: ${validKiloModels.length} models:`);
    for (const m of validKiloModels) {
      const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
      console.log(`    - ${kiloData.prefix}/${m.id} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
    }
  } else {
    console.log(`\n[⊘] Kilo.ai: Skipped (provider excluded)`);
  }

  if (!ocData?.excluded) {
    console.log(`\n[+] Validated 9router OpenCode: ${validOcModels.length} models:`);
    for (const m of validOcModels) {
      const rawId = m.fullId || `${ocData.prefix}/${m.id}`;
      const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
      console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
    }
  } else {
    console.log(`\n[⊘] 9router OpenCode: Skipped (provider excluded)`);
  }

  if (orData) {
    if (!orData.excluded) {
      console.log(`\n[+] Validated OpenRouter: ${validOrModels.length} models:`);
      for (const m of validOrModels) {
        const rawId = m.fullId || `${orData.prefix}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] OpenRouter: Skipped (provider excluded)`);
    }
  }

  if (poolsideData) {
    if (!poolsideData.excluded) {
      console.log(`\n[+] Validated Poolside: ${validPoolsideModels.length} models:`);
      for (const m of validPoolsideModels) {
        const rawId = m.fullId || `${poolsideData.prefix || 'poolside'}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] Poolside: Skipped (provider excluded)`);
    }
  }

  if (geminiData) {
    if (!geminiData.excluded) {
      console.log(`\n[+] Validated Gemini: ${validGeminiModels.length} models:`);
      for (const m of validGeminiModels) {
        const rawId = m.fullId || `${geminiData.prefix || 'gemini'}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] Gemini: Skipped (provider excluded)`);
    }
  }

  if (ollamaData) {
    if (!ollamaData.excluded) {
      console.log(`\n[+] Validated Ollama Cloud: ${validOllamaModels.length} models:`);
      for (const m of validOllamaModels) {
        const rawId = m.fullId || `${ollamaData.prefix || 'ollama'}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] Ollama Cloud: Skipped (provider excluded)`);
    }
  }

  if (airforceData) {
    if (!airforceData.excluded) {
      console.log(`\n[+] Validated API.airforce: ${validAirforceModels.length} models:`);
      for (const m of validAirforceModels) {
        const rawId = m.fullId || `${airforceData.prefix || 'api-airforce'}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] API.airforce: Skipped (provider excluded)`);
    }
  }

  if (bazaarlinkData) {
    if (!bazaarlinkData.excluded) {
      console.log(`\n[+] Validated Bazaarlink: ${validBazaarlinkModels.length} models:`);
      for (const m of validBazaarlinkModels) {
        const rawId = m.fullId || `${bazaarlinkData.prefix || 'bazaarlink'}/${m.id}`;
        const latStr = m.latencyMs ? ` [${m.latencyMs}ms]` : '';
        console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}]${latStr} (${m.name})`);
      }
    } else {
      console.log(`\n[⊘] Bazaarlink: Skipped (provider excluded)`);
    }
  }

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  const unifiedList = sortModelsByCodingQuality(Array.from(new Set([...oaPrefixed, ...kiloPrefixed, ...ocPrefixed, ...orPrefixed, ...psPrefixed, ...geminiPrefixed, ...ollamaPrefixed, ...airforcePrefixed, ...bzlPrefixed])), latencyMap);

  // 1. Try updating via 9router API client if server is running
  let updatedViaApi = false;
  try {
    const client = require(CLIENT_PATH);
    if (client && typeof client.getCombos === 'function') {
      const res = await client.getCombos();
      if (res.success && res.data && res.data.combos) {
        const combos = res.data.combos;
        for (const combo of combos) {
          if (combo.name === 'my9model-free') {
            await client.updateCombo(combo.id, { name: combo.name, models: unifiedList });
            console.log(`[✓] Updated combo '${combo.name}' via 9router API (${unifiedList.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'openagentic-free' && !oaData?.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: oaPrefixed });
            console.log(`[✓] Updated combo 'openagentic-free' via 9router API (${oaPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'kilo-free' && !kiloData?.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: kiloPrefixed });
            console.log(`[✓] Updated combo 'kilo-free' via 9router API (${kiloPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'opencode-free' && !ocData?.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: ocPrefixed });
            console.log(`[✓] Updated combo 'opencode-free' via 9router API (${ocPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'openrouter-free' && orData && !orData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: orPrefixed });
            console.log(`[✓] Updated combo 'openrouter-free' via 9router API (${orPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'poolside-free' && poolsideData && !poolsideData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: psPrefixed });
            console.log(`[✓] Updated combo 'poolside-free' via 9router API (${psPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'gemini-free' && geminiData && !geminiData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: geminiPrefixed });
            console.log(`[✓] Updated combo 'gemini-free' via 9router API (${geminiPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'ollama-free' && ollamaData && !ollamaData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: ollamaPrefixed });
            console.log(`[✓] Updated combo 'ollama-free' via 9router API (${ollamaPrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'airforce-free' && airforceData && !airforceData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: airforcePrefixed });
            console.log(`[✓] Updated combo 'airforce-free' via 9router API (${airforcePrefixed.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'bazaarlink-free' && bazaarlinkData && !bazaarlinkData.excluded) {
            await client.updateCombo(combo.id, { name: combo.name, models: bzlPrefixed });
            console.log(`[✓] Updated combo 'bazaarlink-free' via 9router API (${bzlPrefixed.length} models)`);
            updatedViaApi = true;
          }
        }
      }
    }
  } catch {}

  // 2. Direct SQLite update
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH);
    const existingCombos = db.prepare("SELECT * FROM combos").all();
    const now = new Date().toISOString();

    function upsertCombo(comboName, modelList) {
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

    upsertCombo('my9model-free', unifiedList);
    if (!oaData?.excluded) upsertCombo('openagentic-free', oaPrefixed);
    if (kiloPrefixed.length > 0 && !kiloData?.excluded) upsertCombo('kilo-free', kiloPrefixed);
    if (ocPrefixed.length > 0 && !ocData?.excluded) upsertCombo('opencode-free', ocPrefixed);
    if (orPrefixed.length > 0 && !orData?.excluded) upsertCombo('openrouter-free', orPrefixed);
    if (psPrefixed.length > 0 && !poolsideData?.excluded) upsertCombo('poolside-free', psPrefixed);
    if (geminiPrefixed.length > 0 && !geminiData?.excluded) upsertCombo('gemini-free', geminiPrefixed);
    if (ollamaPrefixed.length > 0 && !ollamaData?.excluded) upsertCombo('ollama-free', ollamaPrefixed);
    if (airforcePrefixed.length > 0 && !airforceData?.excluded) upsertCombo('airforce-free', airforcePrefixed);
    if (bzlPrefixed.length > 0 && !bazaarlinkData?.excluded) upsertCombo('bazaarlink-free', bzlPrefixed);

    db.close();
  } catch (err) {
    if (!updatedViaApi) {
      console.error(`[X] Error updating 9router database: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n[🎉] Synchronization completed successfully.');
}

// Setup daily cron job
function setupDailyCron() {
  console.log('[*] Setting up daily cron job...');
  const scriptPath = path.resolve(__filename);
  const logPath = path.join(path.dirname(scriptPath), 'sync.log');
  const cronSchedule = `5 0 * * * /usr/bin/node ${scriptPath} >> ${logPath} 2>&1`;

  try {
    let currentCrontab = '';
    try {
      currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    } catch {}

    const filtered = currentCrontab.split('\n')
      .filter(line => !line.includes('9router-auto-free') && !line.includes(scriptPath))
      .filter(line => line.trim().length > 0);

    filtered.push(`# Daily Free Models Sync for 9router (herliansyah@gmail.com)`);
    filtered.push(cronSchedule);

    const newCrontab = filtered.join('\n') + '\n';
    execSync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`);
    console.log(`[✓] Daily cron installed! Will run every day at 00:05 AM.`);
    console.log(`    Schedule: ${cronSchedule}`);
    console.log(`    Log file: ${logPath}`);
  } catch (err) {
    console.error(`[X] Failed to install crontab: ${err.message}`);
    console.log(`    You can manually add this to 'crontab -e':\n    ${cronSchedule}`);
  }
}

// Main execution
async function main() {
  console.log('====================================================');
  console.log('  Free Models Sync -> 9router Combos               ');
  console.log('  Sources: OpenAgentic + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama + Airforce + Bazaarlink + OC');
  console.log('  Account: herliansyah@gmail.com                   ');
  console.log('  Pre-testing: Auto-drop expired & non-free models ');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  if (isCronSetup) {
    setupDailyCron();
  }

  if (isLiveBenchmarks) {
    try {
      const { updateBenchmarks } = require('./update-benchmarks.js');
      await updateBenchmarks();
    } catch (err) {
      console.warn(`[!] Failed to update live benchmarks: ${err.message}`);
    }
  }

  const excludedProviders = getExcludedProviders();
  if (excludedProviders.length > 0) {
    console.log(`[⊘] Excluded providers via config (${excludedProviders.length}): ${excludedProviders.join(', ')}\n`);
  }

  const [oaData, kiloData, orData, poolsideData, geminiData, ollamaData, airforceData, bazaarlinkData] = await Promise.all([
    isProviderExcluded('openagentic', excludedProviders)
      ? Promise.resolve({ prefix: 'openagentic', models: [], excluded: true })
      : getTodaysOpenAgenticFreeModels(),
    isProviderExcluded('kilocode', excludedProviders) || isProviderExcluded('kilo', excludedProviders)
      ? Promise.resolve({ prefix: 'kc', models: [], excluded: true })
      : getTodaysKiloFreeModels(),
    isProviderExcluded('openrouter', excludedProviders)
      ? Promise.resolve({ prefix: 'openrouter', models: [], excluded: true })
      : getTodaysOpenRouterFreeModels(),
    isProviderExcluded('poolside', excludedProviders)
      ? Promise.resolve({ prefix: 'poolside', models: [], excluded: true })
      : getTodaysPoolsideFreeModels(),
    isProviderExcluded('gemini', excludedProviders)
      ? Promise.resolve({ prefix: 'gemini', models: [], excluded: true })
      : getTodaysGeminiFreeModels(),
    isProviderExcluded('ollama', excludedProviders)
      ? Promise.resolve({ prefix: 'ollama', models: [], excluded: true })
      : getTodaysOllamaFreeModels(),
    isProviderExcluded('api-airforce', excludedProviders) || isProviderExcluded('airforce', excludedProviders)
      ? Promise.resolve({ prefix: 'api-airforce', models: [], excluded: true })
      : getTodaysAirforceFreeModels(),
    isProviderExcluded('bazaarlink', excludedProviders) || isProviderExcluded('bzl', excludedProviders)
      ? Promise.resolve({ prefix: 'bazaarlink', models: [], excluded: true })
      : getTodaysBazaarlinkFreeModels()
  ]);

  const ocData = isProviderExcluded('opencode', excludedProviders) || isProviderExcluded('oc', excludedProviders)
    ? { prefix: 'oc', models: [], excluded: true }
    : getTodaysOpenCodeFreeModels();

  await injectInto9router(oaData, kiloData, ocData, orData, poolsideData, geminiData, ollamaData, airforceData, bazaarlinkData);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[!] Unhandled error:`, err);
    process.exit(1);
  });
}

module.exports = {
  getCodingScore,
  sortModelsByCodingQuality,
  getPrioritiesList,
  getModelPriorityRank,
  getBenchmarksDatabase,
  findBenchmarkMatch,
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
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenRouterFreeModels,
  getTodaysPoolsideFreeModels,
  getTodaysGeminiFreeModels,
  getTodaysOllamaFreeModels,
  getTodaysAirforceFreeModels,
  getTodaysBazaarlinkFreeModels,
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
  injectInto9router
};
