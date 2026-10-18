// End-to-end API check. Run against the local demo (npm run demo, then npm test).
// It creates test registrations and draws a round, so on a real deployment run it only BEFORE the event
// and then reset the draw from the admin page: BASE_URL=https://your-app npm test -- --yes
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PIN = { admin: process.env.ADMIN_PIN || '9999', gate: process.env.GATE_PIN || '1111', stage: process.env.STAGE_PIN || '2222' };
if (!/localhost|127\.0\.0\.1/.test(BASE) && !process.argv.includes('--yes')) {
  console.error(`Refusing to write test data to ${BASE} without --yes`); process.exit(1);
}

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };
async function login(role) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, pin: PIN[role], label: `Smoke ${role}` }) });
  return r.headers.get('set-cookie')?.split(';')[0];
}
const post = (path, body, cookie) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body || {}) });

(async () => {
  console.log(`Smoke test against ${BASE}`);
  const phone = `98${String(Date.now()).slice(-8)}`;

  console.log('Registration');
  let r = await post('/api/register', { name: 'Smoke Test', phone, email: 'smoke@example.com', city: 'Meerut', business: 'QA' });
  const reg = await r.json();
  ok(r.status === 201 && /^[A-Z]+-[A-Z0-9]{6}$/.test(reg.attendee?.ticket_code), `new registration gets ticket ${reg.attendee?.ticket_code}`);
  r = await post('/api/register', { name: 'Smoke Again', phone: `+91 ${phone}`, email: 'smoke@example.com', city: 'Meerut' });
  const again = await r.json();
  ok(again.existing && again.attendee.ticket_code === reg.attendee.ticket_code, 'same WhatsApp number returns the same pass');
  r = await post('/api/register', { name: 'X', phone: '12345', email: 'nope', city: '' });
  ok(r.status === 422, 'invalid form is rejected with field errors');
  r = await fetch(`${BASE}/pass/${reg.attendee.token}.png`);
  ok(r.ok && r.headers.get('content-type') === 'image/png', 'pass image renders');

  console.log('Gate');
  const gate = await login('gate');
  ok(Boolean(gate), 'gate PIN signs in');
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/api/gate/checkin', { code: `${BASE}/t/${reg.attendee.token}`, gate: `Gate ${(i % 5) + 1}` }, gate).then((x) => x.json())));
  ok(results.filter((x) => x.result === 'OK').length === 1 && results.filter((x) => x.result === 'DUPLICATE').length === 9, '10 simultaneous scans of one pass: exactly 1 accepted, 9 flagged as already used');
  r = await post('/api/gate/checkin', { code: 'UDN-ZZZZZZ' }, gate);
  ok((await r.json()).result === 'NOT_FOUND', 'unknown ticket code is reported as not found');
  r = await post('/api/gate/checkin', { code: 'hello' });
  ok(r.status === 401, 'check-in without PIN is refused');

  console.log('Stage draw');
  const stage = await login('stage');
  const st = await (await fetch(`${BASE}/api/stage/state`, { headers: { cookie: stage } })).json();
  const open = st.rounds.find((x) => x.status !== 'DONE');
  if (!open) { ok(true, 'all rounds already drawn (skipping draw test)'); }
  else {
    r = await post(`/api/stage/rounds/${open.round_no}/prepare`, {}, stage);
    const g = await r.json();
    ok(r.ok && g.grid.length > 0 && g.grid.length <= 100, `round ${open.round_no}: ${g.grid.length} names on the board`);
    r = await post(`/api/stage/rounds/${open.round_no}/roll`, {}, stage);
    const w = await r.json();
    ok(r.ok && w.winner && g.grid[w.winner_index]?.ticket_code === w.winner.ticket_code, `winner ${w.winner?.name} is the person in cell ${w.winner_index}`);
    const w2 = await (await post(`/api/stage/rounds/${open.round_no}/roll`, {}, stage)).json();
    ok(w2.replay && w2.winner.ticket_code === w.winner.ticket_code, 'rolling again replays the same winner (refresh-safe)');
  }

  console.log('Admin');
  const admin = await login('admin');
  r = await fetch(`${BASE}/api/admin/export.xlsx`, { headers: { cookie: admin } });
  const buf = Buffer.from(await r.arrayBuffer());
  ok(r.ok && buf.slice(0, 2).toString() === 'PK', `Excel export downloads (${Math.round(buf.length / 1024)} KB)`);
  const s = await (await fetch(`${BASE}/api/admin/stats`, { headers: { cookie: admin } })).json();
  ok(s.total > 0, `stats: ${s.total} registered, ${s.checked_in} checked in, ${s.winners} winners`);

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
