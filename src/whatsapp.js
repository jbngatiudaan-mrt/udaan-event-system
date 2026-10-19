// WhatsApp dispatch through the official Meta Cloud API, with a durable outbox in Postgres.
//
// Delivery modes (WA_MODE):
//   template (default)  Pass is pushed right after registration using the approved utility template.
//   reply               Nothing is pushed. The visitor taps "Get my pass on WhatsApp", which opens a chat with
//                       your number; when their message arrives (webhook) the pass is sent back as a normal
//                       message. Free, and does not count toward Meta's daily messaging limit.
//   session             Pushes plain (non-template) messages. Only works if the visitor messaged you in the
//                       last 24 h; meant for quick tests with Meta's test number before templates are approved.
// In every mode, if the visitor has messaged your number within the last 24 hours, a plain message is used
// (free, no template needed). Inbound messages from registered visitors always get their pass back.
//
// Without WA_TOKEN / WA_PHONE_NUMBER_ID the app runs in DEMO mode: messages are logged, not sent.
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('./config');
const db = require('./db');
const { renderPass } = require('./pass');

const wa = config.whatsapp;
const GRAPH = `${process.env.WA_GRAPH_BASE || 'https://graph.facebook.com'}/${wa.apiVersion}`;
const WINDOW_MS = 23.5 * 3600 * 1000; // stay a little inside Meta's 24 h customer service window

// ---------------------------------------------------------------- errors
// Plain-language explanations for the Meta error codes organisers are most likely to hit.
const HINTS = {
  190: 'The access token has expired or is wrong. Generate a new token (use a System User token for anything beyond a quick test) and update WA_TOKEN.',
  10: 'The token does not have permission for this phone number. Give the System User full control of the app and the WhatsApp account, then regenerate the token.',
  100: 'Meta rejected a parameter. Check WA_PHONE_NUMBER_ID (it is the Phone number ID, not the phone number itself).',
  131030: "This number is not in the test number's allowed list. In Meta's API Setup page, add it under \"To\" and confirm the code sent to that phone.",
  131026: 'The message could not be delivered. The number may not be on WhatsApp, or the person has not accepted the latest WhatsApp terms.',
  131047: 'More than 24 hours have passed since this person last messaged you, so only an approved template can be sent. Switch WA_MODE to template.',
  131049: 'Meta chose not to deliver this message to protect the user experience. Try again later.',
  131051: 'Unsupported message type.',
  131056: 'Too many messages to the same number in a short time. It will be retried.',
  130429: 'Meta rate limit reached. It will be retried automatically.',
  131000: 'Temporary error at Meta. It will be retried automatically.',
  131016: 'WhatsApp service is temporarily unavailable. It will be retried automatically.',
  132000: 'The number of values sent does not match the template. Make sure the template body has exactly the placeholders shown in the runbook.',
  132001: 'The template does not exist in this language, or is not approved yet. Check the template name, language (WA_TEMPLATE_LANG) and approval status in WhatsApp Manager.',
  132005: 'The filled-in template text is too long.',
  132007: 'The template content breaks a WhatsApp policy.',
  132012: 'The template expects a different header. The pass template must have an Image header.',
  132015: 'The template is paused because of low quality.',
  132016: 'The template is disabled because of low quality.',
  133010: 'This phone number is not registered on the Cloud API yet. Finish registering it in WhatsApp Manager.',
  368: 'The WhatsApp account is temporarily blocked for policy violations. Check WhatsApp Manager.',
  80007: 'WhatsApp account rate limit reached. It will be retried automatically.',
};
const RETRYABLE = new Set([130429, 131000, 131016, 131056, 80007, 1, 2, 4]);

