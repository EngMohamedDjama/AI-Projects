// Thin REST + WS client used by every page.

const TOKEN_KEY = 'sgtd.token';
const USER_KEY  = 'sgtd.user';

const API = {
  token: () => localStorage.getItem(TOKEN_KEY),
  user:  () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },

  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  async req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = API.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !path.includes('/auth/') && !path.includes('/setup')) {
      API.clearSession();
      location.href = '/login.html';
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch { err = { error: res.statusText }; }
      const e = new Error(err.error || 'request_failed'); e.detail = err; e.status = res.status;
      throw e;
    }
    return res.json();
  },
  get(p)        { return API.req('GET', p); },
  post(p, b)    { return API.req('POST', p, b); },
  put(p, b)     { return API.req('PUT', p, b); },
  patch(p, b)   { return API.req('PATCH', p, b); },
  del(p)        { return API.req('DELETE', p); },

  ws(handler) {
    const t = API.token();
    if (!t) return null;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(t)}`);
    ws.onmessage = (ev) => { try { handler(JSON.parse(ev.data)); } catch {} };
    ws.onclose = () => setTimeout(() => API.ws(handler), 2500);  // auto-reconnect
    return ws;
  },

  async guardAuth() {
    if (!API.token()) { location.href = '/login.html'; return null; }
    try { return await API.get('/api/v1/auth/me'); }
    catch (e) { location.href = '/login.html'; return null; }
  },

  async guardSetup() {
    const s = await API.get('/api/v1/status');
    if (!s.initialized) location.href = '/setup.html';
    return s;
  },
};

window.API = API;
