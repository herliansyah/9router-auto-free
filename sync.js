#!/usr/bin/env node

/**
 * Free Models Sync for 9router
 *
 * Automatically synchronizes free models across all registered providers,
 * pre-tests all candidates against 9router to drop expired/dead/paid models,
 * sorts them by coding capability specification, and injects valid models
 * into 9router combos (my9model-free, smart, fast, cooldown + per-provider combos).
 *
 * Modes:
 *   node sync.js              -> Full daily sync (scrape + live-test + inject)
 *   node sync.js --refresh    -> Intra-day watchdog: re-test existing combo models,
 *                                park quota-exhausted (429) in my9model-cooldown
 *   node sync.js --dry-run    -> Simulate without writing
 *   node sync.js --setup-cron -> Install scheduler (systemd timer w/ Persistent=true, cron fallback)
 */

const fs = require('node:fs');
const path = require('node:path');

// Deep modules
const storage = require('./storage.js');
const scheduler = require('./scheduler.js');
const { PROVIDERS, PROVIDER_BY_KEY, providerByPrefix, discoverProvider, discoverAllProviders, getProviderCredentials } = require('./providers.js');
const { BENCHMARKS_PATH, SMART_MIN_SCORE } = require('./update-benchmarks.js');

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
const CANDIDATES_STATE_PATH = path.join(__dirname, 'candidates-state.json'); // last full-sync candidate pool
const EXCLUSIONS_PATH = path.join(__dirname, 'exclusions.json');
const PRIORITIES_PATH = path.join(__dirname, 'priorities.json');
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PROVIDER_PREFIX_RE = new RegExp(
  `^(?:${PROVIDERS.flatMap(p => p.prefixes).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})/`
);

// Managed combos registry
const MANAGED_COMBOS = [
  'my9model-free', 'my9model-smart', 'my9model-fast', 'my9model-cooldown',
  ...PROVIDERS.map(p => p.combo)
];

const PROVIDER_COMBO_PREFIXES = Object.fromEntries(PROVIDERS.map(p => [p.combo, p.prefixes]));

function getDynamicManagedCombos() {
  const dynamicProviders = storage.getDynamicProviders ? storage.getDynamicProviders() : [];
  return [
    'my9model-free', 'my9model-smart', 'my9model-fast', 'my9model-cooldown',
    ...PROVIDERS.map(p => p.combo),
    ...dynamicProviders.map(p => p.combo)
  ];
}

function getDynamicProviderComboPrefixes() {
  const base = Object.fromEntries(PROVIDERS.map(p => [p.combo, p.prefixes]));
  const dynamicProviders = storage.getDynamicProviders ? storage.getDynamicProviders() : [];
  for (const dp of dynamicProviders) {
    base[dp.combo] = dp.prefixes || [dp.prefix];
  }
  return base;
}

function idMatchesPrefixes(fullId, prefixes) {
  const head = String(fullId).split('/')[0].toLowerCase();
  return (prefixes || []).some(p => p.toLowerCase() === head);
}

// ----------------------------------------------------------------------------
// Exclusion Rules Configuration
// ----------------------------------------------------------------------------

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

  const cliExcludeArg = args.find(a => a.startsWith('--exclude-provider='));
  if (cliExcludeArg) {
    const raw = cliExcludeArg.split('=')[1] || '';
    const cliExcluded = raw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    excludedProviders = Array.from(new Set([...excludedProviders, ...cliExcluded]));
  }

  return { excludedModels, excludedProviders };
}

function getExclusionList() {
  return getExclusionConfig().excludedModels;
}

function getExcludedProviders() {
  return getExclusionConfig().excludedProviders;
}

function isProviderExcluded(providerName, excludedProviders = null) {
  const excluded = excludedProviders || getExcludedProviders();
  const name = String(providerName || '').trim().toLowerCase();
  if (!name) return false;
  return excluded.includes(name);
}

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