function explain(errorText) {
  const m = String(errorText || '').match(/\(#(\d+)\)/);
  return m ? HINTS[Number(m[1])] || null : null;
}

class MetaError extends Error {
  constructor(status, j) {
    const err = j?.error || {};
    const detail = err.error_data?.details || err.message || `HTTP ${status}`;
    super(err.code ? `${detail} (#${err.code})` : detail);
    this.code = err.code;
    this.permanent = status < 500 && !RETRYABLE.has(err.code);
  }
}

async function graph(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${GRAPH}/${path}`, { method, headers: { Authorization: `Bearer ${wa.token}`, ...headers }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new MetaError(r.status, j);
  return j;
}

// ---------------------------------------------------------------- outbox
async function enqueue({ attendeeId, kind, to, payload, delayMs = 0 }) {
  await db.q(
    `INSERT INTO wa_outbox (attendee_id, kind, to_phone, payload, send_after) VALUES ($1,$2,$3,$4, NOW() + ($5 || ' milliseconds')::interval)`,
    [attendeeId, kind, to, payload, String(delayMs)]
  );
  kick();
}

async function uploadPassImage(attendee) {
  // JPEG keeps each upload ~200 KB instead of ~450 KB; the QR stays crisp at this quality.
  const jpg = await sharp(await renderPass(attendee)).flatten({ background: '#FFF9EC' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/jpeg');
  form.append('file', new Blob([jpg], { type: 'image/jpeg' }), `${attendee.ticket_code}.jpg`);
  const j = await graph(`${wa.phoneNumberId}/media`, { method: 'POST', body: form });
  return j.id;
}

const passCaption = (a) => {
  const ev = config.event;
  return `Hi ${a.name}, you're registered for ${ev.name} by ${ev.org}.\n\n${ev.date}, ${ev.time} at ${ev.venue}. Entry is free.\n\n`
    + `Your ticket number is ${a.ticket_code}. Show this QR code at the gate. Checked-in visitors are entered into the lucky draw.\n\n`
    + `Your pass online: ${config.publicBaseUrl}/t/${a.token}`
    + '\n\nPowered by Daily Loom, www.dailyloom.in (By Tushar Jain)\nCo-powered by JBN Gati';
};

async function templateMessage(row) {
  const p = row.payload;
  if (row.kind === 'PASS') {
    const mediaId = await uploadPassImage(p.attendee);
    const components = [
      { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
      { type: 'body', parameters: [{ type: 'text', text: p.attendee.name }, { type: 'text', text: p.attendee.ticket_code }] },
    ];
    if (wa.passButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: p.attendee.token }] });
    return { type: 'template', template: { name: wa.passTemplate, language: { code: wa.lang }, components } };
  }
  if (row.kind === 'WINNER') {
    return { type: 'template', template: { name: wa.winnerTemplate, language: { code: wa.lang }, components: [{ type: 'body', parameters: [
      { type: 'text', text: p.name }, { type: 'text', text: p.prize }, { type: 'text', text: String(p.round) }, { type: 'text', text: p.ticket_code },
    ] }] } };
  }
  throw new Error(`No template for ${row.kind}`);
}

async function sessionMessage(row) {
  const p = row.payload;
  const ev = config.event;
  if (row.kind === 'PASS') {
    const mediaId = await uploadPassImage(p.attendee);
    return { type: 'image', image: { id: mediaId, caption: passCaption(p.attendee) } };
  }
  if (row.kind === 'WINNER') {
    return { type: 'text', text: { body: `Congratulations ${p.name}! You've won ${p.prize} in Lucky Draw round ${p.round} at ${ev.name}.\n\nPlease come to the stage now with your ticket ${p.ticket_code} and a photo ID to collect your prize.` } };
  }
  return { type: 'text', text: { body: p.text, preview_url: true } }; // REPLY
}

async function windowOpen(row) {
  if (row.kind === 'REPLY') return true;
  if (!row.attendee_id) return false;
  const { rows } = await db.q('SELECT last_inbound_at FROM attendees WHERE id=$1', [row.attendee_id]);
  const t = rows[0]?.last_inbound_at;
  return Boolean(t && Date.now() - new Date(t).getTime() < WINDOW_MS);
}

