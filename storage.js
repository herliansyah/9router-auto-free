/**
 * Storage adapter for 9router SQLite database and API fallback.
 * Encapsulates database connection management, credentials scanning,
 * combo persistence, and usage feedback queries behind a deep interface.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const HOME = os.homedir();

function resolveNineRouterDir() {
  const arg = process.argv.find(a => a.startsWith('--nine-router-dir=') || a.startsWith('--router-dir=') || a.startsWith('--data-dir='));
  if (arg) return path.resolve(arg.split('=')[1]);

  if (process.env.NINEROUTER_DIR) return path.resolve(process.env.NINEROUTER_DIR);
  if (process.env.NINE_ROUTER_DIR) return path.resolve(process.env.NINE_ROUTER_DIR);
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);

  if (fs.existsSync('/app/data/db/data.sqlite')) return '/app/data';

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const winDir = path.join(appData, '9router');
    if (fs.existsSync(winDir)) return winDir;
  }

  return path.join(os.homedir(), '.9router');
}

function resolveDbPath() {
  const dbArg = process.argv.find(a => a.startsWith('--db-path='));
  if (dbArg) return path.resolve(dbArg.split('=')[1]);

  if (process.env.NINEROUTER_DB_PATH) return path.resolve(process.env.NINEROUTER_DB_PATH);
  if (process.env.NINE_ROUTER_DB_PATH) return path.resolve(process.env.NINE_ROUTER_DB_PATH);

  const dir = resolveNineRouterDir();
  return path.join(dir, 'db', 'data.sqlite');
}

function resolveNineRouterUrl() {
  const urlArg = process.argv.find(a => a.startsWith('--router-url='));
  if (urlArg) return urlArg.split('=')[1].replace(/\/+$/, '');
  const portArg = process.argv.find(a => a.startsWith('--router-port='));
  if (portArg) return `http://127.0.0.1:${portArg.split('=')[1]}`;
  if (process.env.NINEROUTER_URL) return process.env.NINEROUTER_URL.replace(/\/+$/, '');
  if (process.env.NINE_ROUTER_URL) return process.env.NINE_ROUTER_URL.replace(/\/+$/, '');
  if (process.env.NINEROUTER_PORT) return `http://127.0.0.1:${process.env.NINEROUTER_PORT}`;
  return 'http://127.0.0.1:20128';
}

const NINE_ROUTER_DIR = resolveNineRouterDir();
const DB_PATH = resolveDbPath();
const BETTER_SQLITE_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', 'better-sqlite3');
const CLIENT_PATH = path.join(HOME, '.npm-global', 'lib', 'node_modules', '9router', 'src', 'cli', 'api', 'client.js');

// ponytail: sqlite driver loader - prefers native node:sqlite (Node >= 22.5, zero native compile) with cross-platform better-sqlite3 fallbacks
function getDbClass() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (typeof DatabaseSync === 'function') {
      return class NodeSqliteAdapter {
        constructor(filePath, options = {}) {
          const opts = {};
          if (options.readonly !== undefined) opts.readOnly = Boolean(options.readonly);
          if (options.readOnly !== undefined) opts.readOnly = Boolean(options.readOnly);
          this._db = new DatabaseSync(filePath, opts);
        }
        prepare(sql) {
          const stmt = this._db.prepare(sql);
          return {
            get(...args) {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              return stmt.get(...params);
            },
            all(...args) {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              return stmt.all(...params);
            },
            run(...args) {
              const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
              return stmt.run(...params);
            }
          };
        }
        exec(sql) {
          return this._db.exec(sql);
        }
        close() {
          return this._db.close();
        }
      };
    }
  } catch {}

  const candidates = [
    () => require('better-sqlite3'),
    () => require(path.join(NINE_ROUTER_DIR, 'runtime', 'node_modules', 'better-sqlite3')),
    () => process.platform === 'win32' && require(path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'npm', 'node_modules', 'better-sqlite3')),
    () => require(BETTER_SQLITE_PATH),
  ];

  for (const load of candidates) {
    try {
      const mod = load();
      if (typeof mod === 'function') return mod;
    } catch {}
  }

  throw new Error('No functional SQLite driver found. Node.js >= 22.5 is recommended (includes node:sqlite), or install better-sqlite3.');
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

// Read one active provider connection from SQLite
function readProviderConnection(providerName) {
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

// Read all active provider connections from SQLite
function readAllProviderConnections() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM providerConnections WHERE isActive = 1").all();
    db.close();
    return rows.map(r => ({
      provider: r.provider,
      data: (() => { try { return JSON.parse(r.data || '{}'); } catch { return {}; } })()
    }));
  } catch (err) {
    console.warn(`[!] Warning: Could not read 9router DB connections: ${err.message}`);
    return [];
  }
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

// Read usage history from 9router SQLite to rank providers by observed reliability
function readUsageFeedback() {
  const stats = new Map(); // key: "provider|model" -> { ok: count, err: count }
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(`
      SELECT provider, model, statusCode
      FROM usageHistory
      WHERE createdAt >= datetime('now', '-7 days')
      ORDER BY createdAt DESC
      LIMIT 10000
    `).all();
    db.close();

    for (const r of rows) {
      const prov = String(r.provider || '').toLowerCase();
      const mod = String(r.model || '').toLowerCase();
      if (!prov || !mod) continue;
      const key = `${prov}|${mod}`;
      if (!stats.has(key)) stats.set(key, { ok: 0, err: 0 });
      const entry = stats.get(key);
      const code = Number(r.statusCode);
      if (code >= 200 && code < 400) {
        entry.ok++;
      } else {
        entry.err++;
      }
    }
  } catch {}
  return stats;
}

// Persist combo map via 9router API client (if running) and SQLite (always)
async function persistCombos(comboMap) {
  let updatedViaApi = false;

  // 1. Try updating via 9router API client if server is running
  try {
    let client;
    try {
      client = require('9router/src/cli/api/client.js');
    } catch {
      client = require(CLIENT_PATH);
    }
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

  // 2. Direct SQLite update
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
}

// ----------------------------------------------------------------------------
// Web Console & Auth helpers
// ----------------------------------------------------------------------------

const EXCLUSIONS_PATH = path.join(__dirname, 'exclusions.json');
const PRIORITIES_PATH = path.join(__dirname, 'priorities.json');
const CANDIDATES_STATE_PATH = path.join(__dirname, 'candidates-state.json');
const CUSTOM_PROVIDERS_PATH = path.join(__dirname, 'custom-providers.json');

function readCustomProvidersFile() {
  try {
    if (fs.existsSync(CUSTOM_PROVIDERS_PATH)) {
      return JSON.parse(fs.readFileSync(CUSTOM_PROVIDERS_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function writeCustomProvidersFile(data) {
  fs.writeFileSync(CUSTOM_PROVIDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getDynamicProviders() {
  const customConfig = readCustomProvidersFile();
  const rawConnections = readAllConnectionsRaw();
  const activeConnections = rawConnections.filter(c => c.isActive);

  // Built-in provider keys & prefixes to avoid duplicate processing
  const builtInKeys = new Set(['oa', 'kilo', 'oc', 'openrouter', 'poolside', 'gemini', 'ollama', 'airforce', 'bazaarlink', 'bai', 'groq', 'cerebras', 'mistral', 'cloudflare', 'nvidia']);
  const builtInPrefixes = new Set(['openagentic', 'oa', 'kc', 'kilocode', 'oc', 'opencode', 'openrouter', 'poolside', 'gemini', 'ollama', 'api-airforce', 'airforce', 'bazaarlink', 'bzl', 'b-ai', 'b.ai', 'bai', 'groq', 'cerebras', 'mistral', 'cloudflare-ai', 'cloudflare', 'cf', 'nvidia']);

  const dynamicProviders = [];

  for (const conn of activeConnections) {
    const provName = String(conn.provider || '').toLowerCase();
    const data = conn.data || {};
    const spec = data.providerSpecificData || {};
    const rawPrefix = (spec.prefix || conn.name || provName.split('-')[0] || 'custom').toLowerCase();

    // If matches built-in provider, skip (it's handled by built-in adapter)
    if (builtInKeys.has(provName) || builtInPrefixes.has(provName) || builtInPrefixes.has(rawPrefix)) {
      continue;
    }

    // Lookup default baseUrl if not in connection data
    const KNOWN_PROVIDER_BASE_URLS = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      deepseek: 'https://api.deepseek.com/v1',
      together: 'https://api.together.xyz/v1',
      sambanova: 'https://api.sambanova.ai/v1',
      fireworks: 'https://api.fireworks.ai/inference/v1',
      chutes: 'https://api.chutes.ai/v1',
      siliconflow: 'https://api.siliconflow.cn/v1'
    };
    const baseUrl = spec.baseUrl || data.baseUrl || KNOWN_PROVIDER_BASE_URLS[provName] || '';
    const apiKey = data.apiKey || '';
    const label = spec.nodeName || conn.name || provName;
    const config = customConfig[conn.id] || customConfig[provName] || customConfig[rawPrefix] || {};

    const enabled = config.enabled !== false;
    const prefix = config.prefix || rawPrefix;

    dynamicProviders.push({
      id: conn.id,
      key: `dynamic-${conn.id}`,
      provider: conn.provider,
      label,
      apiKey,
      baseUrl,
      prefix,
      prefixes: [prefix],
      combo: `${prefix}-free`,
      enabled,
      freePattern: config.freePattern || null,
      modelsEndpoint: config.modelsEndpoint || null,
      skipPatterns: config.skipPatterns || ['tts', 'embed', 'image', 'whisper', 'diffusion', 'rerank', 'guard', 'audio', 'speech']
    });
  }

  return dynamicProviders;
}

function getAuthSecret() {
  try {
    const jwtSecretPath = path.join(NINE_ROUTER_DIR, 'jwt-secret');
    if (fs.existsSync(jwtSecretPath)) {
      const s = fs.readFileSync(jwtSecretPath, 'utf8').trim();
      if (s) return s;
    }
  } catch {}
  try {
    const cliSecretPath = path.join(NINE_ROUTER_DIR, 'auth', 'cli-secret');
    if (fs.existsSync(cliSecretPath)) {
      const s = fs.readFileSync(cliSecretPath, 'utf8').trim();
      if (s) return s;
    }
  } catch {}
  return '9router-auto-free-secret-fallback';
}

function verify9routerPassword(inputPassword, dbPath = resolveDbPath()) {
  if (!inputPassword || typeof inputPassword !== 'string') return false;
  try {
    const Database = getDbClass();
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT data FROM settings LIMIT 1").get();
    db.close();
    if (!row || !row.data) return false;
    const settings = JSON.parse(row.data);
    const candidate = inputPassword.trim();
    if (!settings.password) {
      const defaultPassword = process.env.INITIAL_PASSWORD || '123456';
      return candidate === defaultPassword;
    }
    const bcrypt = require('bcryptjs');
    return bcrypt.compareSync(candidate, settings.password);
  } catch (err) {
    console.error(`[!] Password verification error: ${err.message}`);
    return false;
  }
}

function createSessionToken() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT data FROM settings LIMIT 1").get();
    db.close();
    const settings = row && row.data ? JSON.parse(row.data) : {};
    const pwdHash = settings.password || 'default';
    const payload = {
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      ph: crypto.createHash('sha256').update(pwdHash).digest('hex').substring(0, 16)
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
  } catch {
    return null;
  }
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  try {
    const [body, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
    if (sig !== expectedSig) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return false;

    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT data FROM settings LIMIT 1").get();
    db.close();
    const settings = row && row.data ? JSON.parse(row.data) : {};
    const currentPh = crypto.createHash('sha256').update(settings.password || 'default').digest('hex').substring(0, 16);
    return payload.ph === currentPh;
  } catch {
    return false;
  }
}

function readAllCombosDetailed() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM combos ORDER BY name ASC").all();
    db.close();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      models: (() => { try { return JSON.parse(r.models || '[]'); } catch { return []; } })(),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  } catch (err) {
    return [];
  }
}

function readAllConnectionsRaw() {
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt FROM providerConnections").all();
    db.close();
    return rows.map(r => ({
      id: r.id,
      provider: r.provider,
      authType: r.authType,
      name: r.name,
      isActive: r.isActive === 1,
      data: (() => { try { return JSON.parse(r.data || '{}'); } catch { return {}; } })(),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  } catch (err) {
    return [];
  }
}

function readExclusionsFile() {
  try {
    if (fs.existsSync(EXCLUSIONS_PATH)) {
      return JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, 'utf8'));
    }
  } catch {}
  return [];
}

function writeExclusionsFile(data) {
  fs.writeFileSync(EXCLUSIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function readPrioritiesFile() {
  try {
    if (fs.existsSync(PRIORITIES_PATH)) {
      return JSON.parse(fs.readFileSync(PRIORITIES_PATH, 'utf8'));
    }
  } catch {}
  return [];
}

function writePrioritiesFile(data) {
  fs.writeFileSync(PRIORITIES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function readCandidatesStateFile() {
  try {
    if (fs.existsSync(CANDIDATES_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(CANDIDATES_STATE_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

module.exports = {
  DB_PATH,
  NINE_ROUTER_DIR,
  EXCLUSIONS_PATH,
  PRIORITIES_PATH,
  CANDIDATES_STATE_PATH,
  getDbClass,
  get9routerCliToken,
  readProviderConnection,
  readAllProviderConnections,
  readAllConnectionsRaw,
  readCurrentComboModels,
  readAllCombosDetailed,
  readUsageFeedback,
  persistCombos,
  verify9routerPassword,
  createSessionToken,
  verifySessionToken,
  readExclusionsFile,
  writeExclusionsFile,
  readPrioritiesFile,
  writePrioritiesFile,
  readCandidatesStateFile,
  resolveNineRouterDir,
  resolveDbPath,
  resolveNineRouterUrl,
  CUSTOM_PROVIDERS_PATH,
  readCustomProvidersFile,
  writeCustomProvidersFile,
  getDynamicProviders
};


