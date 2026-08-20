#!/usr/bin/env node

/**
 * Free Models Sync for 9router
 * (OpenAgentic.id + Kilo.ai + 9router OpenCode Free)
 * 
 * Automatically synchronizes today's free models from:
 *   1. OpenAgentic.id (Web & API /v1/models)
 *   2. Kilo.ai (Gateway API /api/gateway/models)
 *   3. 9router OpenCode (oc/* free models directly from 9router)
 * 
 * Sorts them by coding capability specification (best to worst),
 * and injects them into 9router combos:
 *   - my9model-free   : Unified super-combo across all providers
 *   - openagentic-free: Dedicated OpenAgentic free combo
 *   - kilo-free       : Dedicated Kilo.ai free combo
 *   - opencode-free   : Dedicated OpenCode free combo
 */

const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

// Database, 9router, and paths
const HOME = os.homedir();
const NINE_ROUTER_DIR = path.join(HOME, '.9router');
const DB_PATH = path.join(NINE_ROUTER_DIR, 'db', 'data.sqlite');
const BETTER_SQLITE_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', 'better-sqlite3');
const CLIENT_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', '9router', 'src', 'cli', 'api', 'client.js');

// Options
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isCronSetup = args.includes('--setup-cron');
const isDaemon = args.includes('--daemon');

// Coding capability scoring engine
// Higher score = better coding specification & benchmark performance
function getCodingScore(modelIdentifier) {
  const str = String(modelIdentifier).toLowerCase();

  // Heavy penalty for image / non-coding models
  if (str.includes('image') || str.includes('flux') || str.includes('wan2') || str.includes('video') || str.includes('safety') || str.includes('lyria')) {
    return -10000;
  }

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
  if (str.includes('codex') || str.includes('code') || str.includes('coder')) {
    score += 1200;
  }
  if (str.includes('thinking') || str.includes('reasoning') || str.includes('reasoner')) {
    score += 400;
  }
  if (str.includes('opus') || str.includes('sol') || str.includes('terra') || str.includes('luna') || str.includes('max')) {
    score += 500;
  }
  if (str.includes('sonnet') || str.includes('pro')) {
    score += 350;
  }
  if (str.includes('plus') || str.includes('flash') || str.includes('lightning')) {
    score += 150;
  }
  if (str.includes('ultra') || str.includes('super')) {
    score += 100;
  }

  return score;
}

// Sort models array from best coding capability to lowest
function sortModelsByCodingQuality(models) {
  return [...models].sort((a, b) => {
    const idA = typeof a === 'string' ? a : (a.fullId || a.id || a.name || '');
    const idB = typeof b === 'string' ? b : (b.fullId || b.id || b.name || '');
    return getCodingScore(idB) - getCodingScore(idA);
  });
}