async function sendLive(row) {
  const useSession = wa.mode === 'session' || (await windowOpen(row));
  const msg = useSession ? await sessionMessage(row) : await templateMessage(row);
  const j = await graph(`${wa.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: row.to_phone, ...msg }),
  });
  return { id: j.messages?.[0]?.id || null, via: useSession ? 'message' : 'template' };
}

async function markAttendee(row, status) {
  if (row.kind !== 'PASS' || !row.attendee_id) return;
  // Delivery receipts only move the visitor's pass status forward (sent -> delivered -> read).
  const receipt = status === 'DELIVERED' || status === 'READ';
  await db.q(`UPDATE attendees SET pass_status=$2,
      pass_sent_at = CASE WHEN $2 IN ('SENT','MOCK','DELIVERED','READ') THEN COALESCE(pass_sent_at, NOW()) ELSE pass_sent_at END
    WHERE id=$1 ${receipt ? `AND ${rankSql('pass_status')} < $3` : ''}`, receipt ? [row.attendee_id, status, STATUS_RANK[status]] : [row.attendee_id, status]);
}

let running = 0;
let timer = null;

async function claim(limit) {
  const { rows } = await db.q(
    `UPDATE wa_outbox SET status='SENDING', attempts=attempts+1, updated_at=NOW()
       WHERE id IN (SELECT id FROM wa_outbox WHERE status IN ('QUEUED','RETRY') AND send_after <= NOW()
                    ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [limit]);
  return rows;
}

async function processRow(row) {
  try {
    if (!wa.live) {
      await db.q(`UPDATE wa_outbox SET status='MOCK', updated_at=NOW() WHERE id=$1`, [row.id]);
      await markAttendee(row, 'MOCK');
      console.log(`[wa:demo] ${row.kind} -> +${row.to_phone}`);
      return;
    }
    const { id, via } = await sendLive(row);
    await db.q(`UPDATE wa_outbox SET status='SENT', provider_id=$2, via=$3, error=NULL, updated_at=NOW() WHERE id=$1`, [row.id, id, via]);
    await markAttendee(row, 'SENT');
  } catch (e) {
    const giveUp = e.permanent || row.attempts >= 4;
    await db.q(
      `UPDATE wa_outbox SET status=$2, error=$3, send_after=NOW() + ($4 || ' seconds')::interval, updated_at=NOW() WHERE id=$1`,
      [row.id, giveUp ? 'FAILED' : 'RETRY', String(e.message).slice(0, 400), String(5 * 2 ** row.attempts)]
    );
    if (giveUp) await markAttendee(row, 'FAILED');
    console.warn(`[wa] ${row.kind} to +${row.to_phone} failed: ${e.message}`);
  }
}

async function tick() {
  timer = null;
  try {
    const free = wa.concurrency - running;
    if (free > 0) {
      const rows = await claim(free);
      for (const row of rows) {
        running++;
        processRow(row).finally(() => { running--; kick(); });
      }
    }
  } catch (e) {
    console.error('[wa] worker error', e.message);
  }
  if (!timer) timer = setTimeout(tick, 1500);
}

function kick() { if (timer) clearTimeout(timer); timer = setTimeout(tick, 20); }

async function start() {
  await db.q(`UPDATE wa_outbox SET status='RETRY' WHERE status='SENDING'`); // anything cut off by a restart
  const how = { template: 'templates', reply: 'reply-to-visitor', session: 'plain messages (test only)' }[wa.mode];
  console.log(`[wa] ${wa.live ? `LIVE via Meta Cloud API, ${how}` : 'DEMO mode (no WA_TOKEN set): messages are logged, not sent'}`);
  if (wa.live && !wa.appSecret) console.warn('[wa] WA_APP_SECRET is not set: webhook calls are accepted without a signature check');
  tick();
}

/** Re-queue every failed message (after fixing a token, template or allowed-list problem). */
async function retryFailed() {
  const { rowCount } = await db.q(`UPDATE wa_outbox SET status='QUEUED', attempts=0, error=NULL, send_after=NOW(), updated_at=NOW() WHERE status='FAILED'`);
  await db.q(`UPDATE attendees SET pass_status='QUEUED' WHERE pass_status='FAILED'`);
  kick();
  return rowCount;
}

// ---------------------------------------------------------------- webhook
function verifySignature(rawBody, header) {
  if (!wa.appSecret) return true;
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expect = crypto.createHmac('sha256', wa.appSecret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expect.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

const STATUS_RANK = { QUEUED: 0, RETRY: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
const rankSql = (col) => `(CASE ${col} ${Object.entries(STATUS_RANK).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ')} ELSE 0 END)`;
const RANK_SQL = rankSql('status');
const seen = new Map(); // inbound message id -> time, so Meta's retries don't double-send
const replied = new Map(); // phone -> time of last "not registered" reply

async function onInbound(msg, value) {
  if (seen.has(msg.id)) return;
  seen.set(msg.id, Date.now());
  if (seen.size > 5000) seen.delete(seen.keys().next().value);

  const phone = String(msg.from || '').replace(/\D/g, '');
  if (!phone) return;
  const { rows } = await db.q(`UPDATE attendees SET last_inbound_at=NOW() WHERE phone=$1 RETURNING *`, [phone]);
  const a = rows[0];
  if (a) {
    // Don't send the pass twice if they tap send more than once.
    const recent = await db.q(`SELECT 1 FROM wa_outbox WHERE attendee_id=$1 AND kind='PASS' AND created_at > NOW() - INTERVAL '2 minutes' AND status <> 'FAILED'`, [a.id]);
    if (!recent.rows.length) {
      await db.q(`UPDATE attendees SET pass_status='QUEUED' WHERE id=$1`, [a.id]);
      await enqueue({ attendeeId: a.id, kind: 'PASS', to: a.phone, payload: { attendee: a } });
    }
    console.log(`[wa] message from +${phone} (${a.ticket_code}): pass ${recent.rows.length ? 'already sent just now' : 'queued'}`);
    return;
  }
  const last = replied.get(phone) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  replied.set(phone, Date.now());
  const name = value?.contacts?.[0]?.profile?.name;
  const ev = config.event;
  await enqueue({ attendeeId: null, kind: 'REPLY', to: phone, payload: { text:
    `Hi${name ? ` ${name}` : ''}! This WhatsApp number isn't registered for ${ev.name} yet.\n\n`
    + `Register for your free entry pass here: ${config.publicBaseUrl}/\n\nUse this same WhatsApp number, and your pass will arrive here.` } });
  console.log(`[wa] message from unregistered +${phone}: sent registration link`);
}

async function handleWebhook(body) {
  const values = body?.entry?.flatMap((e) => e.changes || []).map((c) => c.value || {}) || [];
  for (const v of values) {
    for (const s of v.statuses || []) {
      const st = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[s.status];
      if (!st) continue;
      const e = s.errors?.[0];
      const err = e ? `${e.error_data?.details || e.title || e.message} (#${e.code})` : null;
      // Statuses can arrive out of order and in parallel; the rank check inside the UPDATE makes sure
      // a row never moves backwards (e.g. read -> delivered).
      const { rows } = await db.q(
        `UPDATE wa_outbox SET status=$2, error=COALESCE($3,error), updated_at=NOW()
           WHERE provider_id=$1 AND ${RANK_SQL} < $4 RETURNING *`, [s.id, st, err, STATUS_RANK[st]]);
      if (rows[0]) await markAttendee(rows[0], st);
    }
    for (const m of v.messages || []) await onInbound(m, v);
  }
}

// ---------------------------------------------------------------- health check for the organiser desk
async function check() {
  const out = {
    live: wa.live, mode: wa.mode, apiVersion: wa.apiVersion, businessNumber: wa.businessNumber || null,
    templates: { pass: wa.passTemplate, winner: wa.winnerTemplate, lang: wa.lang },
    webhookUrl: `${config.publicBaseUrl}/api/wa/webhook`, webhookSigned: Boolean(wa.appSecret),
  };
  if (!wa.live) return { ...out, ok: false, problems: ['WhatsApp is in demo mode: WA_TOKEN and WA_PHONE_NUMBER_ID are not set.'] };
  const problems = [];
  try {
    out.number = await graph(`${wa.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,name_status,code_verification_status,platform_type`);
  } catch (e) {
    problems.push(`Could not read the phone number: ${e.message}${explain(e.message) ? ` ${explain(e.message)}` : ''}`);
  }
  if (wa.wabaId) {
    try {
      const t = await graph(`${wa.wabaId}/message_templates?fields=name,status,category,language&limit=200`);
      const want = wa.mode === 'reply' ? [wa.winnerTemplate] : [wa.passTemplate, wa.winnerTemplate];
      out.templateStatus = want.map((name) => {
        const found = (t.data || []).filter((x) => x.name === name);
        const exact = found.find((x) => x.language === wa.lang);
        return { name, status: exact?.status || (found.length ? `exists in ${found.map((x) => x.language).join(', ')}, not ${wa.lang}` : 'NOT FOUND'), category: exact?.category };
      });
      out.templateStatus.forEach((x) => {
        if (x.status !== 'APPROVED') problems.push(`Template ${x.name}: ${x.status}.`);
        else if (x.category && x.category !== 'UTILITY') problems.push(`Template ${x.name} was approved as ${x.category}, which costs more than UTILITY.`);
      });
    } catch (e) {
      problems.push(`Could not read templates: ${e.message}`);
    }
  } else {
    out.templateStatus = null;
    problems.push('Set WA_WABA_ID to let this page check template approval.');
  }
  if (wa.mode === 'reply' && !wa.businessNumber) problems.push('WA_MODE is reply but WA_BUSINESS_NUMBER is not set, so visitors have no button to message you.');
  return { ...out, ok: problems.length === 0, problems };
}

module.exports = { enqueue, start, handleWebhook, verifySignature, retryFailed, check, explain };
