// First-run seeder + ongoing telemetry simulator.
// On a fresh database, creates a sample fleet of devices wired to mock sensors
// so the platform never looks empty before real hardware is connected.
// Devices are real DB rows — telemetry flows through the same ingest pipeline
// as production data, so all charts/rules/alerts work identically.

const { db } = require('./db');
const { uid, now } = require('./auth');
const { ingest } = require('./telemetry');
const crypto = require('crypto');

const SAMPLE_FACILITIES = [
  { name: 'Djibouti Port — Terminal A',  lat: 11.6022, lng: 43.1456 },
  { name: 'Doraleh Container Hub',       lat: 11.6650, lng: 43.0700 },
  { name: 'Damerjog Industrial Zone',    lat: 11.5180, lng: 43.2500 },
  { name: 'Ali Sabieh Cement Works',     lat: 11.1545, lng: 42.7120 },
  { name: 'Tadjourah Logistics Park',    lat: 11.7858, lng: 42.8819 },
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

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function seedSampleFleet(workspaceId, userId) {
  const existing = db.prepare('SELECT COUNT(*) c FROM devices WHERE workspace_id = ?')
                     .get(workspaceId).c;
  if (existing > 0) return;

  const insertDevice = db.prepare(`INSERT INTO devices
    (id, workspace_id, name, serial, protocol, description, tags, lat, lng,
     device_token, dev_eui, mqtt_username, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertField = db.prepare(`INSERT INTO device_fields
    (id, device_id, key, label, unit, type, min, max, decimals, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const tx = db.transaction(() => {
    let n = 1;
    for (const f of SAMPLE_FACILITIES) {
      const cnt = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < cnt; i++) {
        const p = pick(PROFILES);
        const id = uid('dev_');
        const serial = (p.protocol === 'lora' ? 'LRD' : 'IOT') + '-' + String(n).padStart(4, '0');
        const token = crypto.randomBytes(16).toString('hex');
        const devEui = p.protocol === 'lora'
          ? crypto.randomBytes(8).toString('hex').toUpperCase() : null;
        insertDevice.run(
          id, workspaceId,
          `${p.type} ${String(i + 1).padStart(2, '0')} — ${f.name.split(' — ')[0]}`,
          serial, p.protocol,
          `${p.type} sensor at ${f.name}`,
          [p.type, f.name.split(' — ')[0]].join(','),
          f.lat + (Math.random() - 0.5) * 0.02,
          f.lng + (Math.random() - 0.5) * 0.02,
          token, devEui,
          p.protocol === 'mqtt' ? serial : null,
          now(), userId,
        );
        for (const fld of p.fields) {
          insertField.run(uid('fld_'), id, fld.key, fld.label, fld.unit,
            'number', fld.min, fld.max, 2, now());
        }
        n++;
      }
    }

    // A default dashboard with a few widgets
    const dashId = uid('dash_');
    db.prepare(`INSERT INTO dashboards (id, workspace_id, name, description,
                                        layout, is_default, created_at, created_by, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(dashId, workspaceId, 'Operations Overview',
           'Default dashboard for the SGTD fleet — drag widgets to customise.',
           JSON.stringify(buildDefaultLayout(workspaceId)),
           now(), userId, now());

    // Sample rules
    const insertRule = db.prepare(`INSERT INTO rules
      (id, workspace_id, name, device_id, field, operator, threshold, duration_s,
       severity, message, notify, enabled, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)`);
    insertRule.run(uid('r_'), workspaceId, 'High vibration', null, 'vib', 'gt', 12, 0,
                   'critical', 'Vibration above safe threshold', now(), userId);
    insertRule.run(uid('r_'), workspaceId, 'Gas leak risk', null, 'ppm', 'gt', 180, 0,
                   'critical', 'Gas concentration over 180 ppm', now(), userId);
    insertRule.run(uid('r_'), workspaceId, 'Low battery', null, 'battery', 'lt', 30, 0,
                   'warning', 'Battery low — schedule replacement', now(), userId);
    insertRule.run(uid('r_'), workspaceId, 'Tank overflow risk', null, 'level', 'gt', 95, 0,
                   'warning', 'Tank level critical', now(), userId);
  });
  tx();
}

function buildDefaultLayout(workspaceId) {
  const dev = db.prepare(`SELECT d.id, d.serial, d.name, d.lat, d.lng,
                                 (SELECT key FROM device_fields WHERE device_id = d.id LIMIT 1) AS field
                          FROM devices d WHERE d.workspace_id = ?
                          ORDER BY d.created_at ASC LIMIT 6`).all(workspaceId);
  const tile = (col, row, w, h, type, config) => ({
    id: uid('w_'), x: col, y: row, w, h, type, config,
  });
  const layout = [
    tile(0, 0, 12, 1, 'header', { title: 'Operations Overview', subtitle: 'Real-time fleet status' }),
    tile(0, 1, 3, 2, 'stat', { label: 'Devices online', source: 'metric:devices_online' }),
    tile(3, 1, 3, 2, 'stat', { label: 'Open alerts',    source: 'metric:alerts_open' }),
    tile(6, 1, 3, 2, 'stat', { label: 'Msgs / min',     source: 'metric:msgs_per_minute' }),
    tile(9, 1, 3, 2, 'stat', { label: 'Active rules',   source: 'metric:rules_active' }),
  ];
  let y = 3;
  for (const d of dev.slice(0, 4)) {
    if (!d.field) continue;
    layout.push(tile((y - 3) % 2 * 6, y, 6, 3, 'chart',
      { device_id: d.id, field: d.field, label: d.name, range: '1h' }));
    if ((y - 3) % 2 === 1) y += 3; else y += 0;
    y = layout[layout.length - 1].y + ((y - 3) % 2 === 1 ? 3 : 0);
  }
  layout.push(tile(0, layout[layout.length-1].y + 3, 8, 4, 'map', {}));
  layout.push(tile(8, layout[layout.length-1].y, 4, 4, 'alerts', { limit: 8 }));
  return layout;
}

// --- Ongoing live simulator ---
const state = new Map(); // device_id+field -> current value
let timer = null;
function startSimulator() {
  if (timer) return;
  timer = setInterval(simTick, 1100);
  console.log('[sim] live simulator started');
}
function simTick() {
  // Pick up to 6 random devices and emit telemetry
  const devices = db.prepare(`SELECT d.* FROM devices d`).all();
  if (devices.length === 0) return;
  const n = Math.min(6, devices.length);
  for (let i = 0; i < n; i++) {
    const d = devices[Math.floor(Math.random() * devices.length)];
    const fields = db.prepare('SELECT * FROM device_fields WHERE device_id = ?').all(d.id);
    if (fields.length === 0) continue;
    const frame = {};
    for (const f of fields) {
      const key = d.id + ':' + f.key;
      let cur = state.get(key);
      if (cur == null) cur = rand(f.min ?? 0, f.max ?? 100);
      const range = (f.max ?? 100) - (f.min ?? 0);
      cur += (Math.random() - 0.5) * range * 0.05;
      cur = Math.max(f.min ?? 0, Math.min(f.max ?? 100, cur));
      state.set(key, cur);
      frame[f.key] = +cur.toFixed(2);
    }
    ingest(d, frame);
  }
}

module.exports = { seedSampleFleet, startSimulator };
