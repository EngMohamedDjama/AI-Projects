// Widget renderers and their config schemas. Each widget knows how to:
//   - render(el, config, ctx) → returns a destroy() function
//   - schema() → array of { key, label, type, options? } describing its config
//
// ctx provides: { devices: [...], state: { device_id: { field: { value_num, ts } } } }

const Widgets = {};

function escape(s) { return window.escapeHTML(s); }

// ---------------- stat ----------------
Widgets.stat = {
  label: 'Stat',
  schema: (ctx) => [
    { key: 'label', label: 'Label', type: 'text', default: 'Stat' },
    { key: 'source', label: 'Value source', type: 'select', options: ctx.statSources },
    { key: 'unit', label: 'Unit', type: 'text', default: '' },
    { key: 'color', label: 'Accent', type: 'select', options: [
      { value: '', label: 'Default' },
      { value: 'ok', label: 'Green' },
      { value: 'warn', label: 'Orange' },
      { value: 'danger', label: 'Red' },
      { value: 'info', label: 'Blue' },
    ], default: '' },
  ],
  render(el, cfg, ctx) {
    const color = ({ ok:'var(--ok)', warn:'var(--warn)', danger:'var(--danger)', info:'var(--info)' })[cfg.color] || 'var(--accent-300)';
    el.innerHTML = `
      <div class="kpi" style="height:100%;box-shadow:none;">
        <div class="label">${escape(cfg.label || 'Stat')}</div>
        <div class="value" data-val style="color:${color};">—</div>
        <div class="trend up" data-trend>${escape(cfg.unit || '')}</div>
      </div>`;
    const valEl = el.querySelector('[data-val]');
    function update() {
      const v = readSource(cfg.source, ctx);
      if (v == null) { valEl.textContent = '—'; return; }
      valEl.textContent = typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
    }
    update();
    const off = ctx.onTelemetry(() => update());
    const t = setInterval(update, 5000);
    return () => { off(); clearInterval(t); };
  },
};

function readSource(src, ctx) {
  if (!src) return null;
  if (src.startsWith('metric:')) {
    const k = src.slice(7);
    return ctx.metrics?.[k];
  }
  if (src.startsWith('device:')) {
    const [, devField] = src.split('device:');
    const [devId, field] = devField.split(':');
    const v = ctx.state?.[devId]?.[field];
    return v?.value_num;
  }
  return null;
}

