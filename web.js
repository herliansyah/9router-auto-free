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

    const activeProvKeys = new Set(rawConnections.filter(c => c.isActive).map(c => String(c.provider || '').toLowerCase()));
    const customConfig = storage.readCustomProvidersFile ? storage.readCustomProvidersFile() : {};
    const catalog = storage.getUnifiedProviderCatalog();

    const providerStats = catalog
      .filter(p => activeProvKeys.has(String(p.key).toLowerCase()) || activeProvKeys.has(String(p.providerKey).toLowerCase()))
      .map(p => {
        const pCombo = combos.find(c => c.name === p.combo || (p.prefixes && p.prefixes.some(pref => c.name === `${pref}-free`)));
        const modelCount = pCombo?.models?.length || 0;
        return {
          label: p.label,
          key: p.key,
          category: p.category,
          modelCount,
          autoSyncEnabled: (customConfig[p.key] || customConfig[p.providerKey] || {}).enabled !== false
        };
      });

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

  // 5. Providers with Active Status & Duplicate Prevention
  if (pathname === '/api/providers' && method === 'GET') {
    const rawConnections = storage.readAllConnectionsRaw();
    const activeConnections = rawConnections.filter(c => c.isActive);
    const catalog = storage.getUnifiedProviderCatalog();
    const customConfig = storage.readCustomProvidersFile ? storage.readCustomProvidersFile() : {};

    const providerList = catalog.map(p => {
      // Find matching connection
      const matched = activeConnections.find(c => {
        const provName = String(c.provider || '').toLowerCase();
        const pKey = String(p.providerKey || p.key).toLowerCase();
        if (provName === pKey || provName === String(p.key).toLowerCase()) return true;
        if (p.prefixes && p.prefixes.some(pref => provName === pref.toLowerCase() || provName.startsWith(pref.toLowerCase() + '-'))) return true;
        const baseUrl = c.data?.providerSpecificData?.baseUrl || c.data?.baseUrl || '';
        if (p.defaultBaseUrl && baseUrl && baseUrl.replace(/\/+$/, '') === p.defaultBaseUrl.replace(/\/+$/, '')) return true;
        const prefix = c.data?.providerSpecificData?.prefix || '';
        if (prefix && p.prefixes && p.prefixes.includes(prefix.toLowerCase())) return true;
        return false;
      });

      return {
        key: p.key,
        providerKey: p.providerKey || p.key,
        label: p.label,
        category: p.category || 'Standard',
        combo: p.combo || (p.key + '-free'),
        prefixes: p.prefixes || [p.defaultPrefix || p.key],
        defaultBaseUrl: p.defaultBaseUrl || '',
        defaultPrefix: p.defaultPrefix || '',
        isCustom: !!p.isCustom,
        needsAccountId: !!p.needsAccountId,
        isInstalled: !!matched,
        isActive: !!matched,
        autoSyncEnabled: (customConfig[matched?.id] || customConfig[p.key] || customConfig[p.providerKey] || {}).enabled !== false,
        connectionId: matched ? matched.id : null,
        connectionName: matched ? matched.name : null
      };
    });

    // Also include extra connections from 9router sqlite
    const matchedConnectionIds = new Set(providerList.filter(p => p.connectionId).map(p => p.connectionId));
    const extraConnections = rawConnections
      .filter(c => !matchedConnectionIds.has(c.id))
      .map(c => {
        const cfg = customConfig[c.id] || customConfig[c.provider] || {};
        return {
          key: c.provider,
          providerKey: c.provider,
          label: c.name ? `${c.name} (${c.provider.split('-')[0]})` : c.provider,
          category: 'Custom / Dynamic Node',
          combo: `${cfg.prefix || c.data?.providerSpecificData?.prefix || c.provider.split('-')[0]}-free`,
          prefixes: [cfg.prefix || c.data?.providerSpecificData?.prefix || c.provider],
          defaultBaseUrl: c.data?.providerSpecificData?.baseUrl || '',
          defaultPrefix: cfg.prefix || c.data?.providerSpecificData?.prefix || '',
          isCustom: true,
          needsAccountId: false,
          isInstalled: true,
          isActive: c.isActive,
          autoSyncEnabled: cfg.enabled !== false,
          connectionId: c.id,
          connectionName: c.name
        };
      });

    return sendJson(res, 200, { success: true, providers: [...providerList, ...extraConnections] });
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

  if (pathname === '/api/providers' && method === 'POST') {
    try {
      const body = await readBody(req);
      const result = storage.addProviderConnection(body);
      return sendJson(res, 200, { success: true, data: result, message: 'Provider berhasil ditambahkan ke 9router!' });
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
      sendEvent('log', { text: chunk.toString() });
    });

    proc.stderr.on('data', chunk => {
      sendEvent('log', { text: chunk.toString(), isError: true });
    });

    proc.on('close', code => {
      currentProcess = null;
      sendEvent('done', { code, success: code === 0 });
      res.end();
    });

    proc.on('error', err => {
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
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

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
    console.log(`====================================================\n`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, PORT, startServer };
