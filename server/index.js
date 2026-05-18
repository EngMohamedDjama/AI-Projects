// SGTD IIoT Hub — single-process HTTP + WS + MQTT server.

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { db, initialized } = require('./db');
const auth = require('./auth');
const telemetry = require('./telemetry');
const mqttBroker = require('./mqtt');
const sim = require('./simulator');

const PORT = Number(process.env.PORT || 8080);
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- HTTP helpers ----------
function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) return resolve({});
      const ct = req.headers['content-type'] || '';
      try {
        if (ct.includes('application/json')) return resolve(JSON.parse(buf.toString('utf8')));
        if (ct.includes('application/x-www-form-urlencoded')) {
          return resolve(Object.fromEntries(new URLSearchParams(buf.toString('utf8'))));
        }
        return resolve(JSON.parse(buf.toString('utf8')));
      } catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon',
  '.woff2':'font/woff2', '.map':'application/json; charset=utf-8', '.txt':'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let fp = path.join(PUBLIC_DIR, pathname);
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(fp, (err, st) => {
    if (err) {
      // Fallback: serve app shell for SPA-style routes (no extension)
      if (!path.extname(pathname)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'app.html'), (e2, buf) => {
          if (e2) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buf);
        });
      }
      res.writeHead(404); return res.end('not found');
    }
    if (st.isDirectory()) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (e2, buf) => {
      if (e2) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
    });
  });
}

// ---------- Auth middleware ----------
function getBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}
function requireAuth(req) {
  const token = getBearer(req);
  return auth.verifyToken(token);
}
function requireAdmin(user) {
  return user && user.role === 'admin';
}

// ---------- WS broadcast ----------
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();
wss.on('connection', (ws, req, user) => {
  ws.user = user;
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'hello', user: { name: user.name, role: user.role } }));
});
telemetry.setBroadcaster((msg) => {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1 && ws.user && ws.user.workspace_id === msg.workspace_id) {
      ws.send(data);
    }
  }
});

// ---------- Route registry ----------
const routes = [];
function route(method, re, handler, opts = {}) {
  routes.push({ method, re: new RegExp('^' + re + '$'), handler, opts });
}

// =====================================================================
// PUBLIC ROUTES
// =====================================================================

route('GET', '/api/v1/status', async (req, res) => {
  json(res, 200, {
    ok: true,
    initialized: initialized(),
    version: '1.0.0',
    server_time: Date.now(),
  });
});

// Bootstrap — first admin signup. Only allowed when no admin exists.
route('POST', '/api/v1/setup', async (req, res) => {
  if (initialized()) return json(res, 400, { error: 'already_initialized' });
  const b = await readBody(req);
  const { workspace, name, email, password } = b;
  if (!workspace || !email || !password || !name) {
    return json(res, 400, { error: 'missing_fields' });
  }
  if (password.length < 8) return json(res, 400, { error: 'password_too_short' });
  const wsId = await auth.createWorkspace(workspace);
  const uid = await auth.createUser({ workspace_id: wsId, email, name, password, role: 'admin' });
  // Seed sample fleet so the platform never looks empty
  sim.seedSampleFleet(wsId, uid);
  sim.startSimulator();
  const user = auth.getUserByEmail(email);
  const token = auth.issueSession(user, req.headers['user-agent']);
  auth.audit({ workspace_id: wsId, user_id: uid, action: 'setup.admin_created',
               target: email, ip: req.socket.remoteAddress });
  json(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, workspace_id: wsId } });
});

route('POST', '/api/v1/auth/login', async (req, res) => {
  const b = await readBody(req);
  const { email, password } = b;
  if (!email || !password) return json(res, 400, { error: 'missing_fields' });
  const user = auth.getUserByEmail(email);
  if (!user) return json(res, 401, { error: 'invalid_credentials' });
  const ok = await auth.verifyPassword(password, user.password_hash);
  if (!ok) return json(res, 401, { error: 'invalid_credentials' });
  const token = auth.issueSession(user, req.headers['user-agent']);
  auth.audit({ workspace_id: user.workspace_id, user_id: user.id, action: 'auth.login',
               ip: req.socket.remoteAddress });
  json(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, workspace_id: user.workspace_id } });
});

