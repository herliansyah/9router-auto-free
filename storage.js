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
const NINE_ROUTER_DIR = path.join(HOME, '.9router');
const DB_PATH = path.join(NINE_ROUTER_DIR, 'db', 'data.sqlite');
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

module.exports = {
  DB_PATH,
  NINE_ROUTER_DIR,
  getDbClass,
  get9routerCliToken,
  readProviderConnection,
  readAllProviderConnections,
  readCurrentComboModels,
  readUsageFeedback,
  persistCombos
};
