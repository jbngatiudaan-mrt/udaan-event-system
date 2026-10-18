const crypto = require('crypto');
const config = require('./config');

// Unambiguous alphabet: no 0/O, 1/I/L
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function ticketCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return `${config.event.ticketPrefix}-${s}`;
}

function token() {
  return crypto.randomBytes(16).toString('base64url'); // 22 chars, 128-bit
}

function tokenHash(t) {
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 20);
}

/**
 * Normalise a WhatsApp number to E.164 digits without '+'.
 * Accepts: 9876543210, 09876543210, +91 98765 43210, 919876543210, +44 7700 900123
 * Returns null when invalid.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const hasPlus = String(raw).trim().startsWith('+');
  let d = String(raw).replace(/\D/g, '');
  const cc = config.event.defaultCountryCode;
  if (!hasPlus) {
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = cc + d;
  }
  if (d.startsWith('91')) {
    // Indian mobile: 91 + 10 digits starting 6-9
    return /^91[6-9]\d{9}$/.test(d) ? d : null;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

function prettyPhone(d) {
  if (!d) return '';
  if (d.startsWith('91') && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

function maskPhone(d) {
  return d ? `•••• ${d.slice(-4)}` : '';
}

function cleanText(v, max = 120) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validEmail(e) {
  return !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/** Pull a token out of whatever the scanner read: full URL, UDAAN:token, or bare token / ticket code. */
function extractToken(text) {
  const s = String(text || '').trim();
  const m = s.match(/\/t\/([A-Za-z0-9_-]{16,40})/);
  if (m) return { token: m[1] };
  const code = s.toUpperCase().match(new RegExp(`^${config.event.ticketPrefix}-?([A-Z0-9]{6})$`));
  if (code) return { ticketCode: `${config.event.ticketPrefix}-${code[1]}` };
  if (/^[A-Za-z0-9_-]{16,40}$/.test(s)) return { token: s };
  return {};
}

function secureRandomInt(max) {
  return crypto.randomInt(0, max);
}

module.exports = {
  ticketCode, token, tokenHash, normalizePhone, prettyPhone, maskPhone,
  cleanText, validEmail, extractToken, secureRandomInt,
};
