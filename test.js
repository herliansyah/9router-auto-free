/**
 * Ponytail test check for 9router free sync
 * Minimal assert-based self check.
 */

const assert = require('node:assert');
const {
  QUOTA_LATENCY_SENTINEL,
  MANAGED_COMBOS,
  PROVIDER_COMBO_PREFIXES,
  PROVIDERS,
  findBenchmarkMatch,
  getBenchmarksDatabase,
  getProviderCredentials,
  getCodingScore,
  sortModelsByCodingQuality,
  getPrioritiesList,
  getModelPriorityRank,
  getOpenAgenticCredentials,
  getKiloCredentials,
  getOpenRouterCredentials,
  getPoolsideCredentials,
  getGeminiCredentials,
  getOllamaCredentials,
  getAirforceCredentials,
  getBazaarlinkCredentials,
  getBAiCredentials,
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenRouterFreeModels,
  getTodaysPoolsideFreeModels,
  getTodaysGeminiFreeModels,
  getTodaysOllamaFreeModels,
  getTodaysAirforceFreeModels,
  getTodaysBazaarlinkFreeModels,
  getTodaysBAiFreeModels,
  getNvidiaCredentials,
  getTodaysNvidiaFreeModels,
  getTodaysOpenCodeFreeModels,
  testModelWith9router
} = require('./sync.js');

