// Mock data generator for SGTD IIoT Hub. Designed to feel like a real fleet.
// Replace MockBus with a real MQTT-over-WebSocket client (mqtt.js) when wiring
// the platform to your broker.

const FACILITIES = [
  { id: 'PLT-01', name: 'Djibouti Port — Terminal A', lat: 11.6022, lng: 43.1456 },
  { id: 'PLT-02', name: 'Doraleh Container Hub',       lat: 11.6650, lng: 43.0700 },
  { id: 'PLT-03', name: 'Damerjog Industrial Zone',     lat: 11.5180, lng: 43.2500 },
  { id: 'PLT-04', name: 'Ali Sabieh Cement Works',      lat: 11.1545, lng: 42.7120 },
  { id: 'PLT-05', name: 'Tadjourah Logistics Park',     lat: 11.7858, lng: 42.8819 },
];

const DEVICE_TYPES = [
  { type: 'Temperature', unit: '°C',   protocol: 'MQTT', min: 18, max: 92 },
  { type: 'Vibration',   unit: 'mm/s', protocol: 'MQTT', min: 0.2, max: 14 },
  { type: 'Energy Meter',unit: 'kWh',  protocol: 'MQTT', min: 240, max: 4900 },
  { type: 'Flow',        unit: 'm³/h', protocol: 'MQTT', min: 5, max: 320 },
  { type: 'Soil Moisture', unit: '%',  protocol: 'LoRa', min: 12, max: 78 },
  { type: 'Tank Level',  unit: '%',    protocol: 'LoRa', min: 5, max: 99 },
  { type: 'Air Quality', unit: 'AQI',  protocol: 'LoRa', min: 22, max: 220 },
  { type: 'Gas Detector',unit: 'ppm',  protocol: 'LoRa', min: 0, max: 380 },
];

const GATEWAYS = [
  { id: 'GW-AX-01', name: 'Gateway · Terminal A',      type: 'MQTT', facility: 'PLT-01', status: 'ok',   uptime: '47d 12h', firmware: '2.4.1' },
  { id: 'GW-AX-02', name: 'Gateway · Doraleh Hub',     type: 'MQTT', facility: 'PLT-02', status: 'ok',   uptime: '31d 02h', firmware: '2.4.1' },
  { id: 'LRG-01',   name: 'LoRa Gateway · Damerjog',   type: 'LoRa', facility: 'PLT-03', status: 'ok',   uptime: '88d 05h', firmware: '1.9.3' },
  { id: 'LRG-02',   name: 'LoRa Gateway · Ali Sabieh', type: 'LoRa', facility: 'PLT-04', status: 'warn', uptime: '12d 18h', firmware: '1.9.2' },
  { id: 'LRG-03',   name: 'LoRa Gateway · Tadjourah',  type: 'LoRa', facility: 'PLT-05', status: 'ok',   uptime: '60d 09h', firmware: '1.9.3' },
];

