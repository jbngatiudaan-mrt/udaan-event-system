// Demo data: N registered visitors, ~70% checked in. Only for local testing — never run against the live database.
const db = require('../src/db');
const u = require('../src/util');

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari',
  'Anika', 'Navya', 'Myra', 'Sara', 'Kavya', 'Rohit', 'Sumit', 'Nikhil', 'Pooja', 'Neha', 'Ritu', 'Rajesh', 'Sanjay', 'Meena', 'Sunita', 'Amit', 'Deepak',
  'Shalini', 'Payal', 'Mohit', 'Tanvi', 'Yash', 'Harsh', 'Juhi', 'Kunal', 'Lavanya', 'Manish', 'Nupur', 'Pranav', 'Rachit', 'Shreya', 'Tushar', 'Varun'];
const LAST = ['Jain', 'Agarwal', 'Gupta', 'Bansal', 'Goyal', 'Mittal', 'Singhal', 'Garg', 'Sharma', 'Verma', 'Rastogi', 'Mahajan', 'Khandelwal', 'Oswal', 'Kothari', 'Bhandari'];
const CITY = ['Meerut', 'Meerut', 'Meerut', 'Meerut', 'Ghaziabad', 'Modinagar', 'Muzaffarnagar', 'Hapur', 'Baghpat', 'Noida', 'Delhi'];
const BIZ = ['', '', '', 'Textiles', 'Jewellers', 'Sports Goods', 'Traders', 'Electronics', 'Pharma', 'Sweets', 'Handlooms', 'Hardware'];

async function seed(n = 3000) {
  const { rows } = await db.q('SELECT COUNT(*)::int c FROM attendees');
  if (rows[0].c >= n) { console.log(`[seed] already have ${rows[0].c} attendees`); return; }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const values = [];
  const params = [];
  for (let i = rows[0].c; i < n; i++) {
    const f = pick(FIRST), l = pick(LAST);
    const phone = `91${7000000000 + i * 7 + 1234}`;
    const checked = Math.random() < 0.7;
    const biz = pick(BIZ);
    const p = params.length;
    params.push(u.ticketCode(), u.token(), `${f} ${l}`, phone, `${f}.${l}${i}@example.com`.toLowerCase(), pick(CITY), biz ? `${l} ${biz}` : null,
      checked ? 'CHECKED_IN' : 'REGISTERED', checked ? new Date(Date.now() - Math.random() * 6 * 3600e3) : null, checked ? pick(['Gate 1', 'Gate 2', 'Gate 3']) : null);
    values.push(`(${Array.from({ length: 10 }, (_, k) => `$${p + k + 1}`).join(',')},'MOCK')`);
    if (values.length === 500 || i === n - 1) {
      await db.q(`INSERT INTO attendees (ticket_code, token, name, phone, email, city, business, status, checked_in_at, checked_in_by, pass_status)
        VALUES ${values.join(',')} ON CONFLICT DO NOTHING`, params);
      values.length = 0; params.length = 0;
    }
  }
  console.log(`[seed] seeded up to ${n} demo attendees`);
}

module.exports = { seed };
if (require.main === module) seed(Number(process.argv[2] || 3000)).then(() => process.exit(0));