// Fetch URL with Promise (using Node stdlib)
function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', ...headers }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ status: res.statusCode, body: data });
        } else {
          resolve({ status: res.statusCode, body: data, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// Extract OpenAgentic API Key and Provider Prefix from 9router Database
function getOpenAgenticCredentials() {
  try {
    let Database;
    try {
      Database = require(BETTER_SQLITE_PATH);
    } catch {
      Database = require('better-sqlite3');
    }
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

  return {
    apiKey: null,
    prefix: 'openagentic',
    baseUrl: 'https://openagentic.id/api/v1'
  };
}

// Extract Kilo.ai (KiloCode) Access Token from 9router Database
function getKiloCredentials() {
  try {
    let Database;
    try {
      Database = require(BETTER_SQLITE_PATH);
    } catch {
      Database = require('better-sqlite3');
    }
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

  return {
    accessToken: null,
    prefix: 'kc',
    gatewayUrl: 'https://api.kilo.ai/api/gateway'
  };
}

// Scrape free models from OpenAgentic HTML landing page
async function scrapeFreeModelsFromWeb() {
  const freeModels = new Set();
  try {
    console.log('[-] Scraping OpenAgentic.id web for free tier models...');
    const res = await fetchUrl('https://openagentic.id/');
    if (res.status === 200 && res.body) {
      const html = res.body;

      // Extract cards with data-tier="free"
      const freeCardRegex = /data-tier="free"[\s\S]*?<div class="truncate text-sm font-medium text-stone-100">([^<]+)<\/div>/g;
      let match;
      while ((match = freeCardRegex.exec(html)) !== null) {
        const rawName = match[1].trim();
        // Standardize model name to model slug
        const slug = rawName.toLowerCase()
          .replace(/\s*\(thinking\)/i, '-thinking')
          .replace(/\s*\(free\)/i, '-free')
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        freeModels.add({ id: slug, name: rawName, source: 'oa-web-free-tier' });
      }

      // Check hero banner announcements (e.g. Claude Sonnet 4.5 Free promotion)
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
    const res = await fetchUrl(endpoint, {
      'Authorization': `Bearer ${apiKey}`
    });

    if (res.status === 200 && res.body) {
      const json = JSON.parse(res.body);
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
    const res = await fetchUrl(endpoint, {
      'Authorization': `Bearer ${accessToken}`
    });

    if (res.status === 200 && res.body) {
      const json = JSON.parse(res.body);
      const models = Array.isArray(json) ? json : (json.data || []);

      for (const m of models) {
        const id = m.id || '';
        const name = m.name || id;
        const promptPrice = m.pricing?.prompt;
        const isZeroPrice = promptPrice === '0' || promptPrice === '0.000000000000';
        const isFree = m.isFree === true || isZeroPrice || id.endsWith(':free') || id.includes('/free');

        // Skip non-text or pure content safety filters
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

// Extract OpenCode free models directly from 9router (oc/*)
function getTodaysOpenCodeFreeModels() {
  console.log('[-] Extracting OpenCode free models directly from 9router...');
  const baseOcFree = [
    'oc/deepseek-v4-flash-free',
    'oc/qwen3.6-plus-free',
    'oc/minimax-m3-free',
    'oc/nemotron-3-ultra-free',
    'oc/ling-3.0-flash-free',
    'oc/mimo-v2.5-free',
    'oc/laguna-s-2.1-free',
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

// Inject free models into 9router combos
async function injectInto9router(oaData, kiloData, ocData) {
  const oaPrefixed = oaData.models.map(m => `${oaData.prefix}/${m.id}`);
  const kiloPrefixed = kiloData.models.map(m => `${kiloData.prefix}/${m.id}`);
  const ocPrefixed = ocData.models.map(m => m.fullId || `${ocData.prefix}/${m.id}`);

  console.log(`\n[+] OpenAgentic: ${oaData.models.length} free models (sorted by coding spec):`);
  for (const m of oaData.models) {
    console.log(`    - ${oaData.prefix}/${m.id} [Score: ${getCodingScore(m.id)}] (${m.name})`);
  }

  console.log(`\n[+] Kilo.ai: ${kiloData.models.length} free models (sorted by coding spec):`);
  for (const m of kiloData.models) {
    console.log(`    - ${kiloData.prefix}/${m.id} [Score: ${getCodingScore(m.id)}] (${m.name})`);
  }

  console.log(`\n[+] 9router OpenCode: ${ocData.models.length} free models (sorted by coding spec):`);
  for (const m of ocData.models) {
    const rawId = m.fullId || `${ocData.prefix}/${m.id}`;
    console.log(`    - ${rawId} [Score: ${getCodingScore(m.id)}] (${m.name})`);
  }

  if (isDryRun) {
    console.log('\n[*] Dry run mode enabled. No changes written.');
    return;
  }

  let client;
  try {
    client = require(CLIENT_PATH);
  } catch {}

  const unifiedList = sortModelsByCodingQuality(Array.from(new Set([...oaPrefixed, ...kiloPrefixed, ...ocPrefixed])));

  // 1. Try updating via 9router API client if server is running
  let updatedViaApi = false;
  if (client && typeof client.getCombos === 'function') {
    try {
      const res = await client.getCombos();
      if (res.success && res.data && res.data.combos) {
        const combos = res.data.combos;

        for (const combo of combos) {
          if (combo.name === 'my9model-free') {
            await client.updateCombo(combo.id, { name: combo.name, models: unifiedList });
            console.log(`[✓] Updated combo '${combo.name}' via 9router API (${unifiedList.length} models total)`);
            updatedViaApi = true;
          } else if (combo.name === 'openagentic-free') {
            const newComboList = sortModelsByCodingQuality(oaPrefixed);
            await client.updateCombo(combo.id, { name: combo.name, models: newComboList });
            console.log(`[✓] Updated combo 'openagentic-free' via 9router API (${newComboList.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'kilo-free') {
            const newComboList = sortModelsByCodingQuality(kiloPrefixed);
            await client.updateCombo(combo.id, { name: combo.name, models: newComboList });
            console.log(`[✓] Updated combo 'kilo-free' via 9router API (${newComboList.length} models)`);
            updatedViaApi = true;
          } else if (combo.name === 'opencode-free') {
            const newComboList = sortModelsByCodingQuality(ocPrefixed);
            await client.updateCombo(combo.id, { name: combo.name, models: newComboList });
            console.log(`[✓] Updated combo 'opencode-free' via 9router API (${newComboList.length} models)`);
            updatedViaApi = true;
          }
        }
      }
    } catch (err) {
      console.log(`[-] 9router API update notice (${err.message}). Updating SQLite DB...`);
    }
  }

  // 2. Direct SQLite update
  try {
    let Database;
    try {
      Database = require(BETTER_SQLITE_PATH);
    } catch {
      Database = require('better-sqlite3');
    }

    const db = new Database(DB_PATH);
    const existingCombos = db.prepare("SELECT * FROM combos").all();
    const now = new Date().toISOString();
    const { randomUUID } = require('node:crypto');

    function upsertCombo(comboName, modelList) {
      const found = existingCombos.find(c => c.name === comboName);
      if (found) {
        db.prepare("UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?").run(
          JSON.stringify(modelList),
          now,
          found.id
        );
        console.log(`[✓] Synchronized combo '${comboName}' in 9router SQLite database (${modelList.length} models)`);
      } else {
        const newId = randomUUID();
        db.prepare("INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
          newId,
          comboName,
          null,
          JSON.stringify(modelList),
          now,
          now
        );
        console.log(`[✓] Created new combo '${comboName}' in 9router SQLite database (${modelList.length} models)`);
      }
    }

    // Unified super-combo (my9model-free)
    upsertCombo('my9model-free', unifiedList);

    // Dedicated OpenAgentic combo
    upsertCombo('openagentic-free', sortModelsByCodingQuality(oaPrefixed));

    // Dedicated Kilo.ai combo
    if (kiloPrefixed.length > 0) {
      upsertCombo('kilo-free', sortModelsByCodingQuality(kiloPrefixed));
    }

    // Dedicated OpenCode free combo
    if (ocPrefixed.length > 0) {
      upsertCombo('opencode-free', sortModelsByCodingQuality(ocPrefixed));
    }

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
      .filter(line => !line.includes('openagentic-free-sync') && !line.includes(scriptPath))
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
  console.log('  Sources: OpenAgentic + Kilo.ai + 9router OpenCode');
  console.log('  Account: herliansyah@gmail.com                   ');
  console.log('  Prioritizing: Best Coding Models First           ');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('====================================================');

  if (isCronSetup) {
    setupDailyCron();
  }

  const [oaData, kiloData] = await Promise.all([
    getTodaysOpenAgenticFreeModels(),
    getTodaysKiloFreeModels()
  ]);

  const ocData = getTodaysOpenCodeFreeModels();

  await injectInto9router(oaData, kiloData, ocData);

  if (isDaemon) {
    console.log('\n[*] Running in daemon mode. Syncing every 24 hours...');
    setInterval(async () => {
      try {
        console.log(`\n[${new Date().toISOString()}] Running periodic sync...`);
        const [oa, kilo] = await Promise.all([
          getTodaysOpenAgenticFreeModels(),
          getTodaysKiloFreeModels()
        ]);
        const oc = getTodaysOpenCodeFreeModels();
        await injectInto9router(oa, kilo, oc);
      } catch (e) {
        console.error(`[X] Daemon sync error: ${e.message}`);
      }
    }, 24 * 60 * 60 * 1000);
  }
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
  getOpenAgenticCredentials,
  getKiloCredentials,
  getTodaysOpenAgenticFreeModels,
  getTodaysKiloFreeModels,
  getTodaysOpenCodeFreeModels,
  scrapeFreeModelsFromWeb,
  fetchFreeModelsFromApi,
  fetchKiloFreeModels,
  injectInto9router
};
