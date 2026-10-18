// Optional live mirror to a Google Sheet via a Google Apps Script web app (see docs/google-sheets-sync.gs).
// Events are batched every few seconds so 5 busy gates never hammer the Sheets quota.
const config = require('./config');

const queue = [];
let flushing = false;

function push(type, a) {
  if (!config.sheetsWebhookUrl || !a) return;
  queue.push({
    type, ticket_code: a.ticket_code, name: a.name, phone: a.phone, email: a.email || '', city: a.city || '',
    business: a.business || '', status: a.status, registered_at: a.registered_at, checked_in_at: a.checked_in_at || '',
    checked_in_by: a.checked_in_by || '', won_prize: a.won_prize, won_round: a.won_round || '',
  });
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, 200);
  try {
    const r = await fetch(config.sheetsWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: batch }), redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.warn('[sheets] sync failed, will retry:', e.message);
    queue.unshift(...batch);
  } finally {
    flushing = false;
  }
}

if (config.sheetsWebhookUrl) setInterval(flush, 4000).unref();

module.exports = { push };
