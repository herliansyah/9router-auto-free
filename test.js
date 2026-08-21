/**
 * Ponytail test check for 9router free sync (OpenAgentic + Kilo.ai + 9router OpenCode)
 * Minimal assert-based self check.
 */

const assert = require('node:assert');
const {
  getCodingScore,
  sortModelsByCodingQuality,
  getOpenAgenticCredentials,
  getKiloCredentials,
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenCodeFreeModels,
  testModelWith9router,
  validateCandidateModels
} = require('./sync.js');

async function runTests() {
  console.log('[*] Running tests for Free Sync (OpenAgentic + Kilo.ai + 9router OpenCode)...');

  // 1. Coding score tests
  console.log('[-] Testing coding spec score & sorting...');
  const scoreSol = getCodingScore('gpt-5.6-sol');
  const scoreGpt4 = getCodingScore('gpt-4.1');
  assert.ok(scoreSol > scoreGpt4, 'GPT-5.6-SOL must score higher than GPT-4.1');

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

  // 4. OpenCode from 9router Discovery Test
  console.log('[-] Testing 9router OpenCode free extraction...');
  const ocData = getTodaysOpenCodeFreeModels();
  console.log(`    Found ${ocData.models.length} OpenCode candidate free models`);
  assert.ok(ocData.models.length > 0, 'Should find OpenCode free models');

  // 5. Pre-test Validation Engine Check
  console.log('[-] Testing pre-test validation engine...');
  const sampleModels = [
    { id: 'stepfun/step-3.7-flash:free', name: 'Step 3.7 Flash' },
    { id: 'deepseek-v4-flash-free', name: 'Deepseek V4 (Expired)' }
  ];
  // Test skip mode (must retain all)
  const skipped = await validateCandidateModels(sampleModels, 'kc', true);
  assert.strictEqual(skipped.length, 2, 'Skip mode should keep all models');

  // 6. Combined sorting test
  console.log('[-] Testing combined priority sorting across all providers...');
  const allPrefixed = [
    ...oaData.models.map(m => `openagentic/${m.id}`),
    ...kiloData.models.map(m => `kc/${m.id}`),
    ...ocData.models.map(m => m.fullId || `oc/${m.id}`)
  ];
  const sortedUnified = sortModelsByCodingQuality(allPrefixed);
  assert.strictEqual(sortedUnified.length, allPrefixed.length, 'Unified list must retain all models');

  for (let i = 0; i < sortedUnified.length - 1; i++) {
    const scoreA = getCodingScore(sortedUnified[i]);
    const scoreB = getCodingScore(sortedUnified[i + 1]);
    assert.ok(scoreA >= scoreB, `Model ${sortedUnified[i]} (${scoreA}) must score >= ${sortedUnified[i + 1]} (${scoreB})`);
  }

  console.log('[✓] All tests passed successfully!');
}

runTests().catch(err => {
  console.error('[X] Test failed:', err);
  process.exit(1);
});
