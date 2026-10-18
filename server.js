const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const ExcelJS = require('exceljs');

const config = require('./src/config');
const db = require('./src/db');
const u = require('./src/util');
const auth = require('./src/auth');
const wa = require('./src/whatsapp');
const sheets = require('./src/sheets');
const { renderPass } = require('./src/pass');

const app = express();
app.set('trust proxy', true);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
// Keep the raw bytes for the WhatsApp webhook: Meta's signature is computed over them.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { if (req.url.startsWith('/api/wa/')) req.rawBody = buf; } }));

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const PUB = path.join(__dirname, 'public');
const page = (f) => (req, res) => res.sendFile(path.join(PUB, f));

// ---------- Subdomain routing (register.* / scan.* / draw.* / admin.*) ----------
const HOST_PAGES = { register: 'index.html', scan: 'gate.html', gate: 'gate.html', draw: 'stage.html', stage: 'stage.html', admin: 'admin.html' };
app.get('/', (req, res) => {
  const sub = (req.hostname || '').split('.')[0];
  res.sendFile(path.join(PUB, HOST_PAGES[sub] || 'index.html'));
});
app.get(['/register'], page('index.html'));
app.get(['/gate', '/scan'], page('gate.html'));
app.get(['/stage', '/draw'], page('stage.html'));
app.get('/admin', page('admin.html'));
app.get('/t/:token', page('ticket.html'));

const VENDOR = {
  'gsap.min.js': 'gsap/dist/gsap.min.js',
  'confetti.min.js': 'canvas-confetti/dist/confetti.browser.js',
  'jsQR.js': 'jsqr/dist/jsQR.js',
};
app.get('/vendor/:f', (req, res) => {
  const p = VENDOR[req.params.f];
  if (!p) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'node_modules', p));
});
app.use(express.static(PUB, { maxAge: '1h', index: false }));

// ---------- Public API ----------
app.get('/api/event', (req, res) => res.json({
  ...config.event, appEnv: config.appEnv, whatsappLive: config.whatsapp.live, waMode: config.whatsapp.mode,
  waBusinessNumber: config.whatsapp.businessNumber || null,
  poweredByWhatsapp: config.poweredByWhatsapp || null,
}));
const pushPass = config.whatsapp.mode !== 'reply'; // in reply mode the pass goes out when the visitor messages us

const regHits = new Map();
setInterval(() => regHits.clear(), 60000).unref();

const publicAttendee = (a) => a && ({
  name: a.name, ticket_code: a.ticket_code, token: a.token, city: a.city, business: a.business,
  status: a.status, checked_in_at: a.checked_in_at, won_prize: a.won_prize, won_round: a.won_round,
  phone: u.maskPhone(a.phone), pass_status: a.pass_status,
});