route('POST', '/api/v1/auth/logout', async (req, res) => {
  const token = getBearer(req);
  auth.logout(token);
  json(res, 200, { ok: true });
});

route('PATCH', '/api/v1/auth/profile', async (req, res) => {
  const user = requireAuth(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });
  const b = await readBody(req);
  const sets = []; const vals = [];
  if (b.name && b.name.trim()) { sets.push('name = ?'); vals.push(b.name.trim()); }
  if (b.password) {
    if (b.password.length < 8) return json(res, 400, { error: 'password_too_short' });
    sets.push('password_hash = ?'); vals.push(await auth.hashPassword(b.password));
  }
  if (!sets.length) return json(res, 400, { error: 'no_changes' });
  vals.push(user.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  auth.audit({ workspace_id: user.workspace_id, user_id: user.id, action: 'profile.update', ip: req.socket.remoteAddress });
  json(res, 200, { ok: true });
});

route('GET', '/api/v1/auth/me', async (req, res) => {
  const user = requireAuth(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });
  const ws = db.prepare('SELECT id, name, slug FROM workspaces WHERE id = ?').get(user.workspace_id);
  json(res, 200, { user, workspace: ws });
});

// =====================================================================
// DEVICE INGESTION  (no session — uses device token or workspace API token)
// =====================================================================

function findDeviceByIngestAuth(req) {
  // Bearer device token, or query param ?token=
  const u = url.parse(req.url, true);
  const t = getBearer(req) || u.query.token;
  if (!t) return null;
  return db.prepare('SELECT * FROM devices WHERE device_token = ?').get(t);
}

route('POST', '/api/v1/ingest', async (req, res) => {
  const device = findDeviceByIngestAuth(req);
  if (!device) return json(res, 401, { error: 'invalid_device_token' });
  const b = await readBody(req);
  const frame = b.fields || b.data || b;
  if (!frame || typeof frame !== 'object') return json(res, 400, { error: 'invalid_frame' });
  const ts = Number(b.ts) || Date.now();
  // strip non-numeric/string/boolean
  const clean = {};
  for (const [k, v] of Object.entries(frame)) {
    if (k === 'ts') continue;
    if (['number','boolean','string'].includes(typeof v)) clean[k] = v;
  }
  telemetry.ingest(device, clean, ts);
  json(res, 200, { ok: true, accepted: Object.keys(clean).length, device_id: device.id, ts });
});

// LoRaWAN webhook (ChirpStack-compatible JSON)
route('POST', '/api/v1/integrations/lorawan', async (req, res) => {
  const b = await readBody(req);
  // ChirpStack v4 sends devEUI in `deviceInfo.devEui`, decoded values in `object`
  const devEui = (b.deviceInfo && b.deviceInfo.devEui) || b.devEUI || b.devEui;
  if (!devEui) return json(res, 400, { error: 'missing_devEui' });
  const device = db.prepare('SELECT * FROM devices WHERE upper(dev_eui) = upper(?)').get(devEui);
  if (!device) return json(res, 404, { error: 'unknown_device' });
  const frame = b.object || b.data || {};
  if (b.rxInfo && b.rxInfo[0]) {
    frame.rssi = b.rxInfo[0].rssi;
    frame.snr  = b.rxInfo[0].loRaSNR ?? b.rxInfo[0].snr;
  }
  telemetry.ingest(device, frame);
  json(res, 200, { ok: true });
});

// =====================================================================
// SESSION-AUTHENTICATED API
// =====================================================================