// ---------------- chart ----------------
Widgets.chart = {
  label: 'Line chart',
  schema: (ctx) => [
    { key: 'label', label: 'Title', type: 'text', default: 'Chart' },
    { key: 'device_id', label: 'Device', type: 'select', options: ctx.deviceOptions },
    { key: 'field', label: 'Field', type: 'text', default: '', help: 'field key (temp, humidity…)' },
    { key: 'range', label: 'Range', type: 'select', options: [
      { value: '15m', label: '15 minutes' },
      { value: '1h',  label: '1 hour' },
      { value: '6h',  label: '6 hours' },
      { value: '24h', label: '24 hours' },
      { value: '7d',  label: '7 days' },
    ], default: '1h' },
  ],
  render(el, cfg, ctx) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;">
        <h3 style="margin:0 0 8px;">${escape(cfg.label || 'Chart')}
          <span class="meta">${escape(cfg.field || '')}</span></h3>
        <div style="flex:1;position:relative;"><canvas></canvas></div>
      </div>`;
    let chart;
    async function reload() {
      if (!cfg.device_id || !cfg.field) return;
      const ms = ({ '15m':900_000, '1h':3600_000, '6h':6*3600_000, '24h':86400_000, '7d':7*86400_000 })[cfg.range || '1h'];
      try {
        const r = await API.get(`/api/v1/devices/${cfg.device_id}/history?field=${encodeURIComponent(cfg.field)}&from=${Date.now() - ms}`);
        const labels = r.rows.map(x => new Date(x.ts).toTimeString().slice(0,5));
        const data = r.rows.map(x => x.value_num);
        if (chart) chart.destroy();
        chart = timeSeries(el.querySelector('canvas'), labels, [{ label: cfg.field, data }]);
      } catch {}
    }
    reload();
    const off = ctx.onTelemetry((msg) => {
      if (msg.device_id !== cfg.device_id || msg.fields[cfg.field] == null || !chart) return;
      chart.data.labels.push(new Date(msg.ts).toTimeString().slice(0,5));
      chart.data.datasets[0].data.push(msg.fields[cfg.field]);
      if (chart.data.labels.length > 200) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
      chart.update('none');
    });
    return () => { off(); if (chart) chart.destroy(); };
  },
};

// ---------------- gauge ----------------
Widgets.gauge = {
  label: 'Gauge',
  schema: (ctx) => [
    { key: 'label', label: 'Title', type: 'text', default: 'Gauge' },
    { key: 'device_id', label: 'Device', type: 'select', options: ctx.deviceOptions },
    { key: 'field', label: 'Field', type: 'text' },
    { key: 'min', label: 'Min', type: 'number', default: 0 },
    { key: 'max', label: 'Max', type: 'number', default: 100 },
    { key: 'unit', label: 'Unit', type: 'text', default: '' },
  ],
  render(el, cfg, ctx) {
    const min = Number(cfg.min ?? 0), max = Number(cfg.max ?? 100);
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;">
        <h3 style="margin:0 0 6px;font-size:13px;">${escape(cfg.label || 'Gauge')}</h3>
        <svg viewBox="0 0 200 110" width="180" height="100">
          <defs>
            <linearGradient id="gg" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="#10b981"/>
              <stop offset="60%" stop-color="#22d3ee"/>
              <stop offset="85%" stop-color="#f59e0b"/>
              <stop offset="100%" stop-color="#ef4444"/>
            </linearGradient>
          </defs>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(125,211,252,.12)" stroke-width="14" stroke-linecap="round"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" data-arc stroke-dasharray="0 999"/>
          <line x1="100" y1="100" x2="100" y2="40" stroke="#e6f2ff" stroke-width="2" stroke-linecap="round" data-needle transform-origin="100 100" transform="rotate(-90)"/>
          <circle cx="100" cy="100" r="5" fill="#22d3ee"/>
        </svg>
        <div style="font-family:var(--mono);font-size:22px;font-weight:700;margin-top:6px;" data-val>—</div>
        <div style="font-size:11px;color:var(--text-mute);" data-unit>${escape(cfg.unit || '')}</div>
      </div>`;
    const arc = el.querySelector('[data-arc]');
    const needle = el.querySelector('[data-needle]');
    const val = el.querySelector('[data-val]');
    function set(v) {
      if (v == null) { val.textContent = '—'; return; }
      const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
      arc.setAttribute('stroke-dasharray', `${pct * 251.3} 999`);
      const angle = -90 + pct * 180;
      needle.setAttribute('transform', `rotate(${angle})`);
      val.textContent = (typeof v === 'number' ? v : Number(v)).toFixed(1);
    }
    set(ctx.state?.[cfg.device_id]?.[cfg.field]?.value_num);
    const off = ctx.onTelemetry((msg) => {
      if (msg.device_id === cfg.device_id && msg.fields[cfg.field] != null)
        set(msg.fields[cfg.field]);
    });
    return () => off();
  },
};

// ---------------- map ----------------
Widgets.map = {
  label: 'Map',
  schema: () => [
    { key: 'title', label: 'Title', type: 'text', default: 'Network Map' },
  ],
  render(el, cfg, ctx) {
    const W = el.clientWidth || 400, H = el.clientHeight || 300;
    const lats = ctx.devices.filter(d => d.lat).map(d => d.lat);
    const lngs = ctx.devices.filter(d => d.lng).map(d => d.lng);
    if (!lats.length) {
      el.innerHTML = '<div style="padding:14px;color:var(--text-mute);">No geolocated devices</div>';
      return () => {};
    }
    const minLat = Math.min(...lats) - 0.05, maxLat = Math.max(...lats) + 0.05;
    const minLng = Math.min(...lngs) - 0.05, maxLng = Math.max(...lngs) + 0.05;
    const proj = (lat, lng) => ({
      x: ((lng - minLng) / (maxLng - minLng)) * (W - 40) + 20,
      y: (1 - (lat - minLat) / (maxLat - minLat)) * (H - 60) + 30,
    });
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;">
        <h3 style="margin:0 0 8px;">${escape(cfg.title || 'Map')}
          <span class="meta">${ctx.devices.length} devices</span></h3>
        <div style="flex:1;background:radial-gradient(600px 300px at 70% 30%,rgba(34,211,238,.10),transparent 60%),linear-gradient(180deg,#061227 0%,#04101f 100%);border-radius:10px;position:relative;overflow:hidden;">
          <svg width="100%" height="100%" viewBox="0 0 ${W} ${H}"></svg>
        </div>
      </div>`;
    const svg = el.querySelector('svg');
    const ns = 'http://www.w3.org/2000/svg';
    for (const d of ctx.devices) {
      if (d.lat == null) continue;
      const p = proj(d.lat, d.lng);
      const c = document.createElementNS(ns, 'circle');
      const color = d.online ? '#22d3ee' : '#6b8aab';
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 4);
      c.setAttribute('fill', color); c.setAttribute('data-id', d.id);
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${d.name} (${d.serial})`;
      c.appendChild(title);
      svg.appendChild(c);
    }
    const off = ctx.onTelemetry((msg) => {
      const c = svg.querySelector(`[data-id="${msg.device_id}"]`);
      if (!c) return;
      c.setAttribute('r', 7); c.setAttribute('fill', '#67e8f9');
      setTimeout(() => { c.setAttribute('r', 4); c.setAttribute('fill', '#22d3ee'); }, 500);
    });
    return () => off();
  },
};

