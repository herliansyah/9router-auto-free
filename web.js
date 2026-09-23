#!/usr/bin/env node

/**
 * 9router-auto-free Web Dashboard Server
 *
 * Standalone web interface matching 9router design, authenticated against 9router
 * password in SQLite database. Provides:
 * - Provider management (add new provider with duplicate prevention)
 * - Exclusions & Priorities management (visual tags + JSON)
 * - Combos & Candidates inspector
 * - Real-time CLI action streaming (Sync, Dry Run, Refresh, Update Benchmarks, Setup Scheduler)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const storage = require('./storage.js');
const scheduler = require('./scheduler.js');
const { PROVIDERS } = require('./providers.js');

// Parse CLI port or default to 20129 (to avoid conflict with 9router on 20128)
const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));
const PORT = process.env.PORT || (portArg ? parseInt(portArg.split('=')[1], 10) : 20129);

// ponytail: verbose logging flag - stdlib only, no external logger required
const isVerbose = args.includes('--verbose') || args.includes('-v') || process.env.VERBOSE === '1' || process.env.DEBUG === '1';

// Active running processes lock
let currentProcess = null;

// Cookie helper
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return storage.verifySessionToken(cookies.session_token);
}

function sendJson(res, statusCode, data) {
  if (isVerbose && statusCode >= 400) {
    console.error(`[API Error ${statusCode}]`, data?.error || data);
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const PUBLIC_PROVIDER_KEYS = ['oa', 'oc', 'openrouter', 'airforce'];

function getActiveProvidersList(combos = []) {
  const rawConnections = storage.readAllConnectionsRaw();
  const activeConnections = rawConnections.filter(c => c.isActive);
  const customConfig = storage.readCustomProvidersFile ? storage.readCustomProvidersFile() : {};

  const getModelCount = (comboName, prefixes) => {
    const pCombo = combos.find(c => c.name === comboName || (prefixes && prefixes.some(pref => c.name === `${pref}-free`)));
    return pCombo?.models?.length || 0;
  };

  const providers = [];

  // 1. Process 9router Active Connections
  for (const conn of activeConnections) {
    const provName = String(conn.provider || '').toLowerCase();
    const known = PROVIDERS.find(p => {
      if (p.key.toLowerCase() === provName) return true;
      if (p.connection && p.connection.toLowerCase() === provName) return true;
      if (p.prefixes && p.prefixes.some(pref => provName === pref.toLowerCase() || provName.startsWith(pref.toLowerCase() + '-'))) return true;
      const baseUrl = conn.data?.providerSpecificData?.baseUrl || conn.data?.baseUrl || '';
      if (p.baseUrl && baseUrl && baseUrl.replace(/\/+$/, '') === p.baseUrl.replace(/\/+$/, '')) return true;
      const prefix = conn.data?.providerSpecificData?.prefix || '';
      if (prefix && p.prefixes && p.prefixes.includes(prefix.toLowerCase())) return true;
      return false;
    });

    const cfg = customConfig[conn.id] || customConfig[conn.provider] || (known ? customConfig[known.key] : {}) || {};
    const prefix = cfg.prefix || conn.data?.providerSpecificData?.prefix || (known ? known.prefixes[0] : conn.provider);
    const comboName = known ? known.combo : `${prefix.split('-')[0]}-free`;
    const prefixes = known ? known.prefixes : [prefix];

    let category = 'Custom Node';
    if (known) {
      if (['groq', 'cerebras'].includes(known.key)) category = 'Fast Inference';
      else if (['gemini', 'mistral'].includes(known.key)) category = 'Major LLM';
      else if (known.key === 'openrouter') category = 'Aggregator';
      else category = 'Free AI';
    }

    providers.push({
      key: known ? known.key : conn.provider,
      providerKey: conn.provider,
      label: conn.name ? `${conn.name} (${known ? known.label : conn.provider})` : (known ? known.label : conn.provider),
      category,
      combo: comboName,
      prefixes,
      defaultBaseUrl: conn.data?.providerSpecificData?.baseUrl || (known ? known.baseUrl : '') || '',
      defaultPrefix: prefix,
      isCustom: !known,
      needsAccountId: false,
      isInstalled: true,
      isActive: true,
      isPublic: false,
      authType: conn.authType || 'apikey',
      modelCount: getModelCount(comboName, prefixes),
      autoSyncEnabled: cfg.enabled !== false,
      connectionId: conn.id,
      connectionName: conn.name
    });
  }

  // 2. Add Built-in Public Providers (if not already connected in 9router)
  for (const pKey of PUBLIC_PROVIDER_KEYS) {
    const alreadyConnected = providers.some(p => p.key === pKey);
    if (alreadyConnected) continue;

    const pDef = PROVIDERS.find(p => p.key === pKey);
    if (!pDef) continue;

    const cfg = customConfig[pKey] || {};
    const comboName = pDef.combo || `${pKey}-free`;
    providers.push({
      key: pDef.key,
      providerKey: pDef.key,
      label: pDef.label,
      category: pDef.key === 'openrouter' ? 'Aggregator' : 'Free AI',
      combo: comboName,
      prefixes: pDef.prefixes || [pKey],
      defaultBaseUrl: pDef.baseUrl || '',
      defaultPrefix: pDef.prefixes ? pDef.prefixes[0] : pKey,
      isCustom: false,
      needsAccountId: false,
      isInstalled: true,
      isActive: true,
      isPublic: true,
      authType: 'public',
      modelCount: getModelCount(comboName, pDef.prefixes),
      autoSyncEnabled: cfg.enabled !== false,
      connectionId: null,
      connectionName: null
    });
  }

  return providers;
}

// ----------------------------------------------------------------------------
// API Request Handlers
// ----------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  // 1. Auth routes (no auth check needed)
  if (pathname === '/api/auth/status' && method === 'GET') {
    return sendJson(res, 200, { authenticated: isAuthenticated(req) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await readBody(req);
      const password = body.password || '';

      if (!fs.existsSync(storage.DB_PATH)) {
        return sendJson(res, 404, {
          success: false,
          error: `Database SQLite 9router tidak ditemukan di: ${storage.DB_PATH}. Pastikan 9router sudah terinstall/dijalankan, atau set NINEROUTER_DIR / NINEROUTER_DB_PATH.`
        });
      }

      const ok = storage.verify9routerPassword(password);
      if (!ok) {
        return sendJson(res, 401, { success: false, error: 'Password 9router salah' });
      }
      const token = storage.createSessionToken();
      if (!token) {
        return sendJson(res, 500, { success: false, error: 'Gagal membuat session token' });
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `session_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
      });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // 2. Authentication Guard for all subsequent routes
  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { success: false, error: 'Unauthorized: Harap login dengan password 9router' });
  }

  // 3. Overview Dashboard
  if (pathname === '/api/dashboard' && method === 'GET') {
    const rawConnections = storage.readAllConnectionsRaw();
    const combos = storage.readAllCombosDetailed();
    const exclusions = storage.readExclusionsFile();
    const priorities = storage.readPrioritiesFile();
    const candidates = storage.readCandidatesStateFile();
    const schedulerStatus = scheduler.getSchedulerStatus();

    const freeCombo = combos.find(c => c.name === 'my9model-free');
    const smartCombo = combos.find(c => c.name === 'my9model-smart');
    const fastCombo = combos.find(c => c.name === 'my9model-fast');
    const cooldownCombo = combos.find(c => c.name === 'my9model-cooldown');

    const syncModule = require('./sync.js');
    const freeModelsList = freeCombo?.models || [];
    const topModels = freeModelsList.slice(0, 5).map((fullId, idx) => {
      const parts = String(fullId).split('/');
      const prefix = parts[0];
      const rawModelId = parts.slice(1).join('/');
      const score = syncModule.getCodingScore ? syncModule.getCodingScore(rawModelId) : 0;
      const isSmart = syncModule.isSmartTierModel ? syncModule.isSmartTierModel(rawModelId) : false;
      const isThinking = syncModule.isThinkingVariant ? syncModule.isThinkingVariant(rawModelId) : false;
      return {
        rank: idx + 1,
        fullId,
        prefix,
        rawModelId,
        score,
        tier: isSmart ? 'smart' : 'fast',
        isThinking
      };
    });

    const activeProviders = getActiveProvidersList(combos);
    const providerStats = activeProviders.map(p => ({
      label: p.label,
      key: p.key,
      category: p.category,
      modelCount: p.modelCount,
      autoSyncEnabled: p.autoSyncEnabled
    }));

    let totalCandidatesCount = 0;
    if (candidates && candidates.providers) {
      for (const p of Object.values(candidates.providers)) {
        if (p && Array.isArray(p.ids)) totalCandidatesCount += p.ids.length;
      }
    } else if (candidates && Array.isArray(candidates.candidates)) {
      totalCandidatesCount = candidates.candidates.length;
    } else {
      totalCandidatesCount = freeModelsList.length;
    }

    const lastSyncTime = candidates?.updatedAt || candidates?.timestamp || freeCombo?.updatedAt || null;

    return sendJson(res, 200, {
      success: true,
      stats: {
        activeConnectionsCount: rawConnections.filter(c => c.isActive).length,
        totalCombosCount: combos.length,
        candidatesCount: totalCandidatesCount,
        candidatesLastSync: lastSyncTime,
        exclusionsCount: Array.isArray(exclusions) ? exclusions.length : (exclusions.excludedModels || []).length,
        prioritiesCount: priorities.length,
        schedulerActive: schedulerStatus.active,
        schedulerType: schedulerStatus.type,
        nineRouterDir: storage.NINE_ROUTER_DIR,
        dbPath: storage.DB_PATH,
        nineRouterUrl: storage.resolveNineRouterUrl()
      },
      distribution: {
        activeCount: freeModelsList.length,
        smartCount: smartCombo?.models?.length || 0,
        fastCount: fastCombo?.models?.length || 0,
        cooldownCount: cooldownCombo?.models?.length || 0
      },
      topModels,
      activeProviders: providerStats
    });
  }

  // 4. Combos
  if (pathname === '/api/combos' && method === 'GET') {
    const combos = storage.readAllCombosDetailed();
    return sendJson(res, 200, { success: true, combos });
  }

  // 5. Providers with Active Status (Connected in 9router + Built-in Public Sources)
  if (pathname === '/api/providers' && method === 'GET') {
    const combos = storage.readAllCombosDetailed ? storage.readAllCombosDetailed() : [];
    const providers = getActiveProvidersList(combos);
    return sendJson(res, 200, { success: true, providers });
  }

  // 5b. Toggle Auto-Sync on/off for a Provider
  if (pathname === '/api/providers/toggle-sync' && method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, providerKey, enabled } = body;
      const customConfig = storage.readCustomProvidersFile();
      const targetKey = id || providerKey;
      if (!targetKey) throw new Error('Provider ID or Key is required');
      if (!customConfig[targetKey]) customConfig[targetKey] = {};
      customConfig[targetKey].enabled = !!enabled;
      storage.writeCustomProvidersFile(customConfig);
      return sendJson(res, 200, { success: true, message: `Auto-Sync status berhasil diubah (${enabled ? 'Aktif' : 'Non-Aktif'})` });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 5c. Update custom provider configuration
  if (pathname === '/api/providers/config' && method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, providerKey, prefix, freePattern, modelsEndpoint } = body;
      const customConfig = storage.readCustomProvidersFile();
      const targetKey = id || providerKey;
      if (!targetKey) throw new Error('Provider ID or Key is required');
      if (!customConfig[targetKey]) customConfig[targetKey] = {};
      if (prefix) customConfig[targetKey].prefix = prefix;
      if (freePattern !== undefined) customConfig[targetKey].freePattern = freePattern;
      if (modelsEndpoint !== undefined) customConfig[targetKey].modelsEndpoint = modelsEndpoint;
      storage.writeCustomProvidersFile(customConfig);
      return sendJson(res, 200, { success: true, message: 'Konfigurasi provider berhasil disimpan' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 6. Exclusions
  if (pathname === '/api/exclusions' && method === 'GET') {
    const exclusions = storage.readExclusionsFile();
    return sendJson(res, 200, { success: true, exclusions });
  }

  if (pathname === '/api/exclusions' && method === 'POST') {
    try {
      const body = await readBody(req);
      storage.writeExclusionsFile(body.exclusions || body);
      return sendJson(res, 200, { success: true, message: 'Exclusions berhasil disimpan' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 7. Priorities
  if (pathname === '/api/priorities' && method === 'GET') {
    const priorities = storage.readPrioritiesFile();
    return sendJson(res, 200, { success: true, priorities });
  }

  if (pathname === '/api/priorities' && method === 'POST') {
    try {
      const body = await readBody(req);
      storage.writePrioritiesFile(body.priorities || body);
      return sendJson(res, 200, { success: true, message: 'Priorities berhasil disimpan' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 8. Candidates State
  if (pathname === '/api/candidates' && method === 'GET') {
    const candidates = storage.readCandidatesStateFile();
    return sendJson(res, 200, { success: true, candidates });
  }

  // 8b. Live Test Single Model via 9router
  if (pathname === '/api/test-model' && method === 'POST') {
    try {
      const body = await readBody(req);
      const modelId = body.model || body.modelId;
      if (!modelId) {
        return sendJson(res, 400, { success: false, error: 'Parameter model/modelId diperlukan.' });
      }

      const token = storage.get9routerCliToken();
      if (!token) {
        return sendJson(res, 503, { success: false, error: '9router CLI token tidak ditemukan atau server 9router offline.' });
      }

      const routerUrl = storage.resolveNineRouterUrl ? storage.resolveNineRouterUrl() : (process.env.NINEROUTER_URL || 'http://127.0.0.1:20128');
      const startTime = Date.now();
      const testRes = await fetch(`${routerUrl}/api/models/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-9r-cli-token': token
        },
        body: JSON.stringify({ model: modelId, kind: 'llm' }),
        signal: AbortSignal.timeout(20000)
      });

      const latencyMs = Date.now() - startTime;
      const data = await testRes.json().catch(() => ({}));

      return sendJson(res, 200, {
        success: true,
        model: modelId,
        ok: Boolean(data.ok),
        status: testRes.status,
        latencyMs,
        response: data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 9. Scheduler
  if (pathname === '/api/scheduler' && method === 'GET') {
    const status = scheduler.getSchedulerStatus();
    return sendJson(res, 200, { success: true, status });
  }

  if (pathname === '/api/scheduler/install' && method === 'POST') {
    try {
      scheduler.installScheduler();
      const status = scheduler.getSchedulerStatus();
      return sendJson(res, 200, { success: true, status, message: 'Scheduler berhasil diinstall/diperbarui!' });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 10. Sync Log file
  if (pathname === '/api/logs' && method === 'GET') {
    const logPath = path.join(__dirname, 'sync.log');
    let content = 'Belum ada log sync.';
    try {
      if (fs.existsSync(logPath)) {
        const raw = fs.readFileSync(logPath, 'utf8');
        content = raw.slice(-50000); // last ~50KB
      }
    } catch {}
    return sendJson(res, 200, { success: true, logs: content });
  }

  // 11. SSE Action Execution Stream
  if (pathname === '/api/actions/stream' && method === 'GET') {
    const action = url.searchParams.get('action'); // sync | dry-run | refresh | benchmarks | setup-cron
    if (currentProcess) {
      return sendJson(res, 409, { success: false, error: 'Ada proses CLI lain yang sedang berjalan!' });
    }

    let script = path.join(__dirname, 'sync.js');
    let cliArgs = [];

    if (action === 'dry-run') {
      cliArgs = ['--dry-run'];
    } else if (action === 'refresh') {
      cliArgs = ['--refresh'];
    } else if (action === 'benchmarks') {
      script = path.join(__dirname, 'update-benchmarks.js');
      cliArgs = [];
    } else if (action === 'setup-cron') {
      cliArgs = ['--setup-cron'];
    } else if (action === 'sync') {
      cliArgs = [];
    } else {
      return sendJson(res, 400, { success: false, error: 'Aksi tidak dikenali' });
    }

    if (isVerbose) {
      cliArgs.push('--verbose');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('start', { action, command: `node ${path.basename(script)} ${cliArgs.join(' ')}` });

    const proc = spawn(process.execPath, [script, ...cliArgs], {
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    currentProcess = proc;

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      if (isVerbose) process.stdout.write(`[PROC] ${text}`);
      sendEvent('log', { text });
    });

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      if (isVerbose) process.stderr.write(`[PROC stderr] ${text}`);
      sendEvent('log', { text, isError: true });
    });

    proc.on('close', code => {
      if (isVerbose) console.log(`[PROC] Process exited with code ${code}`);
      currentProcess = null;
      sendEvent('done', { code, success: code === 0 });
      res.end();
    });

    proc.on('error', err => {
      console.error(`[PROC ERROR] ${err.message}`);
      currentProcess = null;
      sendEvent('error', { error: err.message });
      res.end();
    });

    req.on('close', () => {
      // client disconnected
    });
    return;
  }

  // Not found
  return sendJson(res, 404, { success: false, error: 'API route not found' });
}

// ----------------------------------------------------------------------------
// HTTP Server Main
// ----------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.on('finish', () => {
    const elapsed = Date.now() - startTime;
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';
    const query = isVerbose && parsedUrl.search ? ` ${parsedUrl.search}` : '';
    console.log(`[HTTP] ${req.method} ${parsedUrl.pathname}${query} ${color}${status}${reset} (${elapsed}ms)`);
  });

  // CORS & Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (parsedUrl.pathname.startsWith('/api/')) {
    return handleApi(req, res, parsedUrl);
  }

  // SPA Route
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

function startServer(port = PORT, host = '0.0.0.0') {
  return server.listen(port, host, () => {
    console.log(`\n====================================================`);
    console.log(`  9router Auto-Free Web Console`);
    console.log(`  URL: http://localhost:${port}`);
    console.log(`  Auth: Synchronized with 9router SQLite password`);
    console.log(`  Mode: ${isVerbose ? 'Verbose (detailed logs enabled)' : 'Standard (use --verbose or -v for debug logs)'}`);
    console.log(`====================================================\n`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, PORT, startServer, isVerbose };
