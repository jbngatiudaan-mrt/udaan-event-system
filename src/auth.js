// Tiny PIN-based staff auth: signed, httpOnly cookie per role. No user table needed for a one-day event.
const crypto = require('crypto');
const config = require('./config');

const ROLES = ['admin', 'gate', 'stage'];
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, mac] = tok.split('.');
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() - p.iat > MAX_AGE_MS) return null;
    return p;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

const failures = new Map(); // ip -> {count, until}

function login(req, res) {
  const { role, pin, label } = req.body || {};
  const ip = req.ip;
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return res.status(429).json({ error: 'Too many wrong PINs. Wait a minute and try again.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
  const ok = String(pin || '') === config.pins[role] || (role !== 'admin' && String(pin || '') === config.pins.admin);
  if (!ok) {
    const n = (f?.count || 0) + 1;
    failures.set(ip, { count: n, until: n >= 5 ? Date.now() + 60000 : 0 });
    return res.status(401).json({ error: 'That PIN is not correct.' });
  }
  failures.delete(ip);
  const who = String(label || role).replace(/[^\w -]/g, '').slice(0, 24) || role;
  const tok = sign({ role, who, iat: Date.now() });
  const secure = config.publicBaseUrl.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `udaan_${role}=${encodeURIComponent(tok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure}`);
  res.json({ ok: true, role, who });
}

/** Middleware: allow the given role, and always admin. */
function requireRole(role) {
  return (req, res, next) => {
    const c = parseCookies(req);
    const s = verify(c[`udaan_${role}`]) || verify(c.udaan_admin);
    if (!s || (s.role !== role && s.role !== 'admin')) return res.status(401).json({ error: 'Please sign in again.', auth: true });
    req.staff = s;
    next();
  };
}

function whoami(req, res) {
  const c = parseCookies(req);
  const out = {};
  for (const r of ROLES) { const s = verify(c[`udaan_${r}`]); if (s) out[r] = s.who; }
  res.json(out);
}

module.exports = { login, requireRole, whoami };