// ---------------- alerts list ----------------
Widgets.alerts = {
  label: 'Alerts feed',
  schema: () => [
    { key: 'title', label: 'Title', type: 'text', default: 'Recent alerts' },
    { key: 'limit', label: 'Items', type: 'number', default: 6 },
  ],
  render(el, cfg, ctx) {
    el.innerHTML = `<h3 style="margin:0 0 8px;">${escape(cfg.title || 'Alerts')}</h3><div data-list style="display:flex;flex-direction:column;gap:8px;overflow:auto;max-height:calc(100% - 36px);"></div>`;
    const list = el.querySelector('[data-list]');
    async function reload() {
      try {
        const r = await API.get('/api/v1/alerts?limit=' + (cfg.limit || 6));
        list.innerHTML = '';
        if (!r.alerts.length) { list.innerHTML = '<div style="color:var(--text-mute);font-size:13px;">No alerts.</div>'; return; }
        for (const a of r.alerts) {
          const sev = a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info';
          const n = document.createElement('div');
          n.className = 'feed-item';
          n.innerHTML = `
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="chip ${sev}"><span class="d"></span>${a.severity.toUpperCase()}</span>
                <span class="src">${escape(a.device_serial || '—')}</span>
              </div>
              <div class="msg" style="margin-top:3px;">${escape(a.message)}</div>
              <div class="ts" style="margin-top:3px;">${fmtRelative(a.ts)}</div>
            </div>`;
          list.appendChild(n);
        }
      } catch {}
    }
    reload();
    const t = setInterval(reload, 12000);
    const off = ctx.onTelemetry((msg) => { if (msg.type === 'alert') reload(); });
    return () => { clearInterval(t); off(); };
  },
};

// ---------------- header ----------------
Widgets.header = {
  label: 'Header',
  schema: () => [
    { key: 'title',    label: 'Title',    type: 'text', default: 'Section' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', default: '' },
  ],
  render(el, cfg) {
    el.innerHTML = `
      <div style="padding:6px 4px;">
        <h2 style="margin:0;font-size:20px;">${escape(cfg.title || 'Section')}</h2>
        ${cfg.subtitle ? `<div style="color:var(--text-mute);font-size:13px;margin-top:3px;">${escape(cfg.subtitle)}</div>` : ''}
      </div>`;
    return () => {};
  },
};

// ---------------- boolean / status ----------------
Widgets.boolean = {
  label: 'Boolean indicator',
  schema: (ctx) => [
    { key: 'label', label: 'Label', type: 'text', default: 'Status' },
    { key: 'device_id', label: 'Device', type: 'select', options: ctx.deviceOptions },
    { key: 'field', label: 'Field', type: 'text' },
    { key: 'on_label',  label: 'When true',  type: 'text', default: 'ON' },
    { key: 'off_label', label: 'When false', type: 'text', default: 'OFF' },
  ],
  render(el, cfg, ctx) {
    el.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-mute);font-weight:600;">${escape(cfg.label || 'Status')}</div>
        <div data-state style="margin-top:14px;padding:14px 26px;border-radius:12px;font-weight:800;font-size:22px;letter-spacing:1px;background:var(--surface-2);color:var(--text-mute);border:1px solid var(--border);">—</div>
      </div>`;
    const box = el.querySelector('[data-state]');
    function set(v) {
      if (v == null) { box.textContent = '—'; return; }
      const on = !!v && v !== 'false' && v !== '0';
      box.textContent = on ? (cfg.on_label || 'ON') : (cfg.off_label || 'OFF');
      box.style.background = on ? 'var(--ok-soft)' : 'var(--danger-soft)';
      box.style.color = on ? 'var(--ok)' : 'var(--danger)';
      box.style.borderColor = on ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)';
    }
    set(ctx.state?.[cfg.device_id]?.[cfg.field]?.value_num);
    const off = ctx.onTelemetry((msg) => {
      if (msg.device_id === cfg.device_id && msg.fields[cfg.field] != null)
        set(msg.fields[cfg.field]);
    });
    return () => off();
  },
};

window.Widgets = Widgets;
window.readSource = readSource;
