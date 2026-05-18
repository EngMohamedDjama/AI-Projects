// Telemetry ingestion + live broadcast + rules evaluation.
//
// A telemetry "frame" is a set of {field: value} pairs scoped to a device, at
// a single timestamp. Frames are persisted to `telemetry` (history) and
// `device_state` (latest cache), then broadcast to subscribed WebSocket
// clients and fed to the rule engine.

const { db } = require('./db');
const { uid, now } = require('./auth');

// Pluggable WebSocket broadcaster — wired up by index.js
let broadcaster = () => {};
function setBroadcaster(fn) { broadcaster = fn; }

const insertTelemetryStmt = db.prepare(`
  INSERT INTO telemetry (device_id, field, value_num, value_str, ts)
  VALUES (?, ?, ?, ?, ?)
`);
const upsertStateStmt = db.prepare(`
  INSERT INTO device_state (device_id, field, value_num, value_str, ts)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(device_id, field) DO UPDATE SET
    value_num = excluded.value_num,
    value_str = excluded.value_str,
    ts        = excluded.ts
`);
const markOnlineStmt = db.prepare(`
  UPDATE devices SET last_seen = ?, online = 1 WHERE id = ?
`);

const ingestTx = db.transaction((deviceId, frame, ts) => {
  markOnlineStmt.run(ts, deviceId);
  for (const [key, raw] of Object.entries(frame)) {
    const isNum = typeof raw === 'number' && Number.isFinite(raw);
    const num = isNum ? raw : (typeof raw === 'boolean' ? (raw ? 1 : 0) : null);
    const str = isNum ? null : (typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw));
    insertTelemetryStmt.run(deviceId, key, num, str, ts);
    upsertStateStmt.run(deviceId, key, num, str, ts);
  }
});

function ingest(device, frame, ts = now()) {
  if (!device || !frame || typeof frame !== 'object') return;
  ingestTx(device.id, frame, ts);
  // Broadcast to subscribers
  broadcaster({
    type: 'telemetry',
    workspace_id: device.workspace_id,
    device_id: device.id,
    serial: device.serial,
    fields: frame,
    ts,
  });
  // Rules
  try { evaluateRules(device, frame, ts); }
  catch (e) { console.error('rule eval error', e); }
}

// --- Rules engine ---
const getActiveRulesStmt = db.prepare(`
  SELECT * FROM rules WHERE enabled = 1
    AND workspace_id = ?
    AND (device_id IS NULL OR device_id = ?)
`);

function evaluateRules(device, frame, ts) {
  const rules = getActiveRulesStmt.all(device.workspace_id, device.id);
  for (const r of rules) {
    if (!r.field) continue;
    const v = frame[r.field];
    if (v == null) continue;
    const num = typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));
    if (!Number.isFinite(num)) continue;
    let triggered = false;
    switch (r.operator) {
      case 'gt':  triggered = num > r.threshold; break;
      case 'gte': triggered = num >= r.threshold; break;
      case 'lt':  triggered = num < r.threshold; break;
      case 'lte': triggered = num <= r.threshold; break;
      case 'eq':  triggered = num === r.threshold; break;
      case 'neq': triggered = num !== r.threshold; break;
    }
    if (!triggered) continue;

    // Dedupe: only fire once per (rule, device) within 60s window
    const recent = db.prepare(`SELECT id FROM alerts
        WHERE rule_id = ? AND device_id = ? AND ts > ?`)
      .get(r.id, device.id, ts - 60_000);
    if (recent) continue;

    const id = uid('al_');
    const msg = (r.message && r.message.trim())
      || `${r.name} — ${r.field}=${num.toFixed(2)} ${r.operator} ${r.threshold}`;
    db.prepare(`INSERT INTO alerts
       (id, workspace_id, rule_id, device_id, severity, message, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, device.workspace_id, r.id, device.id, r.severity, msg, ts);
    broadcaster({
      type: 'alert',
      workspace_id: device.workspace_id,
      alert: { id, severity: r.severity, message: msg, device_id: device.id, ts },
    });
  }
}

// Mark devices offline if last_seen older than threshold
const OFFLINE_AFTER_MS = 5 * 60_000;
function reapOffline() {
  const cutoff = now() - OFFLINE_AFTER_MS;
  const changed = db.prepare(`UPDATE devices SET online = 0
                              WHERE online = 1 AND last_seen < ?`).run(cutoff);
  return changed.changes;
}
setInterval(reapOffline, 30_000);

module.exports = { ingest, setBroadcaster };