app.post('/api/register', asyncH(async (req, res) => {
  const n = (regHits.get(req.ip) || 0) + 1;
  regHits.set(req.ip, n);
  if (n > Number(process.env.REG_LIMIT_PER_MIN || 600)) return res.status(429).json({ error: 'Too many registrations from this network right now. Try again in a minute.' });

  const b = req.body || {};
  const name = u.cleanText(b.name, 80);
  const phone = u.normalizePhone(b.phone);
  const email = u.cleanText(b.email, 120).toLowerCase();
  const city = u.cleanText(b.city, 60);
  const business = u.cleanText(b.business, 100);
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!phone) errors.phone = 'Enter a valid 10-digit WhatsApp number (or include the country code, like +44…).';
  if (!email) errors.email = 'Enter your email address.';
  else if (!u.validEmail(email)) errors.email = 'This email address looks incomplete.';
  if (!city) errors.city = 'Enter your city.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Please fix the highlighted fields.', fields: errors });

  // Same WhatsApp number again → return the existing pass (and resend if the last send was a while ago).
  const existing = await db.q('SELECT * FROM attendees WHERE phone=$1', [phone]);
  if (existing.rows[0]) {
    const a = existing.rows[0];
    const stale = !a.pass_sent_at || Date.now() - new Date(a.pass_sent_at).getTime() > 2 * 60 * 1000;
    if (pushPass && stale && a.pass_status !== 'QUEUED') {
      await db.q(`UPDATE attendees SET pass_status='QUEUED' WHERE id=$1`, [a.id]);
      await wa.enqueue({ attendeeId: a.id, kind: 'PASS', to: a.phone, payload: { attendee: a } });
    }
    return res.json({ ok: true, existing: true, attendee: publicAttendee(a) });
  }

  let a;
  for (let i = 0; i < 5 && !a; i++) {
    try {
      const r = await db.q(
        `INSERT INTO attendees (ticket_code, token, name, phone, email, city, business) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [u.ticketCode(), u.token(), name, phone, email, city, business || null]);
      a = r.rows[0];
    } catch (e) {
      if (e.code !== '23505') throw e;
      if (/phone/.test(e.constraint || '')) { // raced with a double-tap submit
        const r = await db.q('SELECT * FROM attendees WHERE phone=$1', [phone]);
        return res.json({ ok: true, existing: true, attendee: publicAttendee(r.rows[0]) });
      }
    }
  }
  if (pushPass) await wa.enqueue({ attendeeId: a.id, kind: 'PASS', to: a.phone, payload: { attendee: a } });
  else await db.q(`UPDATE attendees SET pass_status='WAITING' WHERE id=$1`, [a.id]);
  sheets.push('REGISTERED', a);
  res.status(201).json({ ok: true, attendee: publicAttendee(a) });
}));

app.get('/api/ticket/:token', asyncH(async (req, res) => {
  const { rows } = await db.q('SELECT * FROM attendees WHERE token=$1', [req.params.token]);
  if (!rows[0]) return res.status(404).json({ error: 'We could not find this pass. Check the link from your WhatsApp message.' });
  res.json({ attendee: publicAttendee(rows[0]), event: config.event });
}));

app.get('/pass/:token.png', asyncH(async (req, res) => {
  const { rows } = await db.q('SELECT * FROM attendees WHERE token=$1', [req.params.token]);
  if (!rows[0]) return res.sendStatus(404);
  const png = await renderPass(rows[0]);
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="${rows[0].ticket_code}.png"`);
  res.send(png);
}));

// Printable QR for the registration standee (always points at this site's registration page).
app.get('/qr/register.svg', asyncH(async (req, res) => {
  const QRCode = require('qrcode');
  const svg = await QRCode.toString(`${config.publicBaseUrl}/`, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark: '#16245C', light: '#FFFFFF' } });
  res.set('Content-Type', 'image/svg+xml');
  if (req.query.download) res.set('Content-Disposition', 'attachment; filename="udaan-register-qr.svg"');
  res.send(svg);
}));

// ---------- Staff auth ----------
app.post('/api/login', auth.login);
app.get('/api/whoami', auth.whoami);
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', ['admin', 'gate', 'stage'].map((r) => `udaan_${r}=; Path=/; Max-Age=0`));
  res.json({ ok: true });
});

// ---------- Gate ----------
const gate = express.Router();
gate.use(auth.requireRole('gate'));

const checkinView = (a) => ({ name: a.name, ticket_code: a.ticket_code, city: a.city, business: a.business,
  checked_in_at: a.checked_in_at, checked_in_by: a.checked_in_by, won_prize: a.won_prize });

async function checkIn(raw, gateName, at) {
  const t = u.extractToken(raw);
  if (!t.token && !t.ticketCode) return { result: 'INVALID' };
  const col = t.token ? 'token' : 'ticket_code';
  const val = t.token || t.ticketCode;
  // Single atomic write: only the first scanner can flip REGISTERED → CHECKED_IN.
  const upd = await db.q(
    `UPDATE attendees SET status='CHECKED_IN', checked_in_at=COALESCE($3::timestamptz, NOW()), checked_in_by=$2
       WHERE ${col}=$1 AND status='REGISTERED' RETURNING *`, [val, gateName, at || null]);
  if (upd.rows[0]) { sheets.push('CHECKED_IN', upd.rows[0]); return { result: 'OK', attendee: checkinView(upd.rows[0]) }; }
  const cur = await db.q(`SELECT * FROM attendees WHERE ${col}=$1`, [val]);
  if (!cur.rows[0]) return { result: 'NOT_FOUND' };
  return { result: 'DUPLICATE', attendee: checkinView(cur.rows[0]) };
}