// ----------------------------------------------------------------------------
// Signals: Benchmarks, Priorities, Usage Penalties
// ----------------------------------------------------------------------------

function getBenchmarksDatabase() {
  try {
    if (fs.existsSync(BENCHMARKS_PATH)) {
      return JSON.parse(fs.readFileSync(BENCHMARKS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read benchmarks.json: ${err.message}`);
  }
  return {};
}

function findBenchmarkMatch(modelIdentifier, benchmarks) {
  if (!benchmarks) return null;
  const rawId = String(modelIdentifier).toLowerCase();
  const strippedId = rawId.replace(PROVIDER_PREFIX_RE, '').replace(/:free$/, '');
  const baseName = strippedId.split('/').pop();

  if (benchmarks[strippedId]) return benchmarks[strippedId];
  if (benchmarks[baseName]) return benchmarks[baseName];

  for (const [key, data] of Object.entries(benchmarks)) {
    if (strippedId.includes(key) || baseName.includes(key)) return data;
  }
  return null;
}

function getCodingScore(modelIdentifier, customBenchmarks = null) {
  const benchmarks = customBenchmarks || getBenchmarksDatabase();
  const match = findBenchmarkMatch(modelIdentifier, benchmarks);
  if (match && typeof match.score === 'number') {
    return match.score * 100;
  }

  const id = String(modelIdentifier).toLowerCase();
  let baseScore = 4000;

  if (id.includes('claude') || id.includes('sonnet') || id.includes('opus')) baseScore = 8000;
  else if (id.includes('gemini') || id.includes('gpt-4') || id.includes('o1') || id.includes('o3') || id.includes('r1')) baseScore = 7500;
  else if (id.includes('qwen') || id.includes('deepseek') || id.includes('codestral') || id.includes('mistral') || id.includes('devin') || id.includes('glm')) baseScore = 6500;
  else if (id.includes('coder') || id.includes('code') || id.includes('instruct')) baseScore = 5500;
  else if (id.includes('flash') || id.includes('mini') || id.includes('small') || id.includes('lite') || id.includes('nano')) baseScore = 4500;

  if (id.includes('preview') || id.includes('thinking') || id.includes('reasoner')) baseScore += 500;

  const versionMatch = id.match(/(?:^|[^\d])(\d+(?:\.\d+)+)(?:[^\d]|$)/);
  if (versionMatch) {
    const versionNum = parseFloat(versionMatch[1]);
    if (!isNaN(versionNum) && versionNum < 20) {
      baseScore += Math.min(versionNum * 50, 500);
    }
  }

  if (id.includes('embed') || id.includes('image') || id.includes('vision') || id.includes('audio') || id.includes('tts') || id.includes('whisper') || id.includes('flux') || id.includes('diffusion')) {
    baseScore = -10000;
  }

  return baseScore;
}

function getPrioritiesList() {
  try {
    if (fs.existsSync(PRIORITIES_PATH)) {
      const data = JSON.parse(fs.readFileSync(PRIORITIES_PATH, 'utf8'));
      if (Array.isArray(data)) {
        return data.map(item => String(item).trim().toLowerCase()).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn(`[!] Warning: Could not read priorities.json: ${err.message}`);
  }
  return [];
}

function getModelPriorityRank(modelIdentifier, priorities) {
  if (!Array.isArray(priorities) || priorities.length === 0) return Infinity;
  const target = String(modelIdentifier).toLowerCase();
  for (let i = 0; i < priorities.length; i++) {
    const p = priorities[i];
    if (!p) continue;
    if (target.includes(p)) return i;
  }
  return Infinity;
}

function loadUsageFeedback(forceReload = false) {
  return storage.readUsageFeedback();
}

function getUsagePenalty(fullId, usageStats = null) {
  const stats = usageStats || loadUsageFeedback();
  if (!stats || stats.size === 0) return 0;

  const slashIdx = String(fullId).indexOf('/');
  if (slashIdx === -1) return 0;
  const prefix = String(fullId).slice(0, slashIdx).toLowerCase();
  const modelId = String(fullId).slice(slashIdx + 1).toLowerCase();

  const providerRec = providerByPrefix(prefix);
  const providerKey = providerRec?.usageName || prefix;

  const key = `${providerKey}|${modelId}`;
  const entry = stats.get(key);
  if (!entry) return 0;

  const total = entry.ok + entry.err;
  if (total < 5) return 0;

  const errorRate = entry.err / total;
  if (errorRate >= 0.8) return -800;
  if (errorRate >= 0.5) return -400;
  return 0;
}

function getModelFullId(m) {
  return typeof m === 'object' && m !== null ? (m.fullId || m.id) : String(m);
}

function classifyTestResult(result) {
  if (!result) return 'dead';
  const lat = typeof result.latencyMs === 'number' ? result.latencyMs : 0;
  if (result.quotaExhausted === true || isParkedLatency(lat)) return 'quota';
  if (result.valid === true || result.ok === true) return 'active';
  return 'dead';
}

function isParkedLatency(latencyMs) {
  return typeof latencyMs === 'number' && latencyMs >= QUOTA_LATENCY_SENTINEL;
}

function isThinkingVariant(modelIdentifier) {
  return /thinking|reasoning|reasoner/.test(String(modelIdentifier).toLowerCase());
}

function isSmartTierModel(modelIdentifier, benchmarks = null) {
  const str = String(modelIdentifier).toLowerCase();
  if (/thinking|reasoning|reasoner|r1\b/.test(str)) return true;
  const match = findBenchmarkMatch(str, benchmarks || getBenchmarksDatabase());
  return Boolean(match && typeof match.score === 'number' && match.score >= SMART_MIN_SCORE);
}

function passesAgenticGate(meta) {
  if (!meta) return true;
  if (meta.toolsUnsupported === true) return false;
  if (meta.contextLength != null && meta.contextLength > 0 && meta.contextLength < AGENTIC_MIN_CONTEXT) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Candidate Sorting & Assembly Pipeline (Candidate 3)
// ----------------------------------------------------------------------------

function sortModelsByCodingQuality(models, latencyMap = null, customPriorities = null, signals = null) {
  const priorities = (signals && signals.priorities) || customPriorities || getPrioritiesList();
  const benchmarks = (signals && signals.benchmarks) || getBenchmarksDatabase();
  const usageStats = (signals && signals.usageStats) || loadUsageFeedback();

  const getLatency = m => {
    if (typeof m === 'object' && m !== null && typeof m.latencyMs === 'number') return m.latencyMs;
    const fullId = getModelFullId(m);
    if (latencyMap && latencyMap.has(fullId)) return latencyMap.get(fullId);
    return 9999;
  };

  return [...models].sort((a, b) => {
    const idA = getModelFullId(a);
    const idB = getModelFullId(b);

    const latA = getLatency(a);
    const latB = getLatency(b);

    const quotaA = Boolean((typeof a === 'object' && a?.quotaExhausted) || isParkedLatency(latA));
    const quotaB = Boolean((typeof b === 'object' && b?.quotaExhausted) || isParkedLatency(latB));

    if (quotaA !== quotaB) return quotaA ? 1 : -1;

    const rankA = getModelPriorityRank(idA, priorities);
    const rankB = getModelPriorityRank(idB, priorities);

    if (rankA !== rankB) return rankA - rankB;

    const penaltyA = getUsagePenalty(idA, usageStats);
    const penaltyB = getUsagePenalty(idB, usageStats);

    const scoreA = getCodingScore(idA, benchmarks) + penaltyA;
    const scoreB = getCodingScore(idB, benchmarks) + penaltyB;

    if (scoreB !== scoreA) return scoreB - scoreA;

    return latA - latB;
  });
}

function deriveTierLists(rankedAll, benchmarks = null) {
  let smartList = rankedAll.filter(id => isSmartTierModel(id, benchmarks));
  let fastList = rankedAll.filter(id => !isSmartTierModel(id, benchmarks) && !isThinkingVariant(id));
  if (smartList.length < 3) smartList = rankedAll.slice(0, 5);
  if (fastList.length < 3) fastList = rankedAll.slice(0, 5);
  return { smartList, fastList };
}

function buildComboMap({ free = [], cooldown = [], smart, fast, providers = [] }) {
  const comboMap = new Map([
    ['my9model-free', free],
    ['my9model-cooldown', cooldown],
  ]);
  if (Array.isArray(smart)) comboMap.set('my9model-smart', smart);
  if (Array.isArray(fast)) comboMap.set('my9model-fast', fast);
  for (const [name, ids] of providers) comboMap.set(name, ids);
  return comboMap;
}

/**
 * Deep ranking and assembly interface:
 * Consolidates agentic gating, quality ranking, and multi-tier partitioning into one pure call.
 */
function assembleCombos({ candidates, latencyMap = new Map(), metaMap = new Map(), signals = null }) {
  const allIds = Array.from(new Set(candidates.map(getModelFullId)));

  // Super-combo agentic readiness gate
  const gatedIds = allIds.filter(id => passesAgenticGate(metaMap.get(id)));
  const gatedActiveIds = gatedIds.filter(id => !isParkedLatency(latencyMap.get(id) ?? 0));
  const gatedQuotaIds = gatedIds.filter(id => !gatedActiveIds.includes(id));

  const unifiedList = sortModelsByCodingQuality(gatedActiveIds, latencyMap, null, signals);
  const cooldownList = sortModelsByCodingQuality(gatedQuotaIds, latencyMap, null, signals);
  const tiers = deriveTierLists(unifiedList, signals?.benchmarks);

  return {
    unified: unifiedList,
    cooldown: cooldownList,
    smart: tiers.smartList,
    fast: tiers.fastList,
    gatedOutCount: allIds.length - gatedIds.length
  };
}

// ----------------------------------------------------------------------------
// Pre-Testing Engine
// ----------------------------------------------------------------------------

async function testModelWith9router(fullModelId, token, attempt = 1, fetchImpl = null) {
  if (!token) return { valid: true, ok: true, latencyMs: 9999, verdict: 'active', note: '9router token unavailable' };

  const doFetch = fetchImpl || fetch;
  const startTime = Date.now();
  const routerUrl = storage.resolveNineRouterUrl ? storage.resolveNineRouterUrl() : (process.env.NINEROUTER_URL || 'http://127.0.0.1:20128');
  try {
    const res = await doFetch(`${routerUrl}/api/models/test`, {
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

    if (data.ok) return { valid: true, ok: true, latencyMs, verdict: 'active' };

    const status = Number(data.status || res.status);
    const fullReason = String(data.error || `HTTP ${data.status || res.status}`).replace(/\s+/g, ' ').trim();
    const reason = fullReason.slice(0, 75);
    const quotaish = status === 429 || /quota|rate.?limit|resource.?exhaust|capacity/i.test(fullReason.slice(0, 400));

    if (TRANSIENT_HTTP_STATUSES.has(status) && attempt < 2) {
      await new Promise(r => setTimeout(r, QUOTA_RETRY_DELAY_MS));
      return { ...(await testModelWith9router(fullModelId, token, attempt + 1, fetchImpl)), retried: true };
    }

    const result = { valid: false, ok: false, latencyMs, status, reason };
    if (quotaish) result.quotaExhausted = true;
    result.verdict = quotaish ? 'quota' : 'dead';
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, QUOTA_RETRY_DELAY_MS));
      return { ...(await testModelWith9router(fullModelId, token, attempt + 1, fetchImpl)), retried: true };
    }
    const result = { valid: false, ok: false, latencyMs, reason: err.message.slice(0, 75), verdict: 'dead' };
    if (/timed?\s*out|abort/i.test(err.message)) result.timedOut = true;
    return result;
  }
}

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

  const token = storage.get9routerCliToken();
  if (!token) {
    console.log('[-] 9router CLI auth token not found or server offline, skipping live test.');
    return nonExcludedModels;
  }

  const activeModels = [];
  const quotaLimitedModels = [];
  const providerRecord = providerByPrefix(prefix);
  const concurrency = providerRecord?.solo ? 1 : 5;
  const queue = [...nonExcludedModels];

  console.log(`[*] Pre-testing ${nonExcludedModels.length} candidate models for [${prefix}]...`);

  async function worker() {
    while (queue.length > 0) {
      const m = queue.shift();
      const fullId = m.fullId || `${prefix}/${m.id}`;

      if (providerRecord?.throttleMs) await new Promise(r => setTimeout(r, providerRecord.throttleMs));

      const result = await testModelWith9router(fullId, token);
      const verdict = classifyTestResult(result);

      if (verdict === 'active') {
        const msText = `${result.latencyMs}ms`;
        console.log(`    [✓ Active] ${fullId} (${msText}) ${result.note ? '(' + result.note + ')' : ''}`);
        activeModels.push({ ...m, latencyMs: result.latencyMs });
      } else if (verdict === 'quota') {
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

// ----------------------------------------------------------------------------
// Notifications & State Persistence
// ----------------------------------------------------------------------------

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
  if (tgToken && tgChat) jobs.push(post('telegram', `https://api.telegram.org/bot${tgToken}/sendMessage`, { chat_id: tgChat, text }));
  if (discordUrl) jobs.push(post('discord', discordUrl, { content: text }));

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

function computeComboDelta(oldList, newList) {
  const oldSet = new Set((oldList || []).map(String));
  const newSet = new Set((newList || []).map(String));
  return {
    added: [...newSet].filter(id => !oldSet.has(id)),
    removed: [...oldSet].filter(id => !newSet.has(id))
  };
}

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

async function persistAndNotifyCombos(comboMap, mode = 'daily-sync') {
  const previousUnified = storage.readCurrentComboModels('my9model-free');
  const delta = computeComboDelta(previousUnified, comboMap.get('my9model-free') || []);

  await storage.persistCombos(comboMap);

  try {
    await sendTextNotification(buildDeltaMessage({
      mode,
      added: delta.added,
      removed: delta.removed,
      total: (comboMap.get('my9model-free') || []).length
    }));
  } catch {}
}

// ----------------------------------------------------------------------------
// Core Orchestration: Full Sync & Watchdog Refresh
// ----------------------------------------------------------------------------

async function refreshCombos() {
  console.log('[*] Watchdog refresh: re-testing existing combo members (no discovery)...');
  const token = storage.get9routerCliToken();
  if (!token) {
    console.error('[X] 9router CLI auth token unavailable; live re-test impossible. Aborting without changes.');
    process.exit(1);
  }

  const current = new Map();
  for (const name of MANAGED_COMBOS) {
    const models = storage.readCurrentComboModels(name);
    if (models.length > 0) current.set(name, models);
  }
  const previousMembers = new Set(MANAGED_COMBOS.flatMap(n => current.get(n) || []));

  const candidatePool = loadCandidatePool();
  const poolIds = Array.from(new Set([...candidatePool.values()].flatMap(s => [...s])));
  if (poolIds.length > 0) {
    console.log(`[*] Candidate pool: ${poolIds.length} ids from last full sync (recovered models can rejoin).`);
  }

  const superIds = current.get('my9model-free') || [];
  const extraSuper = new Set([
    ...(current.get('my9model-smart') || []),
    ...(current.get('my9model-fast') || []),
    ...(current.get('my9model-cooldown') || [])
  ]);
  const dynamicManagedCombos = getDynamicManagedCombos();
  const dynamicPrefixesMap = getDynamicProviderComboPrefixes();

  const allIds = Array.from(new Set([
    ...superIds,
    ...extraSuper,
    ...dynamicManagedCombos.filter(n => !n.startsWith('my9model')).flatMap(n => current.get(n) || []),
    ...poolIds
  ]));

  if (allIds.length === 0) {
    console.log('[!] No managed combos found to refresh. Run a full sync first.');
    return;
  }

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
      const throttled = providerByPrefix(providerPrefix);
      if (throttled?.throttleMs) await new Promise(r => setTimeout(r, throttled.throttleMs));

      const result = await testModelWith9router(fullId, token);
      const verdict = classifyTestResult(result);
      if (verdict === 'active') {
        latencyRefresh.set(fullId, result.latencyMs);
        activeSet.add(fullId);
      } else if (verdict === 'quota') {
        console.log(`    [⏳ Quota] ${fullId} demoted to bottom (${result.reason})`);
        quotaSet.add(fullId);
      } else {
        console.log(`    [✗ Removed] ${fullId} -> ${result.reason}${result.retried ? ' (after retry)' : ''}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allIds.length) }, () => worker()));

  const rankedActive = sortModelsByCodingQuality(Array.from(activeSet), latencyRefresh);
  const rankedQuota = sortModelsByCodingQuality(Array.from(quotaSet), latencyRefresh);

  let recoveredCount = 0;
  for (const id of activeSet) {
    if (!previousMembers.has(id)) recoveredCount++;
  }

  const tiers = deriveTierLists(rankedActive);

  const providerEntries = [];
  for (const name of dynamicManagedCombos) {
    if (name.startsWith('my9model')) continue;
    const prefixes = dynamicPrefixesMap[name];
    if (!prefixes) continue;
    const eligible = new Set([
      ...(current.get(name) || []),
      ...poolIds.filter(id => idMatchesPrefixes(id, prefixes))
    ]);
    if (eligible.size === 0) continue;
    providerEntries.push([name, rankedActive.filter(id => eligible.has(id))]);
  }

  const comboMap = buildComboMap({
    free: rankedActive,
    cooldown: rankedQuota,
    smart: tiers.smartList.length > 0 ? tiers.smartList : undefined,
    fast: tiers.fastList.length > 0 ? tiers.fastList : undefined,
    providers: providerEntries
  });

  console.log(`\n[Σ] Refresh result: ${activeSet.size} active, ${quotaSet.size} parked in cooldown, ${allIds.length - activeSet.size - quotaSet.size} removed permanently, ${recoveredCount} recovered into provider combos.`);

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  await persistAndNotifyCombos(comboMap, 'watchdog-refresh');
  console.log('\n[🎉] Watchdog refresh completed successfully.');
}

async function injectInto9router(providers) {
  const p = providers || {};
  const allKeys = new Set([...PROVIDERS.map(r => r.key), ...Object.keys(p)]);
  const defs = Array.from(allKeys).map(key => {
    const rec = PROVIDERS.find(r => r.key === key);
    const data = p[key] || (rec ? { prefix: rec.prefixes[0], models: [], excluded: true } : { prefix: key, models: [], excluded: true });
    const label = data.label || rec?.label || key;
    const combo = data.combo || rec?.combo || `${data.prefix || key}-free`;
    return [key, data, label, combo];
  });

  for (const [key, data] of defs) {
    if (data && !data.excluded && Array.isArray(data.models)) {
      data.validated = await validateCandidateModels(data.models, data.prefix);
    } else {
      data.validated = [];
    }
  }

  const prefixedByProvider = {};
  const activeByProvider = {};
  const metaMap = new Map();
  const latencyMap = new Map();

  for (const [key, data] of defs) {
    const prefix = data.prefix;
    prefixedByProvider[key] = (data.validated || []).map(m => m.fullId || `${prefix}/${m.id}`);
    activeByProvider[key] = (data.validated || [])
      .filter(m => classifyTestResult({ valid: true, latencyMs: m.latencyMs }) === 'active')
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

  const allCandidates = defs.flatMap(([key]) => prefixedByProvider[key]);
  const assembled = assembleCombos({
    candidates: allCandidates,
    latencyMap,
    metaMap
  });

  if (assembled.gatedOutCount > 0) {
    console.log(`\n[⚙] Agentic gate: ${assembled.gatedOutCount} model(s) left out of super-combo (no tools support or context < ${AGENTIC_MIN_CONTEXT}). Still kept in their dedicated provider combo.`);
  }

  console.log(`\n[+] Super-combo my9model-free: ${assembled.unified.length} models (all active)`);
  console.log(`[+] my9model-smart: ${assembled.smart.length} models | my9model-fast: ${assembled.fast.length} models`);
  console.log(`[+] my9model-cooldown: ${assembled.cooldown.length} model(s) parked (quota-exhausted)`);

  for (const [key, data, label, combo] of defs) {
    if (!data.excluded && (data.validated || []).length > 0 && activeByProvider[key].length === 0) {
      console.log(`[i] ${label}: all ${(data.validated || []).length} models currently quota-exhausted — ${combo} cleared until they recover.`);
    }
  }

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  const providerEntries = defs
    .map(([key, data, label, combo]) => {
      const list = (!data?.excluded && (data?.validated?.length || 0) > 0) ? activeByProvider[key] : null;
      return list ? [combo, list] : null;
    })
    .filter(Boolean);

  await persistAndNotifyCombos(buildComboMap({
    free: assembled.unified,
    smart: assembled.smart,
    fast: assembled.fast,
    cooldown: assembled.cooldown,
    providers: providerEntries
  }), 'daily-sync');

  saveCandidateState(defs, prefixedByProvider);
  console.log('\n[🎉] Synchronization completed successfully.');
}

async function main() {
  const mode = isRefreshMode ? 'WATCHDOG REFRESH' : (isCronSetup ? 'SETUP SCHEDULER' : 'DAILY FULL SYNC');
  console.log('====================================================');
  console.log('  Free Models Sync -> 9router Combos               ');
  console.log('  Sources: OpenAgentic + Kilo + OpenRouter + Poolside + Gemini + Ollama + Airforce + Bazaarlink + B.ai');
  console.log('           + Groq + Cerebras + Mistral + Cloudflare AI + NVIDIA NIM + OC');
  console.log(`  Mode: ${mode}  `);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  if (args.includes('--web') || args.includes('--ui')) {
    require('./web.js');
    return;
  }

  if (isCronSetup) {
    scheduler.installScheduler();
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

  const results = await discoverAllProviders({ excludedProviders });
  await injectInto9router(results);
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
  isSmartTierModel,
  isThinkingVariant,
  passesAgenticGate,
  AGENTIC_MIN_CONTEXT,
  QUOTA_LATENCY_SENTINEL,
  TRANSIENT_HTTP_STATUSES,
  classifyTestResult,
  isParkedLatency,
  buildComboMap,
  computeComboDelta,
  buildDeltaMessage,
  readCurrentComboModels: storage.readCurrentComboModels,
  MANAGED_COMBOS,
  getExclusionConfig,
  getExclusionList,
  getExcludedProviders,
  isProviderExcluded,
  isModelExcluded,
  getProviderCredentials,
  discoverProvider,
  discoverAllProviders,
  testModelWith9router,
  validateCandidateModels,
  refreshCombos,
  injectInto9router,
  assembleCombos,
  saveCandidateState,
  loadCandidatePool,
  deriveTierLists,
  PROVIDER_COMBO_PREFIXES,
  idMatchesPrefixes,
  PROVIDERS,
  PROVIDER_BY_KEY,
  providerByPrefix
};
