// Builds the shared sidebar + topbar across every page.

const NAV = [
  { section: 'Monitor' },
  { id: 'dashboard', href: 'index.html', label: 'Overview', icon: 'dashboard' },
  { id: 'devices', href: 'devices.html', label: 'Devices', icon: 'devices' },
  { id: 'map', href: 'map.html', label: 'Network Map', icon: 'map' },

  { section: 'Networks' },
  { id: 'mqtt', href: 'mqtt.html', label: 'MQTT Broker', icon: 'mqtt' },
  { id: 'lora', href: 'lora.html', label: 'LoRa / LoRaWAN', icon: 'lora' },

  { section: 'Insights' },
  { id: 'analytics', href: 'analytics.html', label: 'Analytics', icon: 'analytics' },
  { id: 'alerts', href: 'alerts.html', label: 'Alerts', icon: 'alerts' },

  { section: 'System' },
  { id: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings' },
];

function renderLayout({ pageId, title, crumb }) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="brand">
      <img src="assets/img/sgtd-logo.svg" alt="SGTD"/>
    </div>
    <nav class="nav">
      ${NAV.map(item => item.section
        ? `<div class="nav-section">${item.section}</div>`
        : `<a href="${item.href}" class="${item.id === pageId ? 'active' : ''}">
              ${ICONS[item.icon] || ''}<span>${item.label}</span>
           </a>`
      ).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="avatar">M</div>
      <div>
        <div style="color:var(--text);font-weight:600;font-size:13px;">Mohamed Djama</div>
        <div>Platform Operator</div>
      </div>
    </div>
  `;

  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <div class="title">
      <div class="crumb">${crumb || 'SGTD IIoT Hub'}</div>
      <h1>${title}</h1>
    </div>
    <div class="topbar-actions">
      <div class="search">
        ${ICONS.search}
        <input placeholder="Search devices, topics, gateways…"/>
      </div>
      <button class="icon-btn" title="Refresh">${ICONS.refresh}</button>
      <button class="icon-btn" title="Notifications">
        ${ICONS.bell}<span class="dot"></span>
      </button>
      <div class="live"><span class="dot"></span>LIVE</div>
    </div>
  `;

  const app = document.createElement('div');
  app.className = 'app';
  const main = document.createElement('main');
  main.className = 'main';
  main.appendChild(topbar);

  const content = document.createElement('div');
  content.className = 'content';
  content.id = 'content';
  main.appendChild(content);

  app.appendChild(sidebar);
  app.appendChild(main);
  document.body.appendChild(app);
  return content;
}
