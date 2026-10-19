// Renders the personalised entry pass (PNG) that goes out on WhatsApp and shows on the ticket page.
// Text is converted to vector paths with bundled fonts, so it renders identically on any host.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');
const opentype = require('opentype.js');
const config = require('./config');

const root = path.join(__dirname, '..');
const fontFile = (pkg, f) => path.join(root, 'node_modules/@fontsource', pkg, 'files', f);
const loadFont = (p) => { const b = fs.readFileSync(p); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const FONTS = {
  display: loadFont(fontFile('yeseva-one', 'yeseva-one-latin-400-normal.woff')),
  body: loadFont(fontFile('mukta', 'mukta-latin-500-normal.woff')),
  bold: loadFont(fontFile('mukta', 'mukta-latin-800-normal.woff')),
};
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(root, 'public/img', f)).toString('base64')}`;
const LOGO_JITO = img('jito-meerut.alpha.png');
const LOGO_UDAAN = img('udaan.alpha.png');

const C = { ivory: '#FFF9EC', gold: '#B8862B', goldLight: '#E8C877', navy: '#16245C', ink: '#1B1B2F', saffron: '#E8650F',
  jBlue: '#1F4FA3', jRed: '#D7262B', jGreen: '#2E8B3D', jYellow: '#F4B400' };

const isLatin = (s) => /^[\u0000-ɏ -⁯]*$/.test(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Text as an SVG path, centred on x, shrunk to fit maxWidth. Falls back to <text> for non-Latin names. */
function text(str, { font = 'body', size, x, y, fill = C.ink, maxWidth = 960, anchor = 'middle' }) {
  str = String(str || '');
  if (!isLatin(str)) {
    return `<text x="${x}" y="${y}" font-family="Noto Sans, Noto Sans Devanagari, sans-serif" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
  }
  const f = FONTS[font];
  let s = size;
  let w = f.getAdvanceWidth(str, s);
  if (w > maxWidth) { s = s * (maxWidth / w); w = maxWidth; }
  let startX = Math.round(anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x);
  // opentype.js occasionally emits NaN for some coordinate/size combos; nudge until the path is clean.
  let out = f.getPath(str, startX, y, s).toSVG(2);
  for (let i = 1; out.includes('NaN') && i < 6; i++) out = f.getPath(str, startX + i, y, Math.round(s) + i * 0.25).toSVG(2);
  return out.replace('<path', `<path fill="${fill}"`);
}

function stripe(x, y, w, h) {
  const cols = [C.jBlue, C.jRed, C.jGreen, C.jYellow];
  const bw = w / cols.length;
  return cols.map((c, i) => `<rect x="${x + i * bw}" y="${y}" width="${bw + 0.5}" height="${h}" fill="${c}"/>`).join('');
}

const prettyNumber = (d) => (d.startsWith('91') && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

const cache = new Map();
const CACHE_MAX = 300;

async function renderPass(a) {
  const key = `${a.token}:${a.name}`;
  if (cache.has(key)) return cache.get(key);

  const W = 1080, D = 80, H = 1500 + D; // D = room for the credits above "Entry pass"
  const url = `${config.publicBaseUrl}/t/${a.token}`;
  const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: C.navy, light: '#0000' } });
  const qrInner = qrSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const qrView = (qrSvg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 33 33';
  const ev = config.event;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#FFFDF6"/><stop offset="1" stop-color="#F7EBCF"/></radialGradient>
    <linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#9C6B16"/><stop offset=".5" stop-color="#E8C877"/><stop offset="1" stop-color="#9C6B16"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="34" fill="none" stroke="url(#gold)" stroke-width="6"/>
  <rect x="46" y="46" width="${W - 92}" height="${H - 92}" rx="22" fill="none" stroke="${C.goldLight}" stroke-width="2"/>

  <image href="${LOGO_JITO}" x="${W / 2 - 150}" y="80" width="300" height="120"/>
  <image href="${LOGO_UDAAN}" x="${W / 2 - 245}" y="205" width="490" height="322"/>

  ${text('Powered by DAILY LOOM by Tushar Jain  ·  Co-powered by JBN Gati', { size: 27, x: W / 2, y: 560, fill: C.navy, maxWidth: 900 })}
  ${config.poweredByWhatsapp ? text(`DAILY LOOM on WhatsApp: ${prettyNumber(config.poweredByWhatsapp)}`, { size: 25, x: W / 2, y: 595, fill: '#5A5A6E', maxWidth: 900 }) : ''}
  <line x1="${W / 2 - 300}" y1="616" x2="${W / 2 + 300}" y2="616" stroke="${C.goldLight}" stroke-width="2"/>

  ${text('Entry pass', { font: 'display', size: 44, x: W / 2, y: 590 + D, fill: C.gold })}
  ${text(a.name, { font: 'display', size: 76, x: W / 2, y: 682 + D, fill: C.navy, maxWidth: 900 })}
  ${a.city || a.business ? text([a.business, a.city].filter(Boolean).join(', '), { size: 36, x: W / 2, y: 735 + D, fill: '#5A5A6E', maxWidth: 880 }) : ''}

  <rect x="${W / 2 - 230}" y="${770 + D}" width="460" height="460" rx="28" fill="#FFFFFF" stroke="${C.goldLight}" stroke-width="3"/>
  <svg x="${W / 2 - 175}" y="${825 + D}" width="350" height="350" viewBox="${qrView}" shape-rendering="crispEdges">${qrInner}</svg>

  ${text(a.ticket_code, { font: 'bold', size: 58, x: W / 2, y: 1300 + D, fill: C.ink })}
  ${text(`${ev.date}  |  ${ev.time}`, { size: 34, x: W / 2, y: 1360 + D, fill: C.navy })}
  ${text(`${ev.venue}  |  Free entry`, { size: 34, x: W / 2, y: 1405 + D, fill: C.navy })}
  ${stripe(W / 2 - 160, 1428 + D, 320, 10)}
</svg>`;

  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 8, palette: false }).toBuffer();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

module.exports = { renderPass };