function withAuth(handler, { adminOnly = false, editorOnly = false } = {}) {
  return async (req, res, m) => {
    const user = requireAuth(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    if (adminOnly && user.role !== 'admin')
      return json(res, 403, { error: 'forbidden' });
    if (editorOnly && !['admin','editor'].includes(user.role))
      return json(res, 403, { error: 'forbidden' });
    return handler(req, res, m, user);
  };
}

// --- Devices ---
route('GET', '/api/v1/devices', withAuth(async (req, res, m, user) => {
  const rows = db.prepare(`SELECT id, name, serial, protocol, description, tags, lat, lng,
                                  online, last_seen, dev_eui, created_at
                           FROM devices WHERE workspace_id = ?
                           ORDER BY created_at DESC`).all(user.workspace_id);
  json(res, 200, { devices: rows });
}));

route('GET', '/api/v1/devices/([^/]+)', withAuth(async (req, res, m, user) => {
  const dev = db.prepare('SELECT * FROM devices WHERE id = ? AND workspace_id = ?')
                .get(m[1], user.workspace_id);
  if (!dev) return json(res, 404, { error: 'not_found' });
  const fields = db.prepare('SELECT * FROM device_fields WHERE device_id = ? ORDER BY created_at')
                   .all(dev.id);
  const state = db.prepare('SELECT * FROM device_state WHERE device_id = ?').all(dev.id);
  // Hide token unless admin/editor
  const isPrivileged = ['admin','editor'].includes(user.role);
  if (!isPrivileged) { delete dev.device_token; delete dev.mqtt_password; }
  json(res, 200, { device: dev, fields, state });
}));

route('POST', '/api/v1/devices', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const { name, serial, protocol = 'http', description, tags, lat, lng,
          dev_eui, app_eui, app_key, fields = [] } = b;
  if (!name || !serial) return json(res, 400, { error: 'missing_fields' });
  if (!['mqtt','http','lora'].includes(protocol)) return json(res, 400, { error: 'invalid_protocol' });
  const exists = db.prepare('SELECT 1 FROM devices WHERE workspace_id = ? AND serial = ?')
                   .get(user.workspace_id, serial);
  if (exists) return json(res, 409, { error: 'serial_taken' });
  const id = auth.uid('dev_');
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO devices (id, workspace_id, name, serial, protocol, description,
                  tags, lat, lng, device_token, dev_eui, app_eui, app_key,
                  mqtt_username, mqtt_password, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.workspace_id, name, serial, protocol, description || null,
         (Array.isArray(tags) ? tags.join(',') : tags) || null,
         lat ?? null, lng ?? null, token,
         dev_eui || null, app_eui || null, app_key || null,
         protocol === 'mqtt' ? serial : null,
         protocol === 'mqtt' ? token : null,
         auth.now(), user.id);
  const fi = db.prepare(`INSERT INTO device_fields
        (id, device_id, key, label, unit, type, min, max, decimals, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const f of fields) {
    if (!f.key) continue;
    fi.run(auth.uid('fld_'), id, f.key, f.label || f.key, f.unit || null,
           f.type || 'number', f.min ?? null, f.max ?? null, f.decimals ?? 2, auth.now());
  }
  auth.audit({ workspace_id: user.workspace_id, user_id: user.id, action: 'device.create',
               target: id, detail: { name, serial } });
  json(res, 200, { id, device_token: token });
}), { editorOnly: true });

route('PATCH', '/api/v1/devices/([^/]+)', withAuth(async (req, res, m, user) => {
  const dev = db.prepare('SELECT id FROM devices WHERE id = ? AND workspace_id = ?')
                .get(m[1], user.workspace_id);
  if (!dev) return json(res, 404, { error: 'not_found' });
  const b = await readBody(req);
  const sets = []; const vals = [];
  for (const k of ['name','description','tags','lat','lng','dev_eui','app_eui','app_key']) {
    if (k in b) { sets.push(`${k} = ?`); vals.push(b[k]); }
  }
  if (sets.length) {
    vals.push(m[1]);
    db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  json(res, 200, { ok: true });
}), { editorOnly: true });

route('DELETE', '/api/v1/devices/([^/]+)', withAuth(async (req, res, m, user) => {
  const r = db.prepare('DELETE FROM devices WHERE id = ? AND workspace_id = ?')
              .run(m[1], user.workspace_id);
  if (!r.changes) return json(res, 404, { error: 'not_found' });
  auth.audit({ workspace_id: user.workspace_id, user_id: user.id, action: 'device.delete', target: m[1] });
  json(res, 200, { ok: true });
}), { adminOnly: true });

// Device telemetry history
route('GET', '/api/v1/devices/([^/]+)/history', withAuth(async (req, res, m, user) => {
  const dev = db.prepare('SELECT id FROM devices WHERE id = ? AND workspace_id = ?')
                .get(m[1], user.workspace_id);
  if (!dev) return json(res, 404, { error: 'not_found' });
  const q = url.parse(req.url, true).query;
  const field = q.field;
  const from = Number(q.from) || (Date.now() - 60*60*1000);
  const to   = Number(q.to)   || Date.now();
  const limit = Math.min(Number(q.limit) || 1000, 10000);
  let rows;
  if (field) {
    rows = db.prepare(`SELECT field, value_num, ts FROM telemetry
                       WHERE device_id = ? AND field = ? AND ts BETWEEN ? AND ?
                       ORDER BY ts ASC LIMIT ?`)
             .all(m[1], field, from, to, limit);
  } else {
    rows = db.prepare(`SELECT field, value_num, ts FROM telemetry
                       WHERE device_id = ? AND ts BETWEEN ? AND ?
                       ORDER BY ts ASC LIMIT ?`)
             .all(m[1], from, to, limit);
  }
  json(res, 200, { rows });
}));

// Add a field to a device
route('POST', '/api/v1/devices/([^/]+)/fields', withAuth(async (req, res, m, user) => {
  const dev = db.prepare('SELECT id FROM devices WHERE id = ? AND workspace_id = ?')
                .get(m[1], user.workspace_id);
  if (!dev) return json(res, 404, { error: 'not_found' });
  const b = await readBody(req);
  if (!b.key) return json(res, 400, { error: 'missing_key' });
  const id = auth.uid('fld_');
  db.prepare(`INSERT INTO device_fields
        (id, device_id, key, label, unit, type, min, max, decimals, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m[1], b.key, b.label || b.key, b.unit || null,
         b.type || 'number', b.min ?? null, b.max ?? null, b.decimals ?? 2, auth.now());
  json(res, 200, { id });
}), { editorOnly: true });

