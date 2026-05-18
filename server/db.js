// SQLite persistence layer for the SGTD IIoT Hub.
// Schema versioned via PRAGMA user_version; migrations are idempotent.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.SGTD_DB || path.join(DATA_DIR, 'sgtd.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- admin | editor | viewer
  created_at    INTEGER NOT NULL,
  last_login    INTEGER,
  UNIQUE(email)
);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token        TEXT UNIQUE NOT NULL,
  scopes       TEXT NOT NULL DEFAULT 'ingest',  -- comma-separated
  created_at   INTEGER NOT NULL,
  last_used    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tokens_workspace ON api_tokens(workspace_id);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  serial        TEXT NOT NULL,
  protocol      TEXT NOT NULL,    -- mqtt | http | lora
  description   TEXT,
  tags          TEXT,             -- comma-separated
  lat           REAL,
  lng           REAL,
  metadata      TEXT,             -- JSON blob
  device_token  TEXT UNIQUE NOT NULL,  -- per-device ingestion token
  -- LoRaWAN-specific
  dev_eui       TEXT,
  app_eui       TEXT,
  app_key       TEXT,
  -- MQTT-specific
  mqtt_username TEXT,
  mqtt_password TEXT,
  last_seen     INTEGER,
  online        INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_workspace ON devices(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_serial_ws ON devices(workspace_id, serial);

CREATE TABLE IF NOT EXISTS device_fields (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  unit         TEXT,
  type         TEXT NOT NULL DEFAULT 'number', -- number | boolean | string | location
  min          REAL,
  max          REAL,
  decimals     INTEGER DEFAULT 2,
  created_at   INTEGER NOT NULL,
  UNIQUE(device_id, key)
);

CREATE TABLE IF NOT EXISTS telemetry (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value_num  REAL,
  value_str  TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_field_ts ON telemetry(device_id, field, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts DESC);

-- Latest value cache, updated on insert via app
CREATE TABLE IF NOT EXISTS device_state (
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value_num  REAL,
  value_str  TEXT,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (device_id, field)
);

CREATE TABLE IF NOT EXISTS dashboards (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  layout       TEXT NOT NULL DEFAULT '[]',  -- JSON array of widgets
  is_default   INTEGER DEFAULT 0,
  created_at   INTEGER NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON dashboards(workspace_id);

CREATE TABLE IF NOT EXISTS rules (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,  -- nullable for ws-wide rules
  field        TEXT,
  operator     TEXT,         -- gt | lt | gte | lte | eq | neq | offline_for
  threshold    REAL,
  duration_s   INTEGER DEFAULT 0,
  severity     TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  message      TEXT,
  notify       TEXT,         -- JSON array of channel ids
  enabled      INTEGER DEFAULT 1,
  created_at   INTEGER NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_workspace ON rules(workspace_id);

CREATE TABLE IF NOT EXISTS alerts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id      TEXT REFERENCES rules(id) ON DELETE SET NULL,
  device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,
  severity     TEXT NOT NULL,
  message      TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  ack_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  ack_ts       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_workspace_ts ON alerts(workspace_id, ts DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ts          INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

// --- Schema migrations / version ----
const ver = db.pragma('user_version', { simple: true });
if (ver < 1) {
  db.pragma('user_version = 1');
}

function initialized() {
  const row = db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('admin');
  return row.c > 0;
}

module.exports = { db, initialized };