function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const DEVICES = (() => {
  const out = [];
  let n = 1;
  for (const f of FACILITIES) {
    const count = 18 + Math.floor(Math.random() * 12);
    for (let i = 0; i < count; i++) {
      const t = pick(DEVICE_TYPES);
      const lat = f.lat + (Math.random() - 0.5) * 0.02;
      const lng = f.lng + (Math.random() - 0.5) * 0.02;
      out.push({
        id: `${t.protocol === 'LoRa' ? 'LRD' : 'IOT'}-${String(n).padStart(4, '0')}`,
        name: `${t.type} ${String(i+1).padStart(2,'0')}`,
        type: t.type,
        unit: t.unit,
        protocol: t.protocol,
        facility: f.id,
        facilityName: f.name,
        lat, lng,
        value: rand(t.min, t.max),
        min: t.min, max: t.max,
        battery: t.protocol === 'LoRa' ? Math.floor(rand(35, 100)) : null,
        rssi: t.protocol === 'LoRa' ? Math.floor(rand(-118, -68)) : null,
        snr:  t.protocol === 'LoRa' ? +rand(-5, 10).toFixed(1) : null,
        qos:  t.protocol === 'MQTT' ? pick([0, 1, 2]) : null,
        topic: t.protocol === 'MQTT'
          ? `sgtd/${f.id.toLowerCase()}/${t.type.toLowerCase().replace(/\s+/g,'_')}/${String(i+1).padStart(2,'0')}`
          : null,
        devEui: t.protocol === 'LoRa'
          ? Array.from({length: 8}, () => Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('').toUpperCase()
          : null,
        status: Math.random() < 0.04 ? 'danger' : (Math.random() < 0.1 ? 'warn' : 'ok'),
        lastSeen: Date.now() - Math.floor(Math.random() * 60_000),
        firmware: `${pick(['1.4','1.5','2.0','2.1'])}.${Math.floor(Math.random()*9)}`,
      });
      n++;
    }
  }
  return out;
})();

const ALERTS = [
  { id: 'A-1042', severity: 'critical', source: 'IOT-0017', message: 'Vibration over 12 mm/s threshold (Pump P-3)',          facility: 'PLT-01', ts: Date.now() - 2*60_000, ack: false },
  { id: 'A-1041', severity: 'warning',  source: 'LRD-0089', message: 'Gas detector reading sustained > 180 ppm',              facility: 'PLT-04', ts: Date.now() - 7*60_000, ack: false },
  { id: 'A-1040', severity: 'warning',  source: 'GW-AX-02', message: 'MQTT broker queue depth elevated (TLS clients)',        facility: 'PLT-02', ts: Date.now() - 24*60_000, ack: true },
  { id: 'A-1039', severity: 'info',     source: 'LRG-02',   message: 'Firmware update available (1.9.3) for LoRa gateway',    facility: 'PLT-04', ts: Date.now() - 60*60_000, ack: true },
  { id: 'A-1038', severity: 'critical', source: 'IOT-0103', message: 'Energy meter offline > 5 min (probable power loss)',    facility: 'PLT-05', ts: Date.now() - 90*60_000, ack: false },
  { id: 'A-1037', severity: 'warning',  source: 'LRD-0072', message: 'Battery level below 30% — schedule replacement',        facility: 'PLT-03', ts: Date.now() - 3*60*60_000, ack: true },
  { id: 'A-1036', severity: 'info',     source: 'PLT-01',   message: 'Scheduled maintenance window starts in 2 hours',        facility: 'PLT-01', ts: Date.now() - 4*60*60_000, ack: true },
];

// ---------- Live data bus ----------
class MockBus extends EventTarget {
  constructor(rateMs = 1100) {
    super();
    this.rateMs = rateMs;
    this.timer = null;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.rateMs);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  tick() {
    // Emit 1-3 telemetry events per tick
    const n = 1 + Math.floor(Math.random()*3);
    for (let i = 0; i < n; i++) {
      const d = pick(DEVICES);
      // Simulate gentle walk
      const range = d.max - d.min;
      const drift = (Math.random() - 0.5) * range * 0.05;
      d.value = Math.max(d.min, Math.min(d.max, d.value + drift));
      d.lastSeen = Date.now();
      if (d.protocol === 'LoRa') {
        d.rssi = Math.max(-120, Math.min(-60, d.rssi + (Math.random()-0.5)*4));
        d.snr  = +(Math.max(-7, Math.min(12, d.snr + (Math.random()-0.5)*1))).toFixed(1);
      }
      this.dispatchEvent(new CustomEvent('telemetry', { detail: { ...d } }));
    }
    // Occasional alert
    if (Math.random() < 0.06) {
      const sev = Math.random() < 0.15 ? 'critical' : (Math.random() < 0.5 ? 'warning' : 'info');
      const d = pick(DEVICES);
      const messages = {
        critical: [`${d.type} reading out of safe band`, `Threshold breach on ${d.name}`, `${d.id} offline > 5 min`],
        warning:  [`${d.type} drift detected`, `Latency increased on ${d.id}`, `Battery low on ${d.id}`],
        info:     [`${d.id} firmware sync available`, `Telemetry resumed for ${d.id}`, `Calibration scheduled for ${d.name}`],
      };
      const a = {
        id: 'A-' + Math.floor(1000 + Math.random()*9000),
        severity: sev,
        source: d.id,
        message: pick(messages[sev]),
        facility: d.facility,
        ts: Date.now(),
        ack: false,
      };
      ALERTS.unshift(a);
      if (ALERTS.length > 50) ALERTS.pop();
      this.dispatchEvent(new CustomEvent('alert', { detail: a }));
    }
  }
}

const BUS = new MockBus(900);

// ---------- Aggregates ----------
function summary() {
  const total = DEVICES.length;
  const online = DEVICES.filter(d => Date.now() - d.lastSeen < 5*60_000).length;
  const mqtt = DEVICES.filter(d => d.protocol === 'MQTT').length;
  const lora = DEVICES.filter(d => d.protocol === 'LoRa').length;
  const critical = ALERTS.filter(a => !a.ack && a.severity === 'critical').length;
  const warnings = ALERTS.filter(a => !a.ack && a.severity === 'warning').length;
  return { total, online, mqtt, lora, critical, warnings, facilities: FACILITIES.length, gateways: GATEWAYS.length };
}

function fmtTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