// --- Dashboards ---
route('GET', '/api/v1/dashboards', withAuth(async (req, res, m, user) => {
  const rows = db.prepare(`SELECT id, name, description, is_default, created_at, updated_at
                           FROM dashboards WHERE workspace_id = ? ORDER BY is_default DESC, name ASC`)
                 .all(user.workspace_id);
  json(res, 200, { dashboards: rows });
}));

route('GET', '/api/v1/dashboards/([^/]+)', withAuth(async (req, res, m, user) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND workspace_id = ?')
              .get(m[1], user.workspace_id);
  if (!d) return json(res, 404, { error: 'not_found' });
  d.layout = JSON.parse(d.layout || '[]');
  json(res, 200, { dashboard: d });
}));

route('POST', '/api/v1/dashboards', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  if (!b.name) return json(res, 400, { error: 'missing_name' });
  const id = auth.uid('dash_');
  db.prepare(`INSERT INTO dashboards (id, workspace_id, name, description, layout,
                                      is_default, created_at, created_by, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(id, user.workspace_id, b.name, b.description || null,
         JSON.stringify(b.layout || []), auth.now(), user.id, auth.now());
  json(res, 200, { id });
}), { editorOnly: true });

route('PUT', '/api/v1/dashboards/([^/]+)', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const sets = []; const vals = [];
  if ('name' in b) { sets.push('name = ?'); vals.push(b.name); }
  if ('description' in b) { sets.push('description = ?'); vals.push(b.description); }
  if ('layout' in b) { sets.push('layout = ?'); vals.push(JSON.stringify(b.layout)); }
  if (!sets.length) return json(res, 400, { error: 'no_changes' });
  sets.push('updated_at = ?'); vals.push(auth.now());
  vals.push(m[1], user.workspace_id);
  const r = db.prepare(`UPDATE dashboards SET ${sets.join(', ')}
                        WHERE id = ? AND workspace_id = ?`).run(...vals);
  if (!r.changes) return json(res, 404, { error: 'not_found' });
  json(res, 200, { ok: true });
}), { editorOnly: true });

route('DELETE', '/api/v1/dashboards/([^/]+)', withAuth(async (req, res, m, user) => {
  const r = db.prepare('DELETE FROM dashboards WHERE id = ? AND workspace_id = ?')
              .run(m[1], user.workspace_id);
  if (!r.changes) return json(res, 404, { error: 'not_found' });
  json(res, 200, { ok: true });
}), { editorOnly: true });

// --- Rules ---
route('GET', '/api/v1/rules', withAuth(async (req, res, m, user) => {
  const rows = db.prepare(`SELECT * FROM rules WHERE workspace_id = ? ORDER BY created_at DESC`)
                 .all(user.workspace_id);
  json(res, 200, { rules: rows });
}));

route('POST', '/api/v1/rules', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  if (!b.name || !b.field || !b.operator) return json(res, 400, { error: 'missing_fields' });
  const id = auth.uid('r_');
  db.prepare(`INSERT INTO rules (id, workspace_id, name, device_id, field, operator,
                                 threshold, duration_s, severity, message, notify,
                                 enabled, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.workspace_id, b.name, b.device_id || null, b.field, b.operator,
         b.threshold ?? null, b.duration_s ?? 0, b.severity || 'warning',
         b.message || null, JSON.stringify(b.notify || []),
         b.enabled === false ? 0 : 1, auth.now(), user.id);
  json(res, 200, { id });
}), { editorOnly: true });