gate.post('/checkin', asyncH(async (req, res) => {
  const gateName = u.cleanText(req.body.gate || req.staff.who, 24) || 'Gate';
  res.json(await checkIn(req.body.code, gateName));
}));

gate.post('/sync', asyncH(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 500) : [];
  const results = [];
  for (const it of items) {
    const at = it.at && !Number.isNaN(Date.parse(it.at)) ? new Date(it.at).toISOString() : null;
    results.push({ id: it.id, ...(await checkIn(it.code, u.cleanText(it.gate || req.staff.who, 24), at)) });
  }
  res.json({ results });
}));

gate.get('/roster', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT token, ticket_code, name, city, status, checked_in_at, checked_in_by FROM attendees`);
  res.json({
    at: new Date().toISOString(),
    entries: rows.map((r) => [u.tokenHash(r.token), r.ticket_code, r.name, r.city || '', r.status === 'CHECKED_IN' ? 1 : 0, r.checked_in_at, r.checked_in_by]),
  });
}));

gate.get('/stats', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='CHECKED_IN')::int checked_in FROM attendees`);
  res.json(rows[0]);
}));
app.use('/api/gate', gate);

// ---------- Stage (lucky draw) ----------
const stage = express.Router();
stage.use(auth.requireRole('stage'));

async function eligibleCount(client = db) {
  const { rows } = await client.query(`SELECT COUNT(*)::int c FROM attendees WHERE status='CHECKED_IN' AND won_prize=false`);
  return rows[0].c;
}

async function gridPeople(ids, client = db) {
  if (!ids?.length) return [];
  const { rows } = await client.query(`SELECT id, name, city, ticket_code FROM attendees WHERE id = ANY($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => { const r = byId.get(id); return r ? { id: r.id, name: r.name, city: r.city, ticket_code: r.ticket_code } : null; });
}

async function roundView(r, client = db) {
  const out = { round_no: r.round_no, prize: r.prize, status: r.status, drawn_at: r.drawn_at, winner_index: r.winner_index, history: r.history };
  if (r.winner_id) {
    const { rows } = await client.query(`SELECT name, city, business, ticket_code, phone FROM attendees WHERE id=$1`, [r.winner_id]);
    out.winner = rows[0] && { ...rows[0], phone: u.maskPhone(rows[0].phone) };
  }
  return out;
}

stage.get('/state', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT * FROM draw_rounds ORDER BY round_no`);
  const rounds = [];
  for (const r of rows) rounds.push(await roundView(r));
  res.json({ eligible: await eligibleCount(), rounds, display: await displayView() });
}));

// What the stage screen should show right now. The stage page polls this about once a second.
//   idle  -> welcome screen ("Jai Jinendra")
//   draw  -> the 10x10 grid animates to winner_index, then the winner screen stays up
// seq goes up on every change, so the screen knows when to react.
async function displayView(client = db) {
  const { rows } = await client.query(
    `SELECT d.*, EXTRACT(EPOCH FROM (NOW() - d.started_at)) * 1000 AS elapsed_ms FROM stage_display d WHERE id=1`);
  const d = rows[0];
  const out = { mode: d.mode, seq: d.seq, round_no: d.round_no, elapsed_ms: Math.round(Number(d.elapsed_ms)), gridSize: config.event.gridSize };
  const r = (await client.query(`SELECT * FROM draw_rounds WHERE round_no=$1`, [d.round_no])).rows[0];
  if (r) out.prize = r.prize;
  if (d.mode === 'draw' && r?.status === 'DONE') {
    out.grid = (await gridPeople(r.grid, client)).map((p) => p && { name: p.name, city: p.city });
    out.winner_index = r.winner_index;
    const w = await client.query(`SELECT name, city, business, ticket_code FROM attendees WHERE id=$1`, [r.winner_id]);
    out.winner = w.rows[0] || null;
  } else if (d.mode === 'draw') {
    out.mode = 'idle'; // the round was redrawn or reset meanwhile
  }
  return out;
}

