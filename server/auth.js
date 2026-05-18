// Auth helpers: signup (first run), login, token issuance/validation, RBAC.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.SGTD_JWT_SECRET || loadOrGenerateSecret();

function loadOrGenerateSecret() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jwt_secret');
  if (row) return row.value;
  const s = crypto.randomBytes(48).toString('hex');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', s);
  return s;
}

function uid(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

function now() { return Date.now(); }

// Issue a session token (JWT) and persist a session row.
function issueSession(user, userAgent) {
  const token = jwt.sign(
    { sub: user.id, ws: user.workspace_id, role: user.role },
    SECRET,
    { expiresIn: '30d' }
  );
  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent)
              VALUES (?, ?, ?, ?, ?)`)
    .run(token, user.id, now(), now() + 30 * 86400_000, userAgent || '');
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), user.id);
  return token;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?')
                      .get(token, now());
    if (!session) return null;
    const user = db.prepare('SELECT id, workspace_id, email, name, role FROM users WHERE id = ?')
                   .get(payload.sub);
    return user || null;
  } catch (e) { return null; }
}

function logout(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

async function hashPassword(pw) { return bcrypt.hash(pw, 11); }
async function verifyPassword(pw, hash) { return bcrypt.compare(pw, hash); }

// --- Workspace + user provisioning ---
async function createWorkspace(name) {
  const id = uid('ws_');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
            || 'workspace';
  db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, slug + '-' + crypto.randomBytes(2).toString('hex'), now());
  return id;
}

async function createUser({ workspace_id, email, name, password, role = 'viewer' }) {
  const id = uid('u_');
  const hash = await hashPassword(password);
  db.prepare(`INSERT INTO users (id, workspace_id, email, name, password_hash, role, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, workspace_id, email.toLowerCase(), name, hash, role, now());
  return id;
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

function audit({ workspace_id, user_id, action, target, detail, ip }) {
  db.prepare(`INSERT INTO audit_log (workspace_id, user_id, action, target, detail, ts, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(workspace_id || null, user_id || null, action,
         target || null, detail ? JSON.stringify(detail) : null, now(), ip || null);
}

module.exports = {
  uid, now,
  issueSession, verifyToken, logout,
  hashPassword, verifyPassword,
  createWorkspace, createUser, getUserByEmail,
  audit,
};
