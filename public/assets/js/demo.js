// Browser-only fake backend.
//
// Activated automatically when the page is served from raw.githack / githack /
// any static host where /api/v1/* would 404. Implements the same REST + WS
// surface that server/index.js exposes, persisted entirely in localStorage.
//
// This lets the platform run as a fully interactive demo with no Node.js
// server — perfect for sharing a preview link.

(() => {
  const isStaticHost =
    /githack|githubusercontent|netlify|vercel|pages\.dev|github\.io|file:/i.test(location.host + location.protocol) ||
    new URLSearchParams(location.search).get('demo') === '1' ||
    localStorage.getItem('sgtd.demo') === '1';
  if (!isStaticHost) return;
  localStorage.setItem('sgtd.demo', '1');

  // ---------------- Store ----------------
  const KEY = 'sgtd.demo.db.v1';
  const now = () => Date.now();
  const uid = (p='') => p + Math.random().toString(36).slice(2, 11);

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(DB)); }
  const DB = Object.assign({
    workspace: null,
    users: [],          // {id, email, name, password, role, created_at, last_login}
    sessions: [],       // {token, user_id, expires_at}
    devices: [],        // {id, name, serial, protocol, tags, lat, lng, description, device_token, dev_eui, last_seen, online, created_at}
    fields: [],         // {id, device_id, key, label, unit, type, min, max, decimals}
    telemetry: [],      // {device_id, field, value_num, ts}
    state: {},          // device_id -> {field -> {value_num, ts}}
    dashboards: [],     // {id, name, description, layout, is_default, updated_at}
    rules: [],          // {id, name, device_id, field, operator, threshold, severity, message, enabled}
    alerts: [],         // {id, severity, message, device_id, rule_id, ts, ack_by, ack_ts}
    tokens: [],         // {id, name, token, scopes, created_at, last_used}
  }, load());

  function initialized() { return DB.users.some(u => u.role === 'admin'); }
  function getSession(token) {
    const s = DB.sessions.find(x => x.token === token && x.expires_at > now());
    return s ? DB.users.find(u => u.id === s.user_id) : null;
  }

  // ------------- Seed sample fleet -------------
  const FACILITIES = [
    { name: 'Djibouti Port — Terminal A', lat: 11.6022, lng: 43.1456 },
    { name: 'Doraleh Container Hub',      lat: 11.6650, lng: 43.0700 },
    { name: 'Damerjog Industrial Zone',   lat: 11.5180, lng: 43.2500 },
    { name: 'Ali Sabieh Cement Works',    lat: 11.1545, lng: 42.7120 },
    { name: 'Tadjourah Logistics Park',   lat: 11.7858, lng: 42.8819 },
  ];
  const PROFILES = [
    { type: 'Temperature',  protocol: 'mqtt', fields: [{ key: 'temp', label: 'Temperature', unit: '°C', min: 18, max: 92 }] },
    { type: 'Vibration',    protocol: 'mqtt', fields: [{ key: 'vib', label: 'Vibration', unit: 'mm/s', min: 0.2, max: 14 }] },
    { type: 'Energy Meter', protocol: 'mqtt', fields: [
      { key: 'power',  label: 'Active Power', unit: 'kW',  min: 0,   max: 250 },
      { key: 'energy', label: 'Energy',       unit: 'kWh', min: 240, max: 4900 },
      { key: 'voltage', label: 'Voltage',     unit: 'V',   min: 220, max: 245 },
    ]},
    { type: 'Flow',         protocol: 'mqtt', fields: [{ key: 'flow', label: 'Flow Rate', unit: 'm³/h', min: 5, max: 320 }] },
    { type: 'Soil Moisture',protocol: 'lora', fields: [{ key: 'moisture', label: 'Soil Moisture', unit: '%', min: 12, max: 78 }] },
    { type: 'Tank Level',   protocol: 'lora', fields: [
      { key: 'level',   label: 'Tank Level', unit: '%', min: 5, max: 99 },
      { key: 'battery', label: 'Battery',    unit: '%', min: 30, max: 100 },
    ]},
    { type: 'Air Quality',  protocol: 'lora', fields: [
      { key: 'aqi',  label: 'AQI',  unit: '',    min: 22, max: 220 },
      { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', min: 4, max: 130 },
      { key: 'battery', label: 'Battery', unit: '%', min: 30, max: 100 },
    ]},
    { type: 'Gas Detector', protocol: 'lora', fields: [
      { key: 'ppm', label: 'Concentration', unit: 'ppm', min: 0, max: 380 },
      { key: 'battery', label: 'Battery', unit: '%', min: 30, max: 100 },
    ]},
  ];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function seedSampleFleet(userId) {
    if (DB.devices.length) return;
    let n = 1;
    for (const f of FACILITIES) {
      const cnt = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < cnt; i++) {
        const p = pick(PROFILES);
        const id = uid('dev_');
        const serial = (p.protocol === 'lora' ? 'LRD' : 'IOT') + '-' + String(n).padStart(4, '0');
        DB.devices.push({
          id, name: `${p.type} ${String(i+1).padStart(2,'0')} — ${f.name.split(' — ')[0]}`,
          serial, protocol: p.protocol,
          description: `${p.type} sensor at ${f.name}`,
          tags: [p.type, f.name.split(' — ')[0]].join(','),
          lat: f.lat + (Math.random() - 0.5) * 0.02,
          lng: f.lng + (Math.random() - 0.5) * 0.02,
          device_token: uid('tok_'), dev_eui: p.protocol === 'lora' ? Array.from({length:8},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('').toUpperCase() : null,
          last_seen: null, online: 0,
          created_at: now(),
        });
        for (const fld of p.fields) {
          DB.fields.push({ id: uid('fld_'), device_id: id, key: fld.key, label: fld.label, unit: fld.unit, type: 'number', min: fld.min, max: fld.max, decimals: 2 });
        }
        n++;
      }
    }
    // Default dashboard
    const dev = DB.devices.slice(0, 6);
    const layout = [
      { id: uid('w_'), x: 0,  y: 0, w: 12, h: 1, type: 'header', config: { title: 'Operations Overview', subtitle: 'Real-time fleet status' }},
      { id: uid('w_'), x: 0,  y: 1, w: 3,  h: 2, type: 'stat',   config: { label: 'Devices online', source: 'metric:devices_online' }},
      { id: uid('w_'), x: 3,  y: 1, w: 3,  h: 2, type: 'stat',   config: { label: 'Open alerts',    source: 'metric:alerts_open',    color: 'danger' }},
      { id: uid('w_'), x: 6,  y: 1, w: 3,  h: 2, type: 'stat',   config: { label: 'Msgs / min',     source: 'metric:msgs_per_minute' }},
      { id: uid('w_'), x: 9,  y: 1, w: 3,  h: 2, type: 'stat',   config: { label: 'Active rules',   source: 'metric:rules_active' }},
    ];
    let y = 3;
    if (dev[0]) layout.push({ id: uid('w_'), x: 0, y, w: 6, h: 3, type: 'chart', config: { label: dev[0].name, device_id: dev[0].id, field: DB.fields.find(f=>f.device_id===dev[0].id).key, range:'1h' }});
    if (dev[1]) layout.push({ id: uid('w_'), x: 6, y, w: 6, h: 3, type: 'chart', config: { label: dev[1].name, device_id: dev[1].id, field: DB.fields.find(f=>f.device_id===dev[1].id).key, range:'1h' }});
    y += 3;
    if (dev[2]) layout.push({ id: uid('w_'), x: 0, y, w: 3, h: 3, type: 'gauge', config: { label: dev[2].name, device_id: dev[2].id, field: DB.fields.find(f=>f.device_id===dev[2].id).key, min: 0, max: 100 }});
    if (dev[3]) layout.push({ id: uid('w_'), x: 3, y, w: 3, h: 3, type: 'gauge', config: { label: dev[3].name, device_id: dev[3].id, field: DB.fields.find(f=>f.device_id===dev[3].id).key, min: 0, max: 100 }});
    layout.push({ id: uid('w_'), x: 6, y, w: 6, h: 3, type: 'map', config: { title: 'Fleet map' }});
    y += 3;
    layout.push({ id: uid('w_'), x: 0, y, w: 8, h: 4, type: 'alerts', config: { title: 'Recent alerts', limit: 8 }});
    DB.dashboards.push({
      id: uid('dash_'), name: 'Operations Overview', description: 'Default dashboard for the SGTD fleet.',
      layout, is_default: 1, created_at: now(), updated_at: now(),
    });
    // Rules
    DB.rules.push({ id: uid('r_'), name: 'High vibration',   device_id: null, field: 'vib',     operator: 'gt', threshold: 12,  severity: 'critical', message: 'Vibration above safe threshold', enabled: 1, created_at: now() });
    DB.rules.push({ id: uid('r_'), name: 'Gas leak risk',    device_id: null, field: 'ppm',     operator: 'gt', threshold: 180, severity: 'critical', message: 'Gas concentration over 180 ppm', enabled: 1, created_at: now() });
    DB.rules.push({ id: uid('r_'), name: 'Low battery',      device_id: null, field: 'battery', operator: 'lt', threshold: 30,  severity: 'warning',  message: 'Battery low — schedule replacement', enabled: 1, created_at: now() });
    DB.rules.push({ id: uid('r_'), name: 'Tank overflow',    device_id: null, field: 'level',   operator: 'gt', threshold: 95,  severity: 'warning',  message: 'Tank level critical', enabled: 1, created_at: now() });
    save();
  }

  // ------------- Simulator + rules engine -------------
  const wsBus = new EventTarget();
  function broadcast(msg) {
    wsBus.dispatchEvent(new CustomEvent('m', { detail: msg }));
  }
  function evalRules(device, frame, ts) {
    for (const r of DB.rules) {
      if (!r.enabled) continue;
      if (r.device_id && r.device_id !== device.id) continue;
      const v = frame[r.field];
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      let fire = false;
      switch (r.operator) {
        case 'gt':  fire = n >  r.threshold; break;
        case 'gte': fire = n >= r.threshold; break;
        case 'lt':  fire = n <  r.threshold; break;
        case 'lte': fire = n <= r.threshold; break;
        case 'eq':  fire = n === r.threshold; break;
        case 'neq': fire = n !== r.threshold; break;
      }
      if (!fire) continue;
      const dup = DB.alerts.find(a => a.rule_id === r.id && a.device_id === device.id && (ts - a.ts) < 60_000);
      if (dup) continue;
      const a = {
        id: uid('al_'), severity: r.severity, rule_id: r.id, device_id: device.id,
        message: r.message || `${r.name} — ${r.field}=${n.toFixed(2)} ${r.operator} ${r.threshold}`,
        ts, ack_by: null, ack_ts: null,
      };
      DB.alerts.unshift(a);
      if (DB.alerts.length > 200) DB.alerts.pop();
      broadcast({ type: 'alert', alert: a });
    }
  }
  const simState = new Map();
  let simHandle = null;
  function startSimulator() {
    if (simHandle) return;
    simHandle = setInterval(() => {
      if (!DB.devices.length) return;
      const n = Math.min(6, DB.devices.length);
      for (let i = 0; i < n; i++) {
        const d = DB.devices[Math.floor(Math.random() * DB.devices.length)];
        const fields = DB.fields.filter(f => f.device_id === d.id);
        if (!fields.length) continue;
        const frame = {};
        for (const f of fields) {
          const k = d.id + ':' + f.key;
          let v = simState.get(k);
          if (v == null) v = rand(f.min ?? 0, f.max ?? 100);
          const range = (f.max ?? 100) - (f.min ?? 0);
          v += (Math.random() - 0.5) * range * 0.05;
          v = Math.max(f.min ?? 0, Math.min(f.max ?? 100, v));
          simState.set(k, v);
          frame[f.key] = +v.toFixed(2);
        }
        ingest(d, frame, now());
      }
      // Mark offline old ones
      const cutoff = now() - 5 * 60_000;
      for (const d of DB.devices) if (d.last_seen && d.last_seen < cutoff) d.online = 0;
      save();
    }, 1200);
  }
  function ingest(d, frame, ts) {
    d.last_seen = ts; d.online = 1;
    DB.state[d.id] = DB.state[d.id] || {};
    for (const [k, v] of Object.entries(frame)) {
      const num = typeof v === 'number' ? v : Number(v);
      DB.state[d.id][k] = { value_num: Number.isFinite(num) ? num : null, value_str: typeof v === 'string' ? v : null, ts };
      DB.telemetry.push({ device_id: d.id, field: k, value_num: Number.isFinite(num) ? num : null, ts });
    }
    if (DB.telemetry.length > 8000) DB.telemetry = DB.telemetry.slice(-8000);
    broadcast({ type: 'telemetry', device_id: d.id, serial: d.serial, fields: frame, ts });
    evalRules(d, frame, ts);
  }

  // ------------- WebSocket shim -------------
  const RealWS = window.WebSocket;
  window.WebSocket = function(url, ...rest) {
    if (!/\/ws(\?|$)/.test(url)) return new RealWS(url, ...rest);
    const fake = {
      readyState: 1, onmessage: null, onclose: null, onopen: null, onerror: null,
      send() {}, close() { this.readyState = 3; off(); if (this.onclose) this.onclose({}); },
    };
    function handler(e) {
      if (fake.onmessage) fake.onmessage({ data: JSON.stringify(e.detail) });
    }
    function off() { wsBus.removeEventListener('m', handler); }
    wsBus.addEventListener('m', handler);
    setTimeout(() => fake.onopen && fake.onopen({}), 0);
    return fake;
  };
  Object.assign(window.WebSocket, RealWS);

  // ------------- Fetch interceptor -------------
  const RealFetch = window.fetch.bind(window);
  window.fetch = async function(input, opts={}) {
    const u = typeof input === 'string' ? input : input.url;
    let path; try { path = new URL(u, location.href).pathname; } catch { path = u; }
    if (!path.startsWith('/api/v1/')) return RealFetch(input, opts);

    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const auth = (opts.headers && (opts.headers['Authorization'] || opts.headers['authorization'])) || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = token ? getSession(token) : null;

    const respond = (status, payload) => new Response(JSON.stringify(payload), {
      status, headers: { 'content-type': 'application/json' },
    });
    const need = () => !user ? respond(401, { error: 'unauthorized' }) : null;

    // Status
    if (path === '/api/v1/status' && method === 'GET')
      return respond(200, { ok: true, initialized: initialized(), version: 'demo-1.0', server_time: now() });

    // Setup
    if (path === '/api/v1/setup' && method === 'POST') {
      if (initialized()) return respond(400, { error: 'already_initialized' });
      const { workspace, name, email, password } = body;
      if (!workspace || !name || !email || !password) return respond(400, { error: 'missing_fields' });
      if (password.length < 8) return respond(400, { error: 'password_too_short' });
      DB.workspace = { id: uid('ws_'), name: workspace, slug: workspace.toLowerCase().replace(/\s+/g,'-') };
      const u = { id: uid('u_'), email: email.toLowerCase(), name, password, role: 'admin', created_at: now(), last_login: now() };
      DB.users.push(u);
      const tok = uid('jwt_');
      DB.sessions.push({ token: tok, user_id: u.id, expires_at: now() + 30*86400_000 });
      seedSampleFleet(u.id);
      startSimulator();
      save();
      return respond(200, { token: tok, user: { id: u.id, name: u.name, email: u.email, role: u.role, workspace_id: DB.workspace.id }});
    }

    // Login
    if (path === '/api/v1/auth/login' && method === 'POST') {
      const u = DB.users.find(x => x.email === String(body.email||'').toLowerCase());
      if (!u || u.password !== body.password) return respond(401, { error: 'invalid_credentials' });
      const tok = uid('jwt_');
      DB.sessions.push({ token: tok, user_id: u.id, expires_at: now() + 30*86400_000 });
      u.last_login = now(); save();
      startSimulator();
      return respond(200, { token: tok, user: { id: u.id, name: u.name, email: u.email, role: u.role, workspace_id: DB.workspace.id }});
    }
    if (path === '/api/v1/auth/logout' && method === 'POST') {
      DB.sessions = DB.sessions.filter(s => s.token !== token); save();
      return respond(200, { ok: true });
    }
    if (path === '/api/v1/auth/me' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, workspace_id: DB.workspace.id }, workspace: DB.workspace });
    }
    if (path === '/api/v1/auth/profile' && method === 'PATCH') {
      const r = need(); if (r) return r;
      if (body.name) user.name = body.name;
      if (body.password) {
        if (body.password.length < 8) return respond(400, { error: 'password_too_short' });
        user.password = body.password;
      }
      save(); return respond(200, { ok: true });
    }

    // Metrics
    if (path === '/api/v1/metrics/overview' && method === 'GET') {
      const r = need(); if (r) return r;
      startSimulator();
      const totals = {
        devices: DB.devices.length,
        online: DB.devices.filter(d => d.online).length,
        alerts_open: DB.alerts.filter(a => !a.ack_ts).length,
        rules_active: DB.rules.filter(r => r.enabled).length,
        dashboards: DB.dashboards.length,
        users: DB.users.length,
        msgs_per_minute: DB.telemetry.filter(t => t.ts > now() - 60000).length,
      };
      const protocols = ['mqtt','lora','http'].map(p => ({ protocol: p, c: DB.devices.filter(d => d.protocol === p).length })).filter(x => x.c);
      const health = { healthy: totals.online, offline: totals.devices - totals.online };
      const severity = ['critical','warning','info'].map(s => ({ severity: s, c: DB.alerts.filter(a => a.severity === s && a.ts > now() - 86400_000).length })).filter(x => x.c);
      const buckets = [];
      for (let i = 29; i >= 0; i--) {
        const from = now() - (i+1) * 60_000;
        const to = now() - i * 60_000;
        buckets.push({ ts: to, count: DB.telemetry.filter(t => t.ts >= from && t.ts < to).length });
      }
      return respond(200, { totals, protocols, health, severity, throughput: buckets });
    }

    // Devices
    if (path === '/api/v1/devices' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { devices: DB.devices.map(d => ({ ...d })) });
    }
    const mDev = path.match(/^\/api\/v1\/devices\/([^\/]+)$/);
    if (mDev && method === 'GET') {
      const r = need(); if (r) return r;
      const d = DB.devices.find(x => x.id === mDev[1]);
      if (!d) return respond(404, { error: 'not_found' });
      const fields = DB.fields.filter(f => f.device_id === d.id);
      const state = Object.entries(DB.state[d.id] || {}).map(([field, s]) => ({ field, ...s }));
      return respond(200, { device: { ...d }, fields, state });
    }
    if (mDev && method === 'PATCH') {
      const r = need(); if (r) return r;
      const d = DB.devices.find(x => x.id === mDev[1]);
      if (!d) return respond(404, { error: 'not_found' });
      for (const k of ['name','description','tags','lat','lng','dev_eui']) if (k in body) d[k] = body[k];
      save(); return respond(200, { ok: true });
    }
    if (mDev && method === 'DELETE') {
      const r = need(); if (r) return r;
      DB.devices = DB.devices.filter(x => x.id !== mDev[1]);
      DB.fields  = DB.fields.filter(f => f.device_id !== mDev[1]);
      DB.telemetry = DB.telemetry.filter(t => t.device_id !== mDev[1]);
      delete DB.state[mDev[1]];
      save(); return respond(200, { ok: true });
    }
    if (path === '/api/v1/devices' && method === 'POST') {
      const r = need(); if (r) return r;
      const { name, serial, protocol = 'http', tags, lat, lng, dev_eui, description, fields = [] } = body;
      if (!name || !serial) return respond(400, { error: 'missing_fields' });
      if (DB.devices.some(d => d.serial === serial)) return respond(409, { error: 'serial_taken' });
      const id = uid('dev_');
      const tok = uid('tok_');
      DB.devices.push({ id, name, serial, protocol, tags: Array.isArray(tags) ? tags.join(',') : tags || null, lat: lat ?? null, lng: lng ?? null, dev_eui: dev_eui || null, description: description || null, device_token: tok, online: 0, last_seen: null, created_at: now() });
      for (const f of fields) if (f.key) DB.fields.push({ id: uid('fld_'), device_id: id, key: f.key, label: f.label || f.key, unit: f.unit || null, type: f.type || 'number', min: f.min ?? null, max: f.max ?? null, decimals: f.decimals ?? 2 });
      save(); return respond(200, { id, device_token: tok });
    }
    const mHist = path.match(/^\/api\/v1\/devices\/([^\/]+)\/history$/);
    if (mHist && method === 'GET') {
      const r = need(); if (r) return r;
      const q = new URL(u, location.href).searchParams;
      const field = q.get('field');
      const from = Number(q.get('from')) || (now() - 3600_000);
      const to   = Number(q.get('to'))   || now();
      let rows = DB.telemetry.filter(t => t.device_id === mHist[1] && t.ts >= from && t.ts <= to);
      if (field) rows = rows.filter(t => t.field === field);
      rows.sort((a,b) => a.ts - b.ts);
      return respond(200, { rows: rows.map(({ field, value_num, ts }) => ({ field, value_num, ts })) });
    }

    // Dashboards
    if (path === '/api/v1/dashboards' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { dashboards: DB.dashboards.map(({ layout, ...rest }) => rest) });
    }
    const mDash = path.match(/^\/api\/v1\/dashboards\/([^\/]+)$/);
    if (mDash && method === 'GET') {
      const r = need(); if (r) return r;
      const d = DB.dashboards.find(x => x.id === mDash[1]);
      if (!d) return respond(404, { error: 'not_found' });
      return respond(200, { dashboard: { ...d } });
    }
    if (mDash && method === 'PUT') {
      const r = need(); if (r) return r;
      const d = DB.dashboards.find(x => x.id === mDash[1]);
      if (!d) return respond(404, { error: 'not_found' });
      if ('name' in body) d.name = body.name;
      if ('description' in body) d.description = body.description;
      if ('layout' in body) d.layout = body.layout;
      d.updated_at = now(); save();
      return respond(200, { ok: true });
    }
    if (mDash && method === 'DELETE') {
      const r = need(); if (r) return r;
      DB.dashboards = DB.dashboards.filter(x => x.id !== mDash[1]); save();
      return respond(200, { ok: true });
    }
    if (path === '/api/v1/dashboards' && method === 'POST') {
      const r = need(); if (r) return r;
      const id = uid('dash_');
      DB.dashboards.push({ id, name: body.name, description: body.description, layout: body.layout || [], is_default: 0, created_at: now(), updated_at: now() });
      save(); return respond(200, { id });
    }

    // Rules
    if (path === '/api/v1/rules' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { rules: DB.rules.map(x => ({ ...x })) });
    }
    if (path === '/api/v1/rules' && method === 'POST') {
      const r = need(); if (r) return r;
      const id = uid('r_');
      DB.rules.push({ id, name: body.name, device_id: body.device_id || null, field: body.field, operator: body.operator, threshold: Number(body.threshold), severity: body.severity || 'warning', message: body.message || null, enabled: body.enabled === false ? 0 : 1, created_at: now() });
      save(); return respond(200, { id });
    }
    const mRule = path.match(/^\/api\/v1\/rules\/([^\/]+)$/);
    if (mRule && method === 'PATCH') {
      const r = need(); if (r) return r;
      const x = DB.rules.find(z => z.id === mRule[1]);
      if (!x) return respond(404, { error: 'not_found' });
      for (const k of ['name','device_id','field','operator','threshold','severity','message','enabled']) if (k in body) x[k] = typeof body[k] === 'boolean' ? (body[k] ? 1 : 0) : body[k];
      save(); return respond(200, { ok: true });
    }
    if (mRule && method === 'DELETE') {
      const r = need(); if (r) return r;
      DB.rules = DB.rules.filter(x => x.id !== mRule[1]); save();
      return respond(200, { ok: true });
    }

    // Alerts
    if (path === '/api/v1/alerts' && method === 'GET') {
      const r = need(); if (r) return r;
      const q = new URL(u, location.href).searchParams;
      let list = DB.alerts.slice();
      if (q.get('open') === '1') list = list.filter(a => !a.ack_ts);
      if (q.get('severity')) list = list.filter(a => a.severity === q.get('severity'));
      const lim = Math.min(Number(q.get('limit')) || 100, 1000);
      list = list.slice(0, lim).map(a => ({
        ...a,
        device_name: (DB.devices.find(d => d.id === a.device_id) || {}).name || null,
        device_serial: (DB.devices.find(d => d.id === a.device_id) || {}).serial || null,
        rule_name: (DB.rules.find(r => r.id === a.rule_id) || {}).name || null,
        ack_by_name: a.ack_by ? (DB.users.find(u => u.id === a.ack_by) || {}).name : null,
      }));
      return respond(200, { alerts: list });
    }
    const mAck = path.match(/^\/api\/v1\/alerts\/([^\/]+)\/ack$/);
    if (mAck && method === 'POST') {
      const r = need(); if (r) return r;
      const a = DB.alerts.find(x => x.id === mAck[1]);
      if (a && !a.ack_ts) { a.ack_by = user.id; a.ack_ts = now(); save(); }
      return respond(200, { ok: true });
    }

    // Users
    if (path === '/api/v1/users' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { users: DB.users.map(({ password, ...u }) => u) });
    }
    if (path === '/api/v1/users' && method === 'POST') {
      const r = need(); if (r) return r;
      if (user.role !== 'admin') return respond(403, { error: 'forbidden' });
      const { email, name, password, role = 'viewer' } = body;
      if (!email || !name || !password) return respond(400, { error: 'missing_fields' });
      if (password.length < 8) return respond(400, { error: 'password_too_short' });
      if (DB.users.some(u => u.email === email.toLowerCase())) return respond(409, { error: 'email_taken' });
      const id = uid('u_');
      DB.users.push({ id, email: email.toLowerCase(), name, password, role, created_at: now(), last_login: null });
      save(); return respond(200, { id });
    }
    const mUser = path.match(/^\/api\/v1\/users\/([^\/]+)$/);
    if (mUser && method === 'PATCH') {
      const r = need(); if (r) return r;
      if (user.role !== 'admin') return respond(403, { error: 'forbidden' });
      const x = DB.users.find(u => u.id === mUser[1]);
      if (!x) return respond(404, { error: 'not_found' });
      if (body.name) x.name = body.name;
      if (body.role) x.role = body.role;
      if (body.password) {
        if (body.password.length < 8) return respond(400, { error: 'password_too_short' });
        x.password = body.password;
      }
      save(); return respond(200, { ok: true });
    }
    if (mUser && method === 'DELETE') {
      const r = need(); if (r) return r;
      if (user.role !== 'admin') return respond(403, { error: 'forbidden' });
      if (mUser[1] === user.id) return respond(400, { error: 'cannot_delete_self' });
      DB.users = DB.users.filter(u => u.id !== mUser[1]); save();
      return respond(200, { ok: true });
    }

    // Tokens
    if (path === '/api/v1/tokens' && method === 'GET') {
      const r = need(); if (r) return r;
      return respond(200, { tokens: DB.tokens.map(t => ({ id: t.id, name: t.name, scopes: t.scopes, created_at: t.created_at, last_used: t.last_used, preview: t.token.slice(0, 8) + '…' })) });
    }
    if (path === '/api/v1/tokens' && method === 'POST') {
      const r = need(); if (r) return r;
      if (user.role !== 'admin') return respond(403, { error: 'forbidden' });
      const id = uid('tok_');
      const tok = 'sgtd_' + uid('') + uid('');
      DB.tokens.push({ id, name: body.name || 'API token', token: tok, scopes: 'ingest', created_at: now(), last_used: null });
      save(); return respond(200, { id, token: tok });
    }
    const mTok = path.match(/^\/api\/v1\/tokens\/([^\/]+)$/);
    if (mTok && method === 'DELETE') {
      const r = need(); if (r) return r;
      DB.tokens = DB.tokens.filter(t => t.id !== mTok[1]); save();
      return respond(200, { ok: true });
    }

    return respond(404, { error: 'not_found_in_demo' });
  };

  // Persist regularly
  setInterval(save, 8_000);

  // Banner
  window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('demoBanner')) return;
    const b = document.createElement('div');
    b.id = 'demoBanner';
    b.style.cssText = 'position:fixed;bottom:14px;left:14px;background:linear-gradient(135deg,#06b6d4,#0ea5e9);color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:700;letter-spacing:.4px;z-index:60;box-shadow:0 10px 24px rgba(0,0,0,.35);max-width:280px;line-height:1.4;';
    b.innerHTML = 'DEMO MODE · running in your browser · <a href="#" id="resetDemo" style="color:#fff;text-decoration:underline;">reset data</a>';
    document.body.appendChild(b);
    document.getElementById('resetDemo').addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Wipe demo data and start over?')) {
        localStorage.removeItem(KEY);
        localStorage.removeItem('sgtd.token');
        localStorage.removeItem('sgtd.user');
        location.href = '/setup.html';
      }
    });
  });
})();