async function setDisplay(client, mode, roundNo) {
  await client.query(`UPDATE stage_display SET mode=$1, round_no=$2, seq=seq+1, started_at=NOW() WHERE id=1`, [mode, roundNo]);
}

async function nextOpenRound(client, after) {
  const { rows } = await client.query(
    `SELECT round_no FROM draw_rounds WHERE status <> 'DONE' ORDER BY (round_no <= $1), round_no LIMIT 1`, [after || 0]);
  return rows[0]?.round_no || null;
}

stage.get('/display', asyncH(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await displayView());
}));
app.use('/api/stage', stage);

// ---------- Admin ----------
const admin = express.Router();
admin.use(auth.requireRole('admin'));

admin.get('/stats', asyncH(async (req, res) => {
  const a = await db.q(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE status='CHECKED_IN')::int checked_in,
      COUNT(*) FILTER (WHERE won_prize)::int winners,
      COUNT(*) FILTER (WHERE pass_status IN ('SENT','DELIVERED','READ','MOCK'))::int passes_sent,
      COUNT(*) FILTER (WHERE pass_status='FAILED')::int passes_failed,
      COUNT(*) FILTER (WHERE pass_status='QUEUED')::int passes_queued,
      COUNT(*) FILTER (WHERE pass_status='WAITING')::int passes_waiting,
      COUNT(*) FILTER (WHERE is_demo)::int demo
    FROM attendees`);
  const hourly = await db.q(`SELECT to_char(date_trunc('hour', checked_in_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:00') h, COUNT(*)::int c
    FROM attendees WHERE checked_in_at IS NOT NULL GROUP BY 1 ORDER BY 1`);
  const gates = await db.q(`SELECT checked_in_by g, COUNT(*)::int c FROM attendees WHERE checked_in_by IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
  res.json({ ...a.rows[0], eligible: await eligibleCount(), hourly: hourly.rows, gates: gates.rows, whatsappLive: config.whatsapp.live });
}));

admin.get('/attendees', asyncH(async (req, res) => {
  const q = u.cleanText(req.query.q, 60);
  const status = ['REGISTERED', 'CHECKED_IN', 'WINNER', 'PASS_FAILED'].includes(req.query.status) ? req.query.status : '';
  const page = Math.max(0, Number(req.query.page) || 0);
  const where = [];
  const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR ticket_code ILIKE $${params.length} OR city ILIKE $${params.length} OR business ILIKE $${params.length} OR email ILIKE $${params.length})`); }
  if (status === 'WINNER') where.push('won_prize');
  else if (status === 'PASS_FAILED') where.push(`pass_status='FAILED'`);
  else if (status) { params.push(status); where.push(`status=$${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.q(`SELECT COUNT(*)::int c FROM attendees ${w}`, params);
  params.push(25, page * 25);
  const { rows } = await db.q(`SELECT id, ticket_code, token, name, phone, email, city, business, status, registered_at, checked_in_at, checked_in_by, won_prize, won_round, pass_status
    FROM attendees ${w} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ total: total.rows[0].c, page, rows: rows.map((r) => ({ ...r, phone: u.prettyPhone(r.phone) })) });
}));

admin.post('/attendees/:id/checkin', asyncH(async (req, res) => {
  const { rows } = await db.q('SELECT token FROM attendees WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Attendee not found.' });
  res.json(await checkIn(rows[0].token, `Desk (${req.staff.who})`));
}));

admin.post('/attendees/:id/resend', asyncH(async (req, res) => {
  const { rows } = await db.q(`UPDATE attendees SET pass_status='QUEUED' WHERE id=$1 AND NOT is_demo RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Attendee not found, or a demo visitor (they have no WhatsApp).' });
  await wa.enqueue({ attendeeId: rows[0].id, kind: 'PASS', to: rows[0].phone, payload: { attendee: rows[0] } });
  res.json({ ok: true });
}));

admin.get('/outbox', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT o.id, o.kind, o.to_phone, o.status, o.attempts, o.error, o.via, o.created_at, o.updated_at, a.name, a.ticket_code
    FROM wa_outbox o LEFT JOIN attendees a ON a.id=o.attendee_id ORDER BY o.id DESC LIMIT 100`);
  const counts = await db.q(`SELECT kind, status, COUNT(*)::int c FROM wa_outbox GROUP BY 1,2`);
  res.json({ rows: rows.map((r) => ({ ...r, to_phone: u.prettyPhone(r.to_phone), hint: wa.explain(r.error) })), counts: counts.rows, live: config.whatsapp.live });
}));

// ---------- Stage control (admin only) ----------
// One click = pick a fresh random 100 checked-in, not-yet-won visitors, choose the winner among them,
// and tell the stage screen to play the draw. The winner is saved before the animation starts.
admin.post('/draw/roll', asyncH(async (req, res) => {
  const n = Number(req.body.round_no);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'Choose a round first.' });
  const out = await db.tx(async (c) => {
    const disp = (await c.query(`SELECT *, EXTRACT(EPOCH FROM (NOW() - started_at)) AS age FROM stage_display WHERE id=1 FOR UPDATE`)).rows[0];
    if (disp.mode === 'draw' && Number(disp.age) < 14) return { status: 409, body: { error: 'A draw is playing on the stage screen. Wait for the winner to appear.' } };
    const r = (await c.query(`SELECT * FROM draw_rounds WHERE round_no=$1 FOR UPDATE`, [n])).rows[0];
    if (!r) return { status: 404, body: { error: 'That round does not exist.' } };
    if (r.status === 'DONE') return { status: 409, body: { error: `Round ${n} already has a winner. Click "Next round" to move on, or "Winner absent, redraw" below to draw it again.` } };
    const pick = await c.query(
      `SELECT id FROM attendees WHERE status='CHECKED_IN' AND won_prize=false ORDER BY random() LIMIT $1 FOR UPDATE SKIP LOCKED`, [config.event.gridSize]);
    if (!pick.rows.length) return { status: 409, body: { error: 'No checked-in visitors are left in the draw pool yet.' } };
    const ids = pick.rows.map((x) => x.id);
    const wi = u.secureRandomInt(ids.length);
    await c.query(`UPDATE attendees SET won_prize=true, won_round=$2 WHERE id=$1`, [ids[wi], n]);
    await c.query(`UPDATE draw_rounds SET status='DONE', grid=$2, winner_id=$3, winner_index=$4, drawn_at=NOW() WHERE round_no=$1`,
      [n, JSON.stringify(ids), ids[wi], wi]);
    await setDisplay(c, 'draw', n);
    return { body: { ok: true, round_no: n, pool: ids.length }, winnerId: ids[wi], prize: r.prize };
  });
  if (out.winnerId) {
    const a = (await db.q(`SELECT * FROM attendees WHERE id=$1`, [out.winnerId])).rows[0];
    if (!a.is_demo) await wa.enqueue({ attendeeId: a.id, kind: 'WINNER', to: a.phone, delayMs: config.whatsapp.winnerDelayMs,
      payload: { name: a.name, prize: out.prize, round: Number(req.body.round_no), ticket_code: a.ticket_code } });
    sheets.push('WINNER', a);
    out.body.winner = { name: a.name, city: a.city, ticket_code: a.ticket_code };
  }
  res.status(out.status || 200).json(out.body);
}));

// Back to the welcome screen, ready for the next round that has no winner yet.
admin.post('/draw/next', asyncH(async (req, res) => {
  const out = await db.tx(async (c) => {
    const disp = (await c.query(`SELECT * FROM stage_display WHERE id=1 FOR UPDATE`)).rows[0];
    const next = await nextOpenRound(c, disp.round_no);
    await setDisplay(c, 'idle', next || disp.round_no);
    return { round_no: next || disp.round_no, allDone: !next };
  });
  res.json(out);
}));

admin.post('/draw/show-welcome', asyncH(async (req, res) => {
  const n = Number(req.body.round_no);
  await db.tx(async (c) => setDisplay(c, 'idle', n || (await nextOpenRound(c, 0)) || 1));
  res.json({ ok: true });
}));

admin.get('/draw', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT round_no, prize, status FROM draw_rounds ORDER BY round_no`);
  res.json({ display: await displayView(), rounds: rows, eligible: await eligibleCount() });
}));

