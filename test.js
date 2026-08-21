/**
 * Ponytail test check for 9router free sync (OpenAgentic + Kilo.ai + OpenRouter + 9router OpenCode)
 * Minimal assert-based self check.
 */

const assert = require('node:assert');
const {
  getCodingScore,
  sortModelsByCodingQuality,
  getOpenAgenticCredentials,
  getKiloCredentials,
  getOpenRouterCredentials,
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenRouterFreeModels,
  getTodaysOpenCodeFreeModels,
  testModelWith9router,
  validateCandidateModels
} = require('./sync.js');

async function runTests() {
  console.log('[*] Running tests for Free Sync (OpenAgentic + Kilo.ai + OpenRouter + 9router OpenCode)...');

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

  // 5. OpenCode from 9router Discovery Test
  console.log('[-] Testing 9router OpenCode free extraction...');
  const ocData = getTodaysOpenCodeFreeModels();
  console.log(`    Found ${ocData.models.length} OpenCode candidate free models`);
  assert.ok(ocData.models.length > 0, 'Should find OpenCode free models');

  // 6. Exclusion Rules Check
  console.log('[-] Testing exclusions filter engine...');
  const { getExclusionList, isModelExcluded } = require('./sync.js');
  const exclusions = getExclusionList();
  assert.ok(Array.isArray(exclusions) && exclusions.length > 0, 'Exclusions list must not be empty');
  assert.ok(isModelExcluded('openrouter/stealth/ox-alpha', exclusions), 'ox-alpha must be excluded');
  assert.ok(isModelExcluded('openrouter/free', exclusions), 'openrouter/free must be excluded');
  assert.ok(isModelExcluded('kc/dots-studio/dots-3-note-preview:free', exclusions), 'dots-3-note must be excluded');
  assert.strictEqual(isModelExcluded('kc/stepfun/step-3.7-flash:free', exclusions), false, 'step-3.7 must not be excluded');

  // 7. Pre-test Validation Engine Check
  console.log('[-] Testing pre-test validation engine...');
  const sampleModels = [
    { id: 'stepfun/step-3.7-flash:free', name: 'Step 3.7 Flash' },
    { id: 'stealth/ox-alpha', name: 'Ox Alpha (Jelek / Excluded)' }
  ];
  // Test skip mode with exclusion (ox-alpha dropped, stepfun kept)
  const filtered = await validateCandidateModels(sampleModels, 'kc', true);
  assert.strictEqual(filtered.length, 1, 'Only non-excluded models should remain');
  assert.strictEqual(filtered[0].id, 'stepfun/step-3.7-flash:free');

  // 7. Combined sorting test
  console.log('[-] Testing combined priority sorting across all providers...');
  const allPrefixed = [
    ...oaData.models.map(m => `openagentic/${m.id}`),
    ...kiloData.models.map(m => `kc/${m.id}`),
    ...orData.models.map(m => `openrouter/${m.id}`),
    ...ocData.models.map(m => m.fullId || `oc/${m.id}`)
  ];
  const sortedUnified = sortModelsByCodingQuality(allPrefixed);
  assert.strictEqual(sortedUnified.length, allPrefixed.length, 'Unified list must retain all models');

  for (let i = 0; i < sortedUnified.length - 1; i++) {
    const scoreA = getCodingScore(sortedUnified[i]);
    const scoreB = getCodingScore(sortedUnified[i + 1]);
    assert.ok(scoreA >= scoreB, `Model ${sortedUnified[i]} (${scoreA}) must score >= ${sortedUnified[i + 1]} (${scoreB})`);
  }

  // 8. Latency Tie-Breaker Test
  console.log('[-] Testing latency tie-breaker sorting...');
  const tieCandidates = [
    { id: 'poolside/laguna-s-2.1:free', name: 'Laguna S Slow', latencyMs: 2500 },
    { id: 'poolside/laguna-s-2.1:free', name: 'Laguna S Fast', latencyMs: 350 }
  ];
  const sortedTies = sortModelsByCodingQuality(tieCandidates);
  assert.strictEqual(sortedTies[0].latencyMs, 350, 'Fastest latency must be prioritized on identical score');

  console.log('[✓] All tests passed successfully!');
}

runTests().catch(err => {
  console.error('[X] Test failed:', err);
  process.exit(1);
});
