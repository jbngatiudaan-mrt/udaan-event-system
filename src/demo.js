// UAT-only demo visitors: already checked in, so the lucky draw board can be filled without
// registering real people. They are flagged is_demo and never sent WhatsApp messages.
const crypto = require('crypto');
const db = require('./db');
const u = require('./util');

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari',
  'Anika', 'Navya', 'Myra', 'Kavya', 'Rohit', 'Sumit', 'Nikhil', 'Pooja', 'Neha', 'Ritu', 'Rajesh', 'Sanjay', 'Meena', 'Sunita', 'Amit', 'Deepak',
  'Shalini', 'Payal', 'Mohit', 'Tanvi', 'Yash', 'Harsh', 'Juhi', 'Kunal', 'Lavanya', 'Manish', 'Nupur', 'Pranav', 'Rachit', 'Shreya', 'Tushar', 'Varun'];
const LAST = ['Jain', 'Agarwal', 'Gupta', 'Bansal', 'Goyal', 'Mittal', 'Singhal', 'Garg', 'Sharma', 'Verma', 'Rastogi', 'Mahajan', 'Khandelwal', 'Oswal', 'Kothari', 'Bhandari'];
const CITY = ['Meerut', 'Meerut', 'Meerut', 'Ghaziabad', 'Modinagar', 'Muzaffarnagar', 'Hapur', 'Baghpat', 'Noida', 'Delhi'];

async function addDemoVisitors(count) {
  const n = Math.max(1, Math.min(1000, Math.floor(Number(count) || 0)));
  const pick = (a) => a[crypto.randomInt(0, a.length)];
  const values = [];
  const params = [];
  for (let i = 0; i < n; i++) {
    const p = params.length;
    // Not a real number: "demo-" prefix, so it can never match a WhatsApp sender or be messaged.
    params.push(u.ticketCode(), u.token(), `${pick(FIRST)} ${pick(LAST)}`, `demo-${crypto.randomBytes(6).toString('hex')}`, pick(CITY));
    values.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},'Demo visitor','CHECKED_IN',NOW(),'Demo data','MOCK',true)`);
  }
  const r = await db.q(`INSERT INTO attendees (ticket_code, token, name, phone, city, business, status, checked_in_at, checked_in_by, pass_status, is_demo)
    VALUES ${values.join(',')} ON CONFLICT DO NOTHING`, params);
  return r.rowCount;
}

async function removeDemoVisitors() {
  return db.tx(async (c) => {
    // Rounds that a demo visitor won, or whose loaded board contains demo visitors, go back to "not drawn".
    const demo = await c.query('SELECT id FROM attendees WHERE is_demo');
    const ids = demo.rows.map((r) => r.id);
    if (!ids.length) return { removed: 0, roundsReopened: 0 };
    const reopened = await c.query(
      `UPDATE draw_rounds SET status='OPEN', grid=NULL, winner_id=NULL, winner_index=NULL, drawn_at=NULL
         WHERE winner_id = ANY($1) OR (status='READY' AND grid IS NOT NULL AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(grid) g WHERE g::int = ANY($1)))`, [ids]);
    await c.query('DELETE FROM wa_outbox WHERE attendee_id = ANY($1)', [ids]);
    const del = await c.query('DELETE FROM attendees WHERE is_demo');
    if (reopened.rowCount) await c.query(`UPDATE stage_display SET mode='idle', seq=seq+1, started_at=NOW() WHERE id=1`);
    return { removed: del.rowCount, roundsReopened: reopened.rowCount };
  });
}

module.exports = { addDemoVisitors, removeDemoVisitors };