route('PATCH', '/api/v1/rules/([^/]+)', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const sets = []; const vals = [];
  for (const k of ['name','device_id','field','operator','threshold','duration_s',
                   'severity','message','enabled']) {
    if (k in b) { sets.push(`${k} = ?`); vals.push(typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k]); }
  }
  if (!sets.length) return json(res, 400, { error: 'no_changes' });
  vals.push(m[1], user.workspace_id);
  db.prepare(`UPDATE rules SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
    .run(...vals);
  json(res, 200, { ok: true });
}), { editorOnly: true });

route('DELETE', '/api/v1/rules/([^/]+)', withAuth(async (req, res, m, user) => {
  db.prepare('DELETE FROM rules WHERE id = ? AND workspace_id = ?')
    .run(m[1], user.workspace_id);
  json(res, 200, { ok: true });
}), { editorOnly: true });

// --- Alerts ---
route('GET', '/api/v1/alerts', withAuth(async (req, res, m, user) => {
  const q = url.parse(req.url, true).query;
  const limit = Math.min(Number(q.limit) || 100, 1000);
  let sql = `SELECT a.*, d.name AS device_name, d.serial AS device_serial,
                    r.name AS rule_name, u.name AS ack_by_name
             FROM alerts a
             LEFT JOIN devices d ON d.id = a.device_id
             LEFT JOIN rules r   ON r.id = a.rule_id
             LEFT JOIN users u   ON u.id = a.ack_by
             WHERE a.workspace_id = ?`;
  const args = [user.workspace_id];
  if (q.severity) { sql += ' AND a.severity = ?'; args.push(q.severity); }
  if (q.open === '1') { sql += ' AND a.ack_ts IS NULL'; }
  sql += ' ORDER BY a.ts DESC LIMIT ?';
  args.push(limit);
  json(res, 200, { alerts: db.prepare(sql).all(...args) });
}));

route('POST', '/api/v1/alerts/([^/]+)/ack', withAuth(async (req, res, m, user) => {
  db.prepare(`UPDATE alerts SET ack_by = ?, ack_ts = ?
              WHERE id = ? AND workspace_id = ? AND ack_ts IS NULL`)
    .run(user.id, auth.now(), m[1], user.workspace_id);
  json(res, 200, { ok: true });
}));

// --- Users (admin) ---
route('GET', '/api/v1/users', withAuth(async (req, res, m, user) => {
  const rows = db.prepare(`SELECT id, email, name, role, created_at, last_login
                           FROM users WHERE workspace_id = ? ORDER BY created_at ASC`)
                 .all(user.workspace_id);
  json(res, 200, { users: rows });
}));

route('POST', '/api/v1/users', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const { email, name, password, role = 'viewer' } = b;
  if (!email || !name || !password) return json(res, 400, { error: 'missing_fields' });
  if (password.length < 8) return json(res, 400, { error: 'password_too_short' });
  if (!['admin','editor','viewer'].includes(role)) return json(res, 400, { error: 'invalid_role' });
  const existing = auth.getUserByEmail(email);
  if (existing) return json(res, 409, { error: 'email_taken' });
  const id = await auth.createUser({ workspace_id: user.workspace_id, email, name, password, role });
  auth.audit({ workspace_id: user.workspace_id, user_id: user.id, action: 'user.create', target: id, detail: { email, role } });
  json(res, 200, { id });
}), { adminOnly: true });

route('PATCH', '/api/v1/users/([^/]+)', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const sets = []; const vals = [];
  if (b.role) { sets.push('role = ?'); vals.push(b.role); }
  if (b.name) { sets.push('name = ?'); vals.push(b.name); }
  if (b.password) {
    if (b.password.length < 8) return json(res, 400, { error: 'password_too_short' });
    sets.push('password_hash = ?'); vals.push(await auth.hashPassword(b.password));
  }
  if (!sets.length) return json(res, 400, { error: 'no_changes' });
  vals.push(m[1], user.workspace_id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...vals);
  json(res, 200, { ok: true });
}), { adminOnly: true });

route('DELETE', '/api/v1/users/([^/]+)', withAuth(async (req, res, m, user) => {
  if (m[1] === user.id) return json(res, 400, { error: 'cannot_delete_self' });
  db.prepare('DELETE FROM users WHERE id = ? AND workspace_id = ?').run(m[1], user.workspace_id);
  json(res, 200, { ok: true });
}), { adminOnly: true });

// --- API tokens (workspace-scoped) ---
route('GET', '/api/v1/tokens', withAuth(async (req, res, m, user) => {
  const rows = db.prepare(`SELECT id, name, scopes, created_at, last_used,
                                  substr(token, 1, 8) || '…' AS preview
                           FROM api_tokens WHERE workspace_id = ?`).all(user.workspace_id);
  json(res, 200, { tokens: rows });
}));

route('POST', '/api/v1/tokens', withAuth(async (req, res, m, user) => {
  const b = await readBody(req);
  const id = auth.uid('tok_');
  const token = 'sgtd_' + crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO api_tokens (id, workspace_id, user_id, name, token, scopes, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.workspace_id, user.id, b.name || 'API token', token,
         b.scopes || 'ingest', auth.now());
  json(res, 200, { id, token });
}), { adminOnly: true });

route('DELETE', '/api/v1/tokens/([^/]+)', withAuth(async (req, res, m, user) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND workspace_id = ?')
    .run(m[1], user.workspace_id);
  json(res, 200, { ok: true });
}), { adminOnly: true });

// --- Workspace overview metrics ---
route('GET', '/api/v1/metrics/overview', withAuth(async (req, res, m, user) => {
  const ws = user.workspace_id;
  const totals = db.prepare(`SELECT
      (SELECT COUNT(*) FROM devices WHERE workspace_id = ?) AS devices,
      (SELECT COUNT(*) FROM devices WHERE workspace_id = ? AND online = 1) AS online,
      (SELECT COUNT(*) FROM alerts  WHERE workspace_id = ? AND ack_ts IS NULL) AS alerts_open,
      (SELECT COUNT(*) FROM rules   WHERE workspace_id = ? AND enabled = 1) AS rules_active,
      (SELECT COUNT(*) FROM dashboards WHERE workspace_id = ?) AS dashboards,
      (SELECT COUNT(*) FROM users WHERE workspace_id = ?) AS users
  `).get(ws, ws, ws, ws, ws, ws);

  const since = Date.now() - 60_000;
  const msgs_per_minute = db.prepare(`SELECT COUNT(*) c FROM telemetry t
      JOIN devices d ON d.id = t.device_id
      WHERE d.workspace_id = ? AND t.ts > ?`).get(ws, since).c;

  // protocol mix
  const protos = db.prepare(`SELECT protocol, COUNT(*) c FROM devices
                             WHERE workspace_id = ? GROUP BY protocol`).all(ws);

  // health distribution
  const health = db.prepare(`SELECT
      SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) AS healthy,
      SUM(CASE WHEN online = 0 THEN 1 ELSE 0 END) AS offline
      FROM devices WHERE workspace_id = ?`).get(ws);

  // Recent alert counts by severity (24h)
  const sev = db.prepare(`SELECT severity, COUNT(*) c FROM alerts
      WHERE workspace_id = ? AND ts > ? GROUP BY severity`)
      .all(ws, Date.now() - 86400_000);

  // Per-minute throughput, last 30 min
  const buckets = [];
  for (let i = 29; i >= 0; i--) {
    const from = Date.now() - (i + 1) * 60_000;
    const to   = Date.now() - i * 60_000;
    const c = db.prepare(`SELECT COUNT(*) c FROM telemetry t
        JOIN devices d ON d.id = t.device_id
        WHERE d.workspace_id = ? AND t.ts BETWEEN ? AND ?`).get(ws, from, to).c;
    buckets.push({ ts: to, count: c });
  }

  json(res, 200, { totals: { ...totals, msgs_per_minute },
                   protocols: protos, health, severity: sev, throughput: buckets });
}));

// =====================================================================
// Dispatcher
// =====================================================================
async function dispatch(req, res) {
  const u = url.parse(req.url, true);
  const pathname = u.pathname.replace(/\/+$/, '') || '/';

  // CORS for ingestion (devices may be on different origins)
  if (pathname.startsWith('/api/v1/ingest') || pathname.startsWith('/api/v1/integrations')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      try { return await r.handler(req, res, m); }
      catch (e) {
        console.error('handler error', pathname, e);
        return json(res, 500, { error: 'internal_error' });
      }
    }
    return json(res, 404, { error: 'not_found' });
  }

  // Static
  if (pathname === '/') return serveStatic(req, res, '/index.html');
  return serveStatic(req, res, pathname);
}

// =====================================================================
// Server bootstrap
// =====================================================================
async function main() {
  const server = http.createServer((req, res) => {
    dispatch(req, res).catch(e => {
      console.error('dispatch error', e);
      if (!res.headersSent) res.writeHead(500); res.end();
    });
  });

  // WebSocket upgrade
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
    const u = url.parse(req.url, true);
    const user = auth.verifyToken(u.query.token);
    if (!user) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[http] listening on http://0.0.0.0:${PORT}`);
    console.log(initialized() ? '[init] platform already initialized' : '[init] awaiting first-run setup');
  });

  try { await mqttBroker.start({ port: MQTT_PORT }); }
  catch (e) { console.warn('[mqtt] broker disabled:', e.message); }

  if (initialized()) sim.startSimulator();
}
main();
module.exports = { startSimulator: sim.startSimulator };