admin.put('/rounds/:n', asyncH(async (req, res) => {
  const prize = u.cleanText(req.body.prize, 80);
  if (!prize) return res.status(422).json({ error: 'Enter a prize name.' });
  const { rows } = await db.q(`UPDATE draw_rounds SET prize=$2 WHERE round_no=$1 RETURNING round_no, prize`, [req.params.n, prize]);
  if (!rows[0]) return res.status(404).json({ error: 'Round not found.' });
  res.json(rows[0]);
}));

admin.post('/rounds', asyncH(async (req, res) => {
  const { rows } = await db.q(`INSERT INTO draw_rounds (round_no, prize) SELECT COALESCE(MAX(round_no),0)+1, 'Lucky Draw ' || (COALESCE(MAX(round_no),0)+1) FROM draw_rounds RETURNING *`);
  res.json(rows[0]);
}));

// Winner not present: put the round back to OPEN. They stay excluded from future draws.
admin.post('/rounds/:n/void', asyncH(async (req, res) => {
  const reason = u.cleanText(req.body.reason, 80) || 'Winner not present';
  const out = await db.tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM draw_rounds WHERE round_no=$1 FOR UPDATE`, [req.params.n]);
    const r = rows[0];
    if (!r || r.status !== 'DONE') return null;
    const w = await c.query(`SELECT name, ticket_code FROM attendees WHERE id=$1`, [r.winner_id]);
    const hist = [...(r.history || []), { ...w.rows[0], reason, at: new Date().toISOString() }];
    await c.query(`UPDATE draw_rounds SET status='OPEN', grid=NULL, winner_id=NULL, winner_index=NULL, drawn_at=NULL, history=$2 WHERE round_no=$1`, [r.round_no, JSON.stringify(hist)]);
    const disp = (await c.query(`SELECT round_no FROM stage_display WHERE id=1`)).rows[0];
    if (disp.round_no === r.round_no) await setDisplay(c, 'idle', r.round_no);
    return { ok: true };
  });
  if (!out) return res.status(409).json({ error: 'Only a round with a winner can be redrawn.' });
  res.json(out);
}));

admin.post('/reset-draw', asyncH(async (req, res) => {
  if (req.body.confirm !== 'RESET') return res.status(422).json({ error: 'Type RESET to confirm.' });
  await db.tx(async (c) => {
    await c.query(`UPDATE draw_rounds SET status='OPEN', grid=NULL, winner_id=NULL, winner_index=NULL, drawn_at=NULL, history='[]'`);
    await c.query(`UPDATE attendees SET won_prize=false, won_round=NULL WHERE won_prize`);
    await setDisplay(c, 'idle', 1);
  });
  res.json({ ok: true });
}));

admin.get('/export.xlsx', asyncH(async (req, res) => {
  const { rows } = await db.q(`SELECT * FROM attendees ORDER BY id`);
  const rounds = await db.q(`SELECT r.round_no, r.prize, r.status, r.drawn_at, a.name, a.ticket_code, a.phone, a.city
    FROM draw_rounds r LEFT JOIN attendees a ON a.id=r.winner_id ORDER BY r.round_no`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Udaan registration desk';
  const ist = (d) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600e3) : null);
  const ws = wb.addWorksheet('Attendees', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Ticket', key: 'ticket_code', width: 14 }, { header: 'Name', key: 'name', width: 26 },
    { header: 'WhatsApp', key: 'phone', width: 18 }, { header: 'Email', key: 'email', width: 28 },
    { header: 'City', key: 'city', width: 16 }, { header: 'Business', key: 'business', width: 26 },
    { header: 'Status', key: 'status', width: 13 }, { header: 'Visited', key: 'visited', width: 9 },
    { header: 'Registered (IST)', key: 'registered_at', width: 19, style: { numFmt: 'dd-mmm hh:mm' } },
    { header: 'Checked in (IST)', key: 'checked_in_at', width: 19, style: { numFmt: 'dd-mmm hh:mm' } },
    { header: 'Gate', key: 'checked_in_by', width: 14 }, { header: 'Lucky draw winner', key: 'won', width: 16 },
    { header: 'Round', key: 'won_round', width: 8 }, { header: 'WhatsApp pass', key: 'pass_status', width: 14 },
  ];
  rows.forEach((r) => ws.addRow({ ...r, phone: u.prettyPhone(r.phone), visited: r.status === 'CHECKED_IN' ? 'Yes' : 'No',
    registered_at: ist(r.registered_at), checked_in_at: ist(r.checked_in_at), won: r.won_prize ? 'Yes' : '' }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16245C' } };
  ws.autoFilter = { from: 'A1', to: 'N1' };
  const ws2 = wb.addWorksheet('Lucky draw');
  ws2.columns = [{ header: 'Round', key: 'round_no', width: 8 }, { header: 'Prize', key: 'prize', width: 26 },
    { header: 'Winner', key: 'name', width: 26 }, { header: 'Ticket', key: 'ticket_code', width: 14 },
    { header: 'WhatsApp', key: 'phone', width: 18 }, { header: 'City', key: 'city', width: 16 },
    { header: 'Drawn at (IST)', key: 'drawn_at', width: 19, style: { numFmt: 'dd-mmm hh:mm' } }];
  rounds.rows.forEach((r) => ws2.addRow({ ...r, phone: u.prettyPhone(r.phone), drawn_at: ist(r.drawn_at) }));
  ws2.getRow(1).font = { bold: true };
  const stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="udaan-attendees-${stamp}.xlsx"` });
  await wb.xlsx.write(res);
  res.end();
}));
admin.get('/wa/check', asyncH(async (req, res) => res.json(await wa.check())));
admin.post('/wa/retry-failed', asyncH(async (req, res) => res.json({ requeued: await wa.retryFailed() })));

