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

function sanitizePathArg(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Invalid path argument');
  }
  return path.resolve(value);
}

function resolveNineRouterDir() {
  const arg = process.argv.find(a => a.startsWith('--nine-router-dir=') || a.startsWith('--router-dir=') || a.startsWith('--data-dir='));
  if (arg) return sanitizePathArg(arg.split('=')[1]);

  if (process.env.NINEROUTER_DIR) return sanitizePathArg(process.env.NINEROUTER_DIR);
  if (process.env.NINE_ROUTER_DIR) return sanitizePathArg(process.env.NINE_ROUTER_DIR);
  if (process.env.DATA_DIR) return sanitizePathArg(process.env.DATA_DIR);

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
  if (dbArg) return sanitizePathArg(dbArg.split('=')[1]);

  if (process.env.NINEROUTER_DB_PATH) return sanitizePathArg(process.env.NINEROUTER_DB_PATH);
  if (process.env.NINE_ROUTER_DB_PATH) return sanitizePathArg(process.env.NINE_ROUTER_DB_PATH);

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

    // Lookup default baseUrl from catalog if not in connection data
    let baseUrl = spec.baseUrl || data.baseUrl || '';
    if (!baseUrl) {
      const catalogItem = NINEROUTER_PROVIDER_CATALOG.find(p => p.key === provName || p.providerKey === provName);
      if (catalogItem?.defaultBaseUrl) {
        baseUrl = catalogItem.defaultBaseUrl;
      }
    }

    const apiKey = data.apiKey || '';
    const catalogItem = NINEROUTER_PROVIDER_CATALOG.find(p => p.key === provName || p.providerKey === provName);
    const label = spec.nodeName || conn.name || catalogItem?.label || provName;
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

function verify9routerPassword(inputPassword) {
  if (!inputPassword || typeof inputPassword !== 'string') return false;
  try {
    const Database = getDbClass();
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT data FROM settings LIMIT 1").get();
    db.close();
    if (!row || !row.data) return false;
    const settings = JSON.parse(row.data);
    if (!settings.password) return false;
    const bcrypt = require('bcryptjs');
    return bcrypt.compareSync(inputPassword, settings.password);
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

// Comprehensive 9router Provider Catalog
const NINEROUTER_PROVIDER_CATALOG = [
  // Free / Auto-Free Providers
  { key: 'oa', providerKey: 'oa', label: 'OpenAgentic.id', category: 'Free AI', combo: 'openagentic-free', prefixes: ['openagentic', 'oa'], defaultBaseUrl: 'https://openagentic.id/api/v1', defaultPrefix: 'openagentic', authType: 'apikey' },
  { key: 'kilo', providerKey: 'kilocode', label: 'Kilo.ai (KiloCode)', category: 'Free AI', combo: 'kilo-free', prefixes: ['kc', 'kilocode'], defaultBaseUrl: 'https://api.kilo.ai/api/gateway', defaultPrefix: 'kc', authType: 'apikey' },
  { key: 'openrouter', providerKey: 'openrouter', label: 'OpenRouter', category: 'Aggregator', combo: 'openrouter-free', prefixes: ['openrouter'], defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultPrefix: 'openrouter', authType: 'apikey' },
  { key: 'gemini', providerKey: 'gemini', label: 'Google Gemini', category: 'Major LLM', combo: 'gemini-free', prefixes: ['gemini'], defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultPrefix: 'gemini', authType: 'apikey' },
  { key: 'groq', providerKey: 'groq', label: 'Groq', category: 'Fast Inference', combo: 'groq-free', prefixes: ['groq'], defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultPrefix: 'groq', authType: 'apikey' },
  { key: 'cerebras', providerKey: 'cerebras', label: 'Cerebras', category: 'Fast Inference', combo: 'cerebras-free', prefixes: ['cerebras'], defaultBaseUrl: 'https://api.cerebras.ai/v1', defaultPrefix: 'cerebras', authType: 'apikey' },
  { key: 'mistral', providerKey: 'mistral', label: 'Mistral AI', category: 'Major LLM', combo: 'mistral-free', prefixes: ['mistral'], defaultBaseUrl: 'https://api.mistral.ai/v1', defaultPrefix: 'mistral', authType: 'apikey' },
  { key: 'cloudflare', providerKey: 'cloudflare-ai', label: 'Cloudflare Workers AI', category: 'Cloudflare', combo: 'cloudflare-free', prefixes: ['cloudflare-ai', 'cloudflare', 'cf'], defaultBaseUrl: '', defaultPrefix: 'cloudflare-ai', authType: 'apikey', needsAccountId: true },
  { key: 'bazaarlink', providerKey: 'bazaarlink', label: 'Bazaarlink', category: 'Free AI', combo: 'bazaarlink-free', prefixes: ['bazaarlink', 'bzl'], defaultBaseUrl: 'https://bazaarlink.ai/api/v1', defaultPrefix: 'bazaarlink', authType: 'apikey' },
  { key: 'poolside', providerKey: 'poolside', label: 'Poolside', category: 'Free AI', combo: 'poolside-free', prefixes: ['poolside'], defaultBaseUrl: 'https://inference.poolside.ai/v1', defaultPrefix: 'poolside', authType: 'apikey' },
  { key: 'ollama', providerKey: 'ollama', label: 'Ollama Cloud', category: 'Self-Hosted / Cloud', combo: 'ollama-free', prefixes: ['ollama'], defaultBaseUrl: 'https://api.ollama.com/v1', defaultPrefix: 'ollama', authType: 'apikey' },
  { key: 'airforce', providerKey: 'api-airforce', label: 'API.airforce', category: 'Free AI', combo: 'airforce-free', prefixes: ['api-airforce', 'airforce'], defaultBaseUrl: 'https://api.airforce/v1', defaultPrefix: 'api-airforce', authType: 'apikey' },
  { key: 'nvidia', providerKey: 'nvidia', label: 'NVIDIA NIM', category: 'Cloud GPU', combo: 'nvidia-free', prefixes: ['nvidia'], defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', defaultPrefix: 'nvidia', authType: 'apikey' },
  { key: 'bai', providerKey: 'b.ai', label: 'B.ai', category: 'Free AI', combo: 'b.ai-free', prefixes: ['b-ai', 'b.ai', 'bai'], defaultBaseUrl: 'https://api.b.ai/v1', defaultPrefix: 'b-ai', authType: 'apikey' },

  // Commercial & Major 9router Providers
  { key: 'openai', providerKey: 'openai', label: 'OpenAI', category: 'Major LLM', combo: 'openai-models', prefixes: ['openai', 'oai'], defaultBaseUrl: 'https://api.openai.com/v1', defaultPrefix: 'openai', authType: 'apikey' },
  { key: 'anthropic', providerKey: 'anthropic', label: 'Anthropic (Claude)', category: 'Major LLM', combo: 'anthropic-models', prefixes: ['anthropic', 'claude'], defaultBaseUrl: 'https://api.anthropic.com/v1', defaultPrefix: 'anthropic', authType: 'apikey' },
  { key: 'deepseek', providerKey: 'deepseek', label: 'DeepSeek', category: 'Major LLM', combo: 'deepseek-models', prefixes: ['deepseek'], defaultBaseUrl: 'https://api.deepseek.com/v1', defaultPrefix: 'deepseek', authType: 'apikey' },
  { key: 'siliconflow', providerKey: 'siliconflow', label: 'SiliconFlow (硅基流动)', category: 'Aggregator', combo: 'siliconflow-models', prefixes: ['siliconflow', 'sf'], defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultPrefix: 'siliconflow', authType: 'apikey' },
  { key: 'together', providerKey: 'together', label: 'Together AI', category: 'Inference', combo: 'together-models', prefixes: ['together'], defaultBaseUrl: 'https://api.together.xyz/v1', defaultPrefix: 'together', authType: 'apikey' },
  { key: 'sambanova', providerKey: 'sambanova', label: 'SambaNova Cloud', category: 'Fast Inference', combo: 'sambanova-models', prefixes: ['sambanova'], defaultBaseUrl: 'https://api.sambanova.ai/v1', defaultPrefix: 'sambanova', authType: 'apikey' },
  { key: 'fireworks', providerKey: 'fireworks', label: 'Fireworks AI', category: 'Inference', combo: 'fireworks-models', prefixes: ['fireworks'], defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', defaultPrefix: 'fireworks', authType: 'apikey' },
  { key: 'chutes', providerKey: 'chutes', label: 'Chutes AI', category: 'Inference', combo: 'chutes-models', prefixes: ['chutes'], defaultBaseUrl: 'https://api.chutes.ai/v1', defaultPrefix: 'chutes', authType: 'apikey' },
  { key: 'novita', providerKey: 'novita', label: 'Novita AI', category: 'Inference', combo: 'novita-models', prefixes: ['novita'], defaultBaseUrl: 'https://api.novita.ai/v3/openai', defaultPrefix: 'novita', authType: 'apikey' },
  { key: 'nebius', providerKey: 'nebius', label: 'Nebius AI Studio', category: 'Inference', combo: 'nebius-models', prefixes: ['nebius'], defaultBaseUrl: 'https://api.studio.nebius.ai/v1', defaultPrefix: 'nebius', authType: 'apikey' },
  { key: 'hyperbolic', providerKey: 'hyperbolic', label: 'Hyperbolic', category: 'Inference', combo: 'hyperbolic-models', prefixes: ['hyperbolic'], defaultBaseUrl: 'https://api.hyperbolic.xyz/v1', defaultPrefix: 'hyperbolic', authType: 'apikey' },
  { key: 'qwen', providerKey: 'qwen', label: 'Qwen (DashScope / Alibaba)', category: 'Major LLM', combo: 'qwen-models', prefixes: ['qwen', 'dashscope'], defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultPrefix: 'qwen', authType: 'apikey' },
  { key: 'kimi', providerKey: 'kimi', label: 'Moonshot AI (Kimi)', category: 'Major LLM', combo: 'kimi-models', prefixes: ['kimi', 'moonshot'], defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultPrefix: 'kimi', authType: 'apikey' },
  { key: 'minimax', providerKey: 'minimax', label: 'MiniMax AI', category: 'Major LLM', combo: 'minimax-models', prefixes: ['minimax'], defaultBaseUrl: 'https://api.minimax.chat/v1', defaultPrefix: 'minimax', authType: 'apikey' },
  { key: 'glm', providerKey: 'glm', label: 'Zhipu AI (GLM)', category: 'Major LLM', combo: 'glm-models', prefixes: ['glm', 'zhipu'], defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultPrefix: 'glm', authType: 'apikey' },
  { key: 'vercel-ai-gateway', providerKey: 'vercel-ai-gateway', label: 'Vercel AI Gateway', category: 'Aggregator', combo: 'vercel-models', prefixes: ['vercel-ai-gateway', 'vercel', 'vck'], defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1', defaultPrefix: 'vercel', authType: 'apikey' },
  { key: 'cohere', providerKey: 'cohere', label: 'Cohere', category: 'Major LLM', combo: 'cohere-models', prefixes: ['cohere'], defaultBaseUrl: 'https://api.cohere.com/v2', defaultPrefix: 'cohere', authType: 'apikey' },
  { key: 'perplexity', providerKey: 'perplexity', label: 'Perplexity', category: 'Search & LLM', combo: 'perplexity-models', prefixes: ['perplexity'], defaultBaseUrl: 'https://api.perplexity.ai', defaultPrefix: 'perplexity', authType: 'apikey' },
  { key: 'xai', providerKey: 'xai', label: 'xAI (Grok)', category: 'Major LLM', combo: 'xai-models', prefixes: ['xai', 'grok'], defaultBaseUrl: 'https://api.x.ai/v1', defaultPrefix: 'xai', authType: 'apikey' },

  // Custom OpenAI Compatible Node
  { key: 'openai-compatible', providerKey: 'openai-compatible', label: 'Custom OpenAI-Compatible Node', category: 'Custom Node', combo: 'custom-models', prefixes: ['custom'], defaultBaseUrl: '', defaultPrefix: '', authType: 'apikey', isCustom: true }
];

function getUnifiedProviderCatalog() {
  return NINEROUTER_PROVIDER_CATALOG;
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

function addProviderConnection(payload) {
  const { provider, name, apiKey, baseUrl, accountId, customPrefix } = payload;
  if (!provider) throw new Error('Provider identifier is required');

  const Database = getDbClass();
  const db = new Database(DB_PATH);

  // Check if provider is already installed and active
  const existingRows = db.prepare("SELECT * FROM providerConnections WHERE isActive = 1").all();
  for (const row of existingRows) {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch {}
    const p = String(row.provider || '').toLowerCase();
    const targetProv = String(provider).toLowerCase();

    // Direct provider name match
    if (p === targetProv) {
      db.close();
      throw new Error(`Provider '${provider}' sudah terpasang dan aktif di 9router!`);
    }

    // Custom openai-compatible prefix / baseUrl match
    const specPrefix = data?.providerSpecificData?.prefix || '';
    const specBaseUrl = data?.providerSpecificData?.baseUrl || '';
    if (customPrefix && specPrefix.toLowerCase() === customPrefix.toLowerCase()) {
      db.close();
      throw new Error(`Provider dengan prefix '${customPrefix}' sudah terpasang dan aktif!`);
    }
    if (baseUrl && specBaseUrl && specBaseUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')) {
      db.close();
      throw new Error(`Provider dengan Base URL '${baseUrl}' sudah terpasang dan aktif!`);
    }
  }

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  let providerCol = provider;
  let dataObj = {
    apiKey: apiKey || '',
    testStatus: 'active',
    providerSpecificData: {
      connectionProxyEnabled: false,
      connectionProxyUrl: '',
      connectionNoProxy: ''
    }
  };

  if (accountId) {
    dataObj.providerSpecificData.accountId = accountId;
  }
  if (baseUrl) {
    dataObj.providerSpecificData.baseUrl = baseUrl;
  }
  if (customPrefix) {
    dataObj.providerSpecificData.prefix = customPrefix;
  }

  // If custom/openai-compatible provider
  if (provider.startsWith('openai-compatible') || customPrefix) {
    providerCol = `openai-compatible-chat-${crypto.randomUUID()}`;
    dataObj.providerSpecificData.apiType = 'chat';
    dataObj.providerSpecificData.nodeName = name || provider;
  }

  db.prepare(`
    INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
    VALUES (?, ?, 'apikey', ?, NULL, 1, 1, ?, ?, ?)
  `).run(
    newId,
    providerCol,
    name || 'prod',
    JSON.stringify(dataObj),
    now,
    now
  );

  db.close();
  return { success: true, id: newId, provider: providerCol };
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
  addProviderConnection,
  readExclusionsFile,
  writeExclusionsFile,
  readPrioritiesFile,
  writePrioritiesFile,
  readCandidatesStateFile,
  getUnifiedProviderCatalog,
  NINEROUTER_PROVIDER_CATALOG,
  resolveNineRouterDir,
  resolveDbPath,
  resolveNineRouterUrl,
  CUSTOM_PROVIDERS_PATH,
  readCustomProvidersFile,
  writeCustomProvidersFile,
  getDynamicProviders
};