async function runTests() {
  console.log('[*] Running tests for Free Sync (OpenAgentic + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama Cloud + API.airforce + Bazaarlink + B.ai + 9router OpenCode)...');

  // 1. Coding score & Benchmark tests
  console.log('[-] Testing coding benchmark score & sorting...');
  const { getBenchmarksDatabase, findBenchmarkMatch } = require('./sync.js');
  const bDb = getBenchmarksDatabase();
  assert.ok(Object.keys(bDb).length > 0, 'Benchmarks database must not be empty');

  const matchSonnet = findBenchmarkMatch('assistant-sonnet-4.5-thinking', bDb);
  assert.ok(matchSonnet && matchSonnet.score >= 80, 'Claude Sonnet 4.5 must have benchmark score >= 80');

  const scoreSonnet = getCodingScore('assistant-sonnet-4.5-thinking', bDb);
  const scoreStep = getCodingScore('stepfun/step-3.7-flash:free', bDb);
  assert.ok(scoreSonnet > scoreStep, 'Claude Sonnet 4.5 must score higher than Step 3.7 Flash');

  // 2. OpenAgentic Credential & Discovery Test
  console.log('[-] Testing OpenAgentic discovery...');
  const oaCreds = getOpenAgenticCredentials();
  assert.ok(oaCreds.prefix.length > 0, 'OpenAgentic prefix must not be empty');
  const oaData = await getTodaysOpenAgenticFreeModels();
  console.log(`    Found ${oaData.models.length} OpenAgentic candidate free models`);
  assert.ok(oaData.models.length > 0, 'Should find OpenAgentic free models');

  // 3. Kilo.ai Credential & Discovery Test
  console.log('[-] Testing Kilo.ai discovery...');
  const kiloCreds = getKiloCredentials();
  assert.strictEqual(kiloCreds.prefix, 'kc', 'Kilo prefix must be kc');
  const kiloData = await getTodaysKiloFreeModels();
  console.log(`    Found ${kiloData.models.length} Kilo.ai candidate free models`);
  assert.ok(kiloData.models.length > 0, 'Should find Kilo.ai free models');

  // 4. OpenRouter Credential & Discovery Test
  console.log('[-] Testing OpenRouter discovery...');
  const orCreds = getOpenRouterCredentials();
  assert.strictEqual(orCreds.prefix, 'openrouter', 'OpenRouter prefix must be openrouter');
  const orData = await getTodaysOpenRouterFreeModels();
  console.log(`    Found ${orData.models.length} OpenRouter candidate free models`);
  assert.ok(orData.models.length > 0, 'Should find OpenRouter free models');

  // 5. Poolside Credential & Discovery Test
  console.log('[-] Testing Poolside discovery...');
  const psCreds = getPoolsideCredentials();
  assert.strictEqual(psCreds.prefix, 'poolside', 'Poolside prefix must be poolside');
  const psData = await getTodaysPoolsideFreeModels();
  console.log(`    Found ${psData.models.length} Poolside candidate free models`);
  assert.ok(psData.models.length > 0, 'Should find Poolside free models');

  // 6. Gemini Credential & Discovery Test
  console.log('[-] Testing Gemini discovery...');
  const geminiCreds = getGeminiCredentials();
  assert.strictEqual(geminiCreds.prefix, 'gemini', 'Gemini prefix must be gemini');
  const geminiData = await getTodaysGeminiFreeModels();
  console.log(`    Found ${geminiData.models.length} Gemini candidate free models`);
  assert.ok(geminiData.models.length > 0, 'Should find Gemini free models');

  // 7. Ollama Cloud Credential & Discovery Test
  console.log('[-] Testing Ollama Cloud discovery...');
  const ollamaCreds = getOllamaCredentials();
  assert.strictEqual(ollamaCreds.prefix, 'ollama', 'Ollama prefix must be ollama');
  const ollamaData = await getTodaysOllamaFreeModels();
  console.log(`    Found ${ollamaData.models.length} Ollama candidate free models`);
  assert.ok(ollamaData.models.length > 0, 'Should find Ollama free models');

  // 8. API.airforce Credential & Discovery Test
  console.log('[-] Testing API.airforce discovery...');
  const airforceCreds = getAirforceCredentials();
  assert.ok(airforceCreds.prefix.length > 0, 'Airforce prefix must not be empty');
  const airforceData = await getTodaysAirforceFreeModels();
  console.log(`    Found ${airforceData.models.length} API.airforce candidate free models`);
  assert.ok(Array.isArray(airforceData.models), 'Airforce models must be an array');

  // 9. Bazaarlink Credential & Discovery Test
  console.log('[-] Testing Bazaarlink discovery...');
  const bzlCreds = getBazaarlinkCredentials();
  assert.ok(bzlCreds.prefix.length > 0, 'Bazaarlink prefix must not be empty');
  const bzlData = await getTodaysBazaarlinkFreeModels();
  console.log(`    Found ${bzlData.models.length} Bazaarlink candidate free models`);
  assert.ok(bzlData.models.length > 0, 'Should find Bazaarlink free models');

  // 9.1 B.ai Credential & Discovery Test
  console.log('[-] Testing B.ai discovery...');
  const baiCreds = getBAiCredentials();
  assert.ok(baiCreds.prefix.length > 0, 'B.ai prefix must not be empty');
  const baiData = await getTodaysBAiFreeModels();
  console.log(`    Found ${baiData.models.length} B.ai candidate free models`);
  assert.ok(Array.isArray(baiData.models), 'B.ai models must be an array');

  // 9.1 NVIDIA NIM Credential & Discovery Test
  console.log('[-] Testing NVIDIA NIM discovery...');
  const nimCreds = getNvidiaCredentials();
  assert.strictEqual(nimCreds.prefix, 'nvidia', 'NVIDIA NIM prefix must be nvidia');
  assert.strictEqual(nimCreds.baseUrl, 'https://integrate.api.nvidia.com/v1', 'NVIDIA NIM baseUrl must be integrate.api.nvidia.com/v1');
  const nimData = await getTodaysNvidiaFreeModels();
  console.log(`    Found ${nimData.models.length} NVIDIA NIM candidate free models`);
  assert.ok(Array.isArray(nimData.models), 'NVIDIA NIM models must be an array');
  if (nimCreds.apiKey) {
    assert.ok(nimData.models.length > 0, 'NVIDIA NIM discovery must find models when an API key exists');
  }
  // Skip patterns must remove non-LLM entries (embeddings, guardrails, TTS, vision)
  for (const m of nimData.models) {
    assert.ok(!/embed|guard|safety|tts|riva|vision|-vl|vlm|fuyu|kosmos|neva|vila|deplot|clip|diffusion|video|detector|reward|parse/i.test(m.id),
      `NVIDIA NIM candidate must be a text LLM, got: ${m.id}`);
  }

  // 10. OpenCode from 9router Discovery Test
  console.log('[-] Testing 9router OpenCode free extraction...');
  const ocData = getTodaysOpenCodeFreeModels();
  console.log(`    Found ${ocData.models.length} OpenCode candidate free models`);
  assert.ok(ocData.models.length > 0, 'Should find OpenCode free models');

  // 11. Exclusion Rules Check (Models & Providers)
  console.log('[-] Testing exclusions filter engine (models & providers)...');
  const { getExclusionList, getExcludedProviders, isProviderExcluded, isModelExcluded } = require('./sync.js');
  const exclusions = getExclusionList();
  const excludedProviders = getExcludedProviders();
  assert.ok(Array.isArray(exclusions) && exclusions.length > 0, 'Exclusions list must not be empty');
  assert.ok(Array.isArray(excludedProviders) && excludedProviders.includes('api-airforce'), 'api-airforce must be in excludedProviders');
  assert.strictEqual(isProviderExcluded('api-airforce'), excludedProviders.includes('api-airforce'), 'isProviderExcluded must agree with the config for api-airforce');
  for (const name of ['gemini', 'bazaarlink', 'openrouter', 'kilocode']) {
    assert.strictEqual(isProviderExcluded(name), excludedProviders.includes(name), `isProviderExcluded must agree with the config for ${name}`);
  }
  assert.ok(isModelExcluded('ollama/nemotron-3-nano:30b', exclusions), 'nano models must be excluded');
  assert.ok(isModelExcluded('openrouter/liquid/lfm-2.5-2.6b:free', exclusions), 'lfm small models must be excluded');
  assert.ok(isModelExcluded('poolside/poolside/laguna-xs-2.1', exclusions), 'laguna-xs models must be excluded');
  assert.ok(isModelExcluded('openrouter/cohere/north-mini-code:free', exclusions), 'north-mini models must be excluded');
  assert.ok(isModelExcluded('gemini/gemma-4-31b-it', exclusions), 'gemma models must be excluded');
  assert.ok(isModelExcluded('ollama/gpt-oss:120b', exclusions), 'gpt-oss models must be excluded');
  assert.ok(isModelExcluded('bazaarlink/auto:free', exclusions), 'bazaarlink/auto:free must be excluded');
  assert.ok(isModelExcluded('openrouter/free', exclusions), 'openrouter/free must be excluded');
  assert.ok(isModelExcluded('kc/dots-studio/dots-3-note-preview:free', exclusions), 'dots-studio must be excluded');
  assert.strictEqual(isModelExcluded('openrouter/stealth/ox-alpha', exclusions), false, 'ox-alpha must not be excluded');
  assert.strictEqual(isModelExcluded('kc/stepfun/step-3.7-flash:free', exclusions), false, 'step-3.7 must not be excluded');
  assert.strictEqual(isModelExcluded('ollama/minimax-m3', exclusions), false, 'minimax-m3 must not be excluded');
  assert.strictEqual(isModelExcluded('gemini/gemini-3.5-flash-lite', exclusions), false, 'gemini-3.5-flash-lite must not be excluded');
  assert.strictEqual(isModelExcluded('poolside/poolside/laguna-s-2.1', exclusions), false, 'laguna-s-2.1 must not be excluded');
  assert.strictEqual(isModelExcluded('bazaarlink/qwen/qwen3.7-flash:free', exclusions), false, 'qwen3.7-flash must not be excluded');

  // 12. Custom Priorities Engine Check
  console.log('[-] Testing custom priorities engine & latency ranking...');
  const priorities = getPrioritiesList();
  assert.ok(Array.isArray(priorities) && priorities.length > 0, 'Priorities list must not be empty');

  // Test fuzzy / substring matching rank (mirrors priorities.json)
  assert.strictEqual(getModelPriorityRank('openagentic/0x-alpha-pro', priorities), 0, '0x-alpha should be rank 0');
  assert.strictEqual(getModelPriorityRank('openagentic/ox-alpha', priorities), 1, 'ox-alpha should be rank 1');
  assert.strictEqual(getModelPriorityRank('poolside/poolside/laguna-s-2.1', priorities), 3, 'Laguna should be rank 3');
  assert.strictEqual(getModelPriorityRank('ollama/minimax-m3', priorities), Infinity, 'Minimax M3 has no custom rank');

  // Test similar models matching same priority rule -> prioritized by lowest latency
  const similarCandidates = [
    { id: 'openagentic/hy3-large', latencyMs: 2200 },
    { id: 'ollama/hy3-small', latencyMs: 450 },
    { id: 'openagentic/ox-alpha', latencyMs: 1500 }
  ];
  const sortedSimilar = sortModelsByCodingQuality(similarCandidates, null, priorities);
  assert.strictEqual(sortedSimilar[0].id, 'openagentic/ox-alpha', 'Higher rank (ox-alpha) must come first');
  assert.strictEqual(sortedSimilar[1].id, 'ollama/hy3-small', 'Between two hy3 models, lower latency (450ms) must come first');
  assert.strictEqual(sortedSimilar[2].id, 'openagentic/hy3-large', 'Higher latency hy3 (2200ms) comes after');

  // 14. Combined sorting test across all providers
  console.log('[-] Testing combined priority sorting across all providers...');
  const allPrefixed = [
    ...oaData.models.map(m => `openagentic/${m.id}`),
    ...kiloData.models.map(m => `kc/${m.id}`),
    ...orData.models.map(m => `openrouter/${m.id}`),
    ...psData.models.map(m => `poolside/${m.id}`),
    ...geminiData.models.map(m => `gemini/${m.id}`),
    ...ollamaData.models.map(m => `ollama/${m.id}`),
    ...airforceData.models.map(m => `api-airforce/${m.id}`),
    ...bzlData.models.map(m => `bazaarlink/${m.id}`),
    ...ocData.models.map(m => m.fullId || `oc/${m.id}`)
  ];
  const sortedUnified = sortModelsByCodingQuality(allPrefixed);
  assert.strictEqual(sortedUnified.length, allPrefixed.length, 'Unified list must retain all models');

  // 15. Latency Tie-Breaker Test for unpinned models
  console.log('[-] Testing latency tie-breaker sorting...');
  const tieCandidates = [
    { id: 'poolside/laguna-s-2.1:free', name: 'Laguna S Slow', latencyMs: 2500 },
    { id: 'poolside/laguna-s-2.1:free', name: 'Laguna S Fast', latencyMs: 350 }
  ];
  const sortedTies = sortModelsByCodingQuality(tieCandidates);
  assert.strictEqual(sortedTies[0].latencyMs, 350, 'Fastest latency must be prioritized on identical score');

  // 16. Watchdog / delta / agentic-gate helpers (offline unit checks)
  console.log('[-] Testing watchdog refresh helpers...');
  const {
    computeComboDelta,
    buildDeltaMessage,
    readCurrentComboModels,
    MANAGED_COMBOS,
    isSmartTierModel,
    isThinkingVariant,
    passesAgenticGate,
    AGENTIC_MIN_CONTEXT,
    getUsagePenalty,
    classifyTestResult,
  buildComboMap,
    getModelFullId
  } = require('./sync.js');

  // Delta computation
  const delta = computeComboDelta(['a', 'b', 'c'], ['b', 'c', 'd', 'e']);
  assert.deepStrictEqual(delta.added.sort(), ['d', 'e'], 'Delta must detect additions');
  assert.deepStrictEqual(delta.removed, ['a'], 'Delta must detect removals');
  assert.deepStrictEqual(computeComboDelta([], []).added, [], 'Empty delta must stay empty');

  // Delta message builder
  const msg = buildDeltaMessage({ mode: 'unit-test', added: ['x/one'], removed: ['y/two'], total: 7 });
  assert.ok(typeof msg === 'string' && msg.includes('unit-test') && msg.includes('x/one') && msg.includes('y/two'), 'Delta message must include mode and changes');
  const msgNoChange = buildDeltaMessage({ mode: 'unit-test', added: [], removed: [], total: 3 });
  assert.ok(msgNoChange.includes('No changes'), 'No-change run must say so');

  // Managed combos registry includes every provider combo
  for (const required of ['my9model-free', 'my9model-smart', 'my9model-fast', 'groq-free', 'cerebras-free', 'mistral-free', 'cloudflare-free']) {
    assert.ok(MANAGED_COMBOS.includes(required), `MANAGED_COMBOS must contain ${required}`);
  }

  // Smart/fast split heuristics
  assert.strictEqual(isThinkingVariant('oc/mimo-v2.5-free'), false, 'Plain model is not a thinking variant');
  assert.strictEqual(isThinkingVariant('kc/qwen/qwen3.6-plus-thinking:free'), true, 'Thinking suffix must be detected');
  assert.strictEqual(isSmartTierModel('openagentic/claude-sonnet-4.5'), true, 'High-benchmark model is smart tier');
  assert.strictEqual(isSmartTierModel('poolside/poolside/laguna-s-2.1'), false, 'Low-benchmark model is not smart tier');
  assert.strictEqual(isSmartTierModel('ollama/minimax-m3-thinking'), true, 'Thinking variant is always smart tier');

  // Agentic readiness gate
  assert.strictEqual(passesAgenticGate(null), true, 'Unknown metadata passes the gate');
  assert.strictEqual(passesAgenticGate({ contextLength: 131072 }), true, '128k context passes the gate');
  assert.strictEqual(passesAgenticGate({ contextLength: 32768 }), false, '32k context fails the gate');
  assert.strictEqual(passesAgenticGate({ toolsUnsupported: true }), false, 'Explicit no-tools must fail the gate');
  assert.strictEqual(AGENTIC_MIN_CONTEXT, 100000, 'Agentic floor constant sanity check');

  // Usage penalty shape (real DB or empty fallback both valid)
  const penalty = getUsagePenalty('gemini/gemini-3.5-flash');
  assert.ok(typeof penalty === 'number' && penalty >= -800 && penalty <= 0, 'Usage penalty must be a bounded number');
  assert.strictEqual(getUsagePenalty('no-slash-id'), 0, 'Ids without prefix carry no penalty');

  // Quota classification
  assert.strictEqual(classifyTestResult({ quotaExhausted: true }), 'quota', 'Quota flag must map to the quota verdict');
  assert.strictEqual(classifyTestResult({ reason: 'HTTP 402' }), 'dead', 'Paid model is dead');
  assert.strictEqual(classifyTestResult(null), 'dead', 'Null result is dead');
  assert.strictEqual(classifyTestResult({ valid: true, latencyMs: 1200 }), 'active', 'Healthy result is active');
  assert.strictEqual(classifyTestResult({ valid: true, latencyMs: QUOTA_LATENCY_SENTINEL }), 'quota', 'Sentinel latency decodes to quota');
  assert.strictEqual(classifyTestResult({ valid: false, latencyMs: QUOTA_LATENCY_SENTINEL + 5 }), 'quota', 'Parked encoding wins over valid flag');

  // Combo snapshot reader
  assert.ok(Array.isArray(readCurrentComboModels('my9model-free')), 'Combo reader must return an array');

  // Canonical id extraction
  assert.strictEqual(getModelFullId('plain/id'), 'plain/id');
  assert.strictEqual(getModelFullId({ fullId: 'full/id' }), 'full/id');
  assert.strictEqual(getModelFullId({ id: 'bare' }), 'bare');

  // 17. New provider discovery (Groq / Cerebras / Mistral / Cloudflare)
  console.log('[-] Testing new provider discovery (Groq / Cerebras / Mistral / Cloudflare)...');
  const {
    getTodaysGroqFreeModels,
    getTodaysCerebrasFreeModels,
    getTodaysMistralFreeModels,
    getTodaysCloudflareFreeModels,
    getGroqCredentials,
    getCerebrasCredentials
  } = require('./sync.js');

  const groqData = await getTodaysGroqFreeModels();
  console.log(`    Found ${groqData.models.length} Groq candidate models`);
  assert.strictEqual(groqData.prefix, 'groq', 'Groq prefix must be groq');
  assert.ok(Array.isArray(groqData.models), 'Groq models must be an array');
  if (getGroqCredentials().apiKey) {
    assert.ok(groqData.models.length > 0, 'Groq discovery must find models when an API key exists');
  }

  const cerebrasData = await getTodaysCerebrasFreeModels();
  console.log(`    Found ${cerebrasData.models.length} Cerebras candidate models`);
  assert.strictEqual(cerebrasData.prefix, 'cerebras', 'Cerebras prefix must be cerebras');
  assert.ok(Array.isArray(cerebrasData.models), 'Cerebras models must be an array');
  if (getCerebrasCredentials().apiKey) {
    assert.ok(cerebrasData.models.length > 0, 'Cerebras discovery must find models when an API key exists');
  }

  const mistralData = await getTodaysMistralFreeModels();
  console.log(`    Found ${mistralData.models.length} Mistral candidate models (0 expected without a connection)`);
  assert.strictEqual(mistralData.prefix, 'mistral', 'Mistral prefix must be mistral');
  assert.ok(Array.isArray(mistralData.models), 'Mistral models must be an array even without credentials');

  const cloudflareData = await getTodaysCloudflareFreeModels();
  console.log(`    Found ${cloudflareData.models.length} Cloudflare candidate models (0 expected without a connection)`);
  assert.strictEqual(cloudflareData.prefix, 'cloudflare-ai', 'Cloudflare prefix must be cloudflare-ai');
  assert.ok(Array.isArray(cloudflareData.models), 'Cloudflare models must be an array even without credentials');

  // 18. Quota models always sink below user priorities (regression for 0x-alpha-free case)
  const { sortModelsByCodingQuality: sortByQuality } = require('./sync.js');
  const quotaCase = [
    { id: 'acme/hero-model', latencyMs: 1200 },
    { id: 'acme/priority-but-quota', latencyMs: 999998, quotaExhausted: true },
    { id: 'acme/plain-slow', latencyMs: 7000 }
  ];
  const ranked = sortByQuality(quotaCase, null, ['priority-but-quota']);
  assert.strictEqual(ranked[ranked.length - 1].id, 'acme/priority-but-quota', 'A prioritized quota-exhausted model must still rank last');
  assert.strictEqual(ranked[0].id, 'acme/hero-model', 'Active prioritized model stays on top');

  const sentinelRanked = sortByQuality([
    { id: 'acme/a', latencyMs: 999998 },
    { id: 'acme/b', latencyMs: 400 }
  ], null, []);
  assert.strictEqual(sentinelRanked[sentinelRanked.length - 1].id, 'acme/a', 'Latency sentinel alone forces bottom placement');

  // String-id form with latencyMap must behave identically
  const latMap = new Map([['acme/q', 999998], ['acme/ok', 300]]);
  const strRanked = sortByQuality(['acme/q', 'acme/ok'], latMap, ['q']);
  assert.strictEqual(strRanked[strRanked.length - 1], 'acme/q', 'String ids via latencyMap respect quota-bottom too');

  // 19. Clean provider combos + recovery pool helpers
  const { deriveTierLists: tiersOf, idMatchesPrefixes: matchesPrefix, PROVIDER_COMBO_PREFIXES: COMBO_PREFIXES } = require('./sync.js');

  assert.strictEqual(matchesPrefix('openrouter/z/inkling:free', COMBO_PREFIXES['openrouter-free']), true, 'prefix routing for openrouter combo');
  assert.strictEqual(matchesPrefix('kc/stepfun/x:free', COMBO_PREFIXES['openagentic-free']), false, 'kilo ids must not leak into openagentic combo');
  assert.strictEqual(matchesPrefix('oa/whatever', COMBO_PREFIXES['openagentic-free']), true, 'oa alias maps to openagentic combo');

  const tiers = tiersOf(['x/a-thinking', 'x/b', 'x/c', 'x/d', 'x/e-thinking']);
  assert.ok(tiers.smartList.includes('x/a-thinking') && tiers.smartList.includes('x/e-thinking'), 'thinking ids land in smart tier');
  assert.ok(!tiers.fastList.includes('x/a-thinking'), 'thinking ids stay out of fast tier');

  const tinyTiers = tiersOf(['x/only-one']);
  assert.strictEqual(tinyTiers.smartList.length, 1, 'tiny lists fall back to the ranked list itself');

  // 20. Version heuristic must not mistake parameter counts (8b, 70b) for versions
  const { getCodingScore: scoreOf } = require('./sync.js');
  assert.ok(
    scoreOf('mistral/ministral-8b-latest') < scoreOf('gemini/gemini-3.7-flash'),
    'parameter-count "8b" must not out-rank benchmarked gemini-3.7-flash'
  );
  assert.ok(scoreOf('groq/llama-3.3-70b-versatile') > 3000 && scoreOf('groq/llama-3.3-70b-versatile') < 9000, '"70b" ignored, real version 3.3 scored');
  assert.strictEqual(scoreOf('x/image'), -10000, 'non-coding models keep heavy penalty');

  // 21. Ranking is deterministic when signals are injected (pure interface)
  {
    // Equal benchmark scores -> ordering comes purely from latency / usage penalty
    const benchmarks = { 'a-fast': { score: 50 }, 'b-mid': { score: 50 }, 'c-slow': { score: 50 }, 'z-flaky': { score: 50 } };
    const mk = (id, latencyMs) => ({ id, fullId: `openrouter/${id}`, name: id, latencyMs });
    const models = [mk('z-flaky', 10), mk('c-slow', 200), mk('b-mid', 100), mk('a-fast', 50)];

    const noStats = sortModelsByCodingQuality(models, null, null, { benchmarks, priorities: [], usageStats: new Map() }).map(m => m.id);
    assert.deepStrictEqual(noStats, ['z-flaky', 'a-fast', 'b-mid', 'c-slow'], 'equal scores tie-break on ascending latency');

    // 80% error rate over >= 5 samples -> -800 penalty sinks z-flaky despite its tiny latency
    const usageStats = new Map([['openrouter|z-flaky', { ok: 2, err: 8 }]]);
    const penalised = sortModelsByCodingQuality(models, null, null, { benchmarks, priorities: [], usageStats }).map(m => m.id);
    assert.strictEqual(penalised.indexOf('z-flaky'), 3, 'penalised model must rank last');
    assert.strictEqual(penalised.indexOf('a-fast'), 0, 'healthy models keep latency order');

    // Below-min-sample stats (< 5 total) apply no penalty at all
    const sparse = new Map([['openrouter|z-flaky', { ok: 2, err: 8 - 6 }]]);
    const sparseRanked = sortModelsByCodingQuality(models, null, null, { benchmarks, priorities: [], usageStats: sparse }).map(m => m.id);
    assert.strictEqual(sparseRanked.indexOf('z-flaky'), 0, 'insufficient samples -> no penalty');

    // Quota sentinel sinks regardless of any signals
    const quotaList = sortModelsByCodingQuality([{ ...mk('a-fast', QUOTA_LATENCY_SENTINEL), quotaExhausted: true }, mk('z-flaky', 10)], null, null, { benchmarks, priorities: [], usageStats: new Map() }).map(m => m.id);
    assert.deepStrictEqual(quotaList, ['z-flaky', 'a-fast'], 'quota-exhausted models always sink');
  }

  // 22. Registry completeness: every record yields a coherent provider
  {
    const combos = new Set();
    for (const rec of PROVIDERS) {
      assert.ok(rec.key && rec.label && rec.combo && Array.isArray(rec.prefixes) && rec.prefixes.length > 0, `${rec.key}: key/label/combo/prefixes required`);
      assert.ok(!combos.has(rec.combo), `combo name ${rec.combo} must be unique`);
      combos.add(rec.combo);
      assert.ok(typeof rec.kind === 'string' && rec.kind.length > 0, `${rec.key}: kind required`);
      assert.ok(typeof getProviderCredentials === 'function', 'registry-driven credentials available');
    }
    assert.strictEqual(MANAGED_COMBOS.length, 3 + PROVIDERS.length, 'managed combos = 3 super-combos + one per provider');
    for (const rec of PROVIDERS) {
      assert.ok(Array.isArray(PROVIDER_COMBO_PREFIXES[rec.combo]), `prefix map must cover ${rec.combo}`);
      assert.ok(MANAGED_COMBOS.includes(rec.combo), `managed combos must include ${rec.combo}`);
    }
    // Every alias spelling resolves to exactly one provider
    const seen = new Map();
    for (const rec of PROVIDERS) {
      for (const alias of rec.prefixes) {
        assert.ok(!seen.has(alias), `alias "${alias}" claimed by both ${seen.get(alias)} and ${rec.key}`);
        seen.set(alias, rec.key);
      }
    }
  }

  // 23. Verdict classifier drives an offline testModelWith9router (fake fetch)
  {
    const okJson = async () => ({ ok: true });
    const fakeFetch = (url, opts) => {
      const body = JSON.parse(opts.body);
      return Promise.resolve({
        status: 429,
        json: async () => {
          if (body.model.includes('good')) return { ok: true };
          if (body.model.includes('quota')) return { ok: false, status: 429, error: 'rate limit exceeded' };
          return { ok: false, status: 402, error: 'payment required' };
        }
      });
    };
    const active = await testModelWith9router('openrouter/good-model', 'tok', 1, fakeFetch);
    assert.strictEqual(active.verdict, 'active', '200 path must carry the active verdict');
    const quota = await testModelWith9router('openrouter/quota-model', 'tok', 1, fakeFetch);
    assert.strictEqual(quota.verdict, 'quota', '429 after retry must carry the quota verdict');
    assert.strictEqual(quota.quotaExhausted, true, 'persistence flag kept alongside verdict');
    const dead = await testModelWith9router('openrouter/paid-model', 'tok', 1, fakeFetch);
    assert.strictEqual(dead.verdict, 'dead', '402 must carry the dead verdict');
    // No network happened: fakeFetch never touched 127.0.0.1 — proof is the test passing offline.

    const comboMap = buildComboMap({
      free: ['a', 'b'],
      cooldown: ['c'],
      smart: ['a'],
      providers: [['openrouter-free', ['a']]]
    });
    assert.deepStrictEqual(Array.from(comboMap.get('my9model-free')), ['a', 'b']);
    assert.strictEqual(comboMap.has('my9model-fast'), false, 'omitted keys must stay unwritten');
    assert.deepStrictEqual(comboMap.get('my9model-cooldown'), ['c']);
  }

  // 24. Cross-file agreement: tier boundary & key normalization
  {
    const { normalizeKey, determineTier, SMART_MIN_SCORE } = require('./update-benchmarks.js');
    // SMART_MIN_SCORE must sit exactly on the A-tier floor so the smart combo
    // can never drift from the benchmark tier table.
    assert.strictEqual(determineTier(SMART_MIN_SCORE), 'A', 'SMART_MIN_SCORE must be the A-tier floor');
    assert.notStrictEqual(determineTier(SMART_MIN_SCORE - 1), 'A', 'one point below must leave tier A');

    // Every provider alias must strip cleanly before benchmark lookup and land
    // on exactly the entry the benchmarks file owns (both files agree).
    const db = getBenchmarksDatabase();
    const sampleKeys = Object.keys(db).slice(0, 5);
    assert.ok(sampleKeys.length > 0, 'benchmarks database has entries');
    for (const rec of PROVIDERS) {
      for (const alias of rec.prefixes) {
        for (const sampleKey of sampleKeys) {
          const hit = findBenchmarkMatch(`${alias}/${sampleKey}`, db);
          if (!hit) continue; // some aliases legitimately miss (substring rules)
          assert.strictEqual(hit, db[sampleKey],
            `${alias}/${sampleKey} must resolve to its own benchmark entry`);
        }
      }
    }
    // The two normalizers produce identical output on shared inputs
    for (const s of ['Qwen2.5-Coder-32B', 'deepseek chat v3', 'GLM 4.6!']) {
      assert.strictEqual(typeof normalizeKey(s), 'string');
      assert.ok(!/[^a-z0-9\.\-]/.test(normalizeKey(s)), 'normalizeKey output stays in its own charset');
    }
  }

  console.log('[✓] All tests passed successfully!');
}

runTests().catch(err => {
  console.error('[X] Test failed:', err);
  process.exit(1);
});
