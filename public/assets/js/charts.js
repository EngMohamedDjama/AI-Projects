// Chart.js helpers — consistent theme across all dashboards.

Chart.defaults.color = '#9fb6d4';
Chart.defaults.font.family = "'Inter','Segoe UI',sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.position = 'bottom';

function gridStyle() {
  return { color: 'rgba(125,211,252,.08)', drawBorder: false };
}
function tickStyle() { return { color: '#6b8aab' }; }

function makeGradient(ctx, color1, color2) {
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  g.addColorStop(0, color1);
  g.addColorStop(1, color2);
  return g;
}

function timeSeries(canvas, labels, datasets) {
  const ctx = canvas.getContext('2d');
  const ds = datasets.map((d, i) => {
    const colors = [
      ['rgba(34,211,238,.55)', 'rgba(34,211,238,0)'],
      ['rgba(16,185,129,.5)', 'rgba(16,185,129,0)'],
      ['rgba(245,158,11,.5)', 'rgba(245,158,11,0)'],
      ['rgba(239,68,68,.5)', 'rgba(239,68,68,0)'],
    ];
    const line = ['#22d3ee', '#10b981', '#f59e0b', '#ef4444'][i % 4];
    return {
      ...d,
      borderColor: line,
      backgroundColor: makeGradient(ctx, ...colors[i % colors.length]),
      borderWidth: 2,
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: line,
    };
  });
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: ds.length > 1 } },
      scales: {
        x: { grid: gridStyle(), ticks: tickStyle() },
        y: { grid: gridStyle(), ticks: tickStyle(), beginAtZero: false },
      },
    },
  });
}

function barChart(canvas, labels, data, label='Throughput', horizontal=false) {
  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label, data,
        backgroundColor: makeGradient(ctx, 'rgba(34,211,238,.85)', 'rgba(14,165,233,.25)'),
        borderRadius: 6, borderSkipped: false, maxBarThickness: 28,
      }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: gridStyle(), ticks: tickStyle() },
        y: { grid: gridStyle(), ticks: tickStyle() },
      },
    },
  });
}

function doughnut(canvas, labels, data, colors) {
  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors || ['#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#a78bfa'],
        borderWidth: 0,
        spacing: 2,
      }],
    },
    options: {
      cutout: '68%',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right' } },
    },
  });
}

function radar(canvas, labels, datasets) {
  const ctx = canvas.getContext('2d');
  const colors = [
    { b: '#22d3ee', bg: 'rgba(34,211,238,.18)' },
    { b: '#a78bfa', bg: 'rgba(167,139,250,.18)' },
  ];
  return new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        ...d,
        borderColor: colors[i].b,
        backgroundColor: colors[i].bg,
        pointBackgroundColor: colors[i].b,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        r: {
          grid: { color: 'rgba(125,211,252,.12)' },
          angleLines: { color: 'rgba(125,211,252,.12)' },
          pointLabels: { color: '#9fb6d4' },
          ticks: { backdropColor: 'transparent', color: '#6b8aab' },
        },
      },
    },
  });
}

function sparkline(canvas, data, color='#22d3ee') {
  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data, borderColor: color, borderWidth: 1.6,
        fill: true, backgroundColor: makeGradient(ctx, color + '66', color + '00'),
        pointRadius: 0, tension: 0.35,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// Synthetic series helpers
function genSeries(n, base, amp, jitter=0.1) {
  const out = []; let v = base;
  for (let i = 0; i < n; i++) {
    v += (Math.sin(i / 2.5) * amp * 0.04) + (Math.random() - 0.5) * amp * jitter;
    out.push(+v.toFixed(2));
  }
  return out;
}

function lastNHourLabels(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60*60*1000);
    out.push(d.getHours().toString().padStart(2,'0') + ':00');
  }
  return out;
}

function lastNMinuteLabels(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60*1000);
    out.push(d.getMinutes().toString().padStart(2,'0'));
  }
  return out;
}
