// Authenticated-page shell: sidebar, topbar, user dropdown, live socket.
// Use:
//   const ctx = await Shell.mount({ pageId: 'devices', title: 'Devices' });
//   ctx.content // <div> to render into

const NAV = [
  { section: 'Monitor' },
  { id: 'overview',   href: '/',                label: 'Overview',   icon: 'dashboard' },
  { id: 'dashboards', href: '/dashboards.html', label: 'Dashboards', icon: 'analytics' },
  { id: 'devices',    href: '/devices.html',    label: 'Devices',    icon: 'devices' },
  { id: 'map',        href: '/map.html',        label: 'Map',        icon: 'map' },

  { section: 'Automate' },
  { id: 'rules',      href: '/rules.html',      label: 'Rules',      icon: 'pulse' },
  { id: 'alerts',     href: '/alerts.html',     label: 'Alerts',     icon: 'alerts' },

  { section: 'Admin', adminOnly: true },
  { id: 'users',      href: '/users.html',      label: 'Users',      icon: 'cpu',  adminOnly: true },
  { id: 'tokens',     href: '/tokens.html',     label: 'API tokens', icon: 'bolt', adminOnly: true },
  { id: 'settings',   href: '/settings.html',   label: 'Settings',   icon: 'settings' },
];

const Shell = {
  async mount({ pageId, title, crumb, requireRole }) {
    const me = await API.guardAuth();
    if (!me) return null;
    if (requireRole && me.user.role !== requireRole && me.user.role !== 'admin') {
      location.href = '/'; return null;
    }
    Shell._render({ pageId, title, crumb, me });
    Shell._startSocket();
    return {
      content: document.getElementById('content'),
      user: me.user, workspace: me.workspace,
    };
  },

  _render({ pageId, title, crumb, me }) {
    const isAdmin = me.user.role === 'admin';
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.innerHTML = `
      <div class="brand">
        <img src="/assets/img/sgtd-logo.svg" alt="SGTD"/>
      </div>
      <div style="font-size:11px;color:var(--text-mute);padding:6px 10px;letter-spacing:1.5px;text-transform:uppercase;">
        ${escapeHTML(me.workspace.name)}
      </div>
      <nav class="nav">
        ${NAV.filter(n => !n.adminOnly || isAdmin).map(item => item.section
          ? `<div class="nav-section">${item.section}</div>`
          : `<a href="${item.href}" class="${item.id === pageId ? 'active' : ''}">
                ${ICONS[item.icon] || ''}<span>${item.label}</span></a>`
        ).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="avatar">${(me.user.name[0] || '?').toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text);font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(me.user.name)}</div>
          <div style="text-transform:uppercase;letter-spacing:1.5px;font-size:10px;">${me.user.role}</div>
        </div>
        <a class="icon-btn" id="logoutBtn" title="Sign out" style="text-decoration:none;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </a>
      </div>
    `;

    const topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <div class="title">
        <div class="crumb">${escapeHTML(crumb || ('SGTD · ' + me.workspace.name))}</div>
        <h1>${escapeHTML(title)}</h1>
      </div>
      <div class="topbar-actions">
        <div class="search">
          ${ICONS.search}
          <input id="globalSearch" placeholder="Search devices, dashboards, rules…"/>
        </div>
        <a class="icon-btn" href="/alerts.html?open=1" title="Alerts">
          ${ICONS.bell}<span class="dot" id="alertDot" style="display:none;"></span>
        </a>
        <div class="live" id="liveBadge"><span class="dot"></span>LIVE</div>
      </div>
    `;

    const app = document.createElement('div'); app.className = 'app';
    const main = document.createElement('main'); main.className = 'main';
    main.appendChild(topbar);
    const content = document.createElement('div');
    content.className = 'content'; content.id = 'content';
    main.appendChild(content);
    app.appendChild(sidebar); app.appendChild(main);
    document.body.appendChild(app);

    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      try { await API.post('/api/v1/auth/logout'); } catch {}
      API.clearSession(); location.href = '/login.html';
    });

    Shell._refreshAlertCount();
    setInterval(Shell._refreshAlertCount, 20_000);
  },

  async _refreshAlertCount() {
    try {
      const r = await API.get('/api/v1/alerts?open=1&limit=1');
      const dot = document.getElementById('alertDot');
      if (dot) dot.style.display = (r.alerts && r.alerts.length) ? 'block' : 'none';
    } catch {}
  },

  _subscribers: new Set(),
  on(handler) { Shell._subscribers.add(handler); return () => Shell._subscribers.delete(handler); },
  _startSocket() {
    if (Shell._ws) return;
    Shell._ws = API.ws((msg) => {
      Shell._subscribers.forEach(h => { try { h(msg); } catch {} });
    });
  },
};

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtRelative(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
window.escapeHTML = escapeHTML;
window.fmtRelative = fmtRelative;
window.Shell = Shell;