// UAT / local only: checked-in demo visitors to fill the lucky draw board (never sent WhatsApp).
const demo = require('./src/demo');
admin.post('/demo-visitors', asyncH(async (req, res) => {
  if (config.appEnv === 'production') return res.status(403).json({ error: 'Demo visitors are switched off in production.' });
  res.json({ added: await demo.addDemoVisitors(req.body.count || 300) });
}));
admin.delete('/demo-visitors', asyncH(async (req, res) => {
  if (config.appEnv === 'production') return res.status(403).json({ error: 'Demo visitors are switched off in production.' });
  res.json(await demo.removeDemoVisitors());
}));

// UAT / local only: clear all registrations so testing can start again from zero.
admin.post('/wipe', asyncH(async (req, res) => {
  if (config.appEnv === 'production') return res.status(403).json({ error: 'Wiping data is switched off in production.' });
  if (req.body.confirm !== 'DELETE') return res.status(422).json({ error: 'Type DELETE to confirm.' });
  await db.tx(async (c) => {
    await c.query(`UPDATE draw_rounds SET status='OPEN', grid=NULL, winner_id=NULL, winner_index=NULL, drawn_at=NULL, history='[]'`);
    await c.query('DELETE FROM wa_outbox');
    await c.query('DELETE FROM attendees');
    await setDisplay(c, 'idle', 1);
  });
  console.log(`[admin] all test data wiped by ${req.staff.who}`);
  res.json({ ok: true });
}));
app.use('/api/admin', admin);

// ---------- Meta webhook (optional delivery receipts) ----------
app.get('/api/wa/webhook', (req, res) => {
  if (req.query['hub.verify_token'] && req.query['hub.verify_token'] === process.env.WA_WEBHOOK_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/api/wa/webhook', asyncH(async (req, res) => {
  if (!wa.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
    console.warn('[wa] webhook call rejected: bad or missing signature (check WA_APP_SECRET)');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // answer Meta quickly, then process
  await wa.handleWebhook(req.body);
}));

app.get('/healthz', asyncH(async (req, res) => {
  await db.q('SELECT 1');
  res.json({ ok: true, env: config.appEnv, whatsapp: config.whatsapp.live ? config.whatsapp.mode : 'demo', version: require('./package.json').version });
}));

app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

async function main() {
  await db.migrate();
  await wa.start();
  app.listen(config.port, () => console.log(`Udaan running on ${config.publicBaseUrl} (port ${config.port})`));
  if (config.keepAliveUrl) setInterval(() => fetch(config.keepAliveUrl).catch(() => {}), 9 * 60 * 1000).unref();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { app, main };
