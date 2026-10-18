// Local demo: boots an embedded PostgreSQL (no install needed) and then the app.
//
//   npm run dev          empty database
//   npm run demo         + 3,000 demo visitors
//   npm run demo:phone   + a free https link (Cloudflare quick tunnel) so phones can register AND scan
//
// Flags: --seed <n>   --tunnel   --port <n>
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const seed = Number(opt('seed') || process.env.SEED || 0);
const PORT = Number(opt('port') || process.env.PORT || 3000);
process.env.PORT = String(PORT);
process.env.APP_ENV = process.env.APP_ENV || 'local';

/** The laptop's address on the Wi-Fi, so a phone on the same Wi-Fi can open the site. */
function lanIp() {
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  const pick = nets.find((n) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address)) || nets[0];
  return pick?.address;
}

async function startTunnel() {
  let cf;
  try { cf = require('cloudflared'); } catch { throw new Error('Run "npm install" first (the cloudflared helper is missing).'); }
  const bin = process.env.CLOUDFLARED_BIN || cf.bin;
  if (!fs.existsSync(bin)) {
    console.log('  Downloading cloudflared (one time)…');
    await cf.install(bin);
  }
  const { spawn } = require('child_process');
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); child.kill(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail('The secure link did not start within 40 s. Check the internet connection, or run "npm run demo" instead.'), 40000);
    const onData = (buf) => {
      const s = buf.toString();
      // The tunnel address is a random-words subdomain; api.trycloudflare.com is only the service endpoint.
      const m = s.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
      if (done) return;
      if (m) { done = true; clearTimeout(timer); resolve(m[0]); return; }
      if (/failed to request quick Tunnel|no such host|ERR .*(failed|error)/i.test(s)) fail(`Could not open the secure link: ${s.trim().split('\n').pop()}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => fail(`cloudflared stopped (code ${code}).`));
  });
  child.removeAllListeners('exit');
  return { url, stop: () => child.kill() };
}

async function printQr(label, url) {
  const QRCode = require('qrcode');
  const art = await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
  console.log(`\n  ${label}\n  ${url}\n${art.replace(/^/gm, '  ')}`);
}

(async () => {
  let tunnel;
  if (flag('tunnel')) {
    console.log('  Opening a secure public link for phones…');
    tunnel = await startTunnel();
    process.env.PUBLIC_BASE_URL = tunnel.url;
  } else if (!process.env.PUBLIC_BASE_URL) {
    const ip = lanIp();
    if (ip) process.env.PUBLIC_BASE_URL = `http://${ip}:${PORT}`;
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  // Postgres refuses to run as root; when root, keep data in a dir the 'postgres' user owns.
  const isRoot = process.getuid && process.getuid() === 0;
  const dir = process.env.PGDATA_DIR || (isRoot ? '/var/lib/udaanpg/data' : path.join(__dirname, '..', '.pgdata'));
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  const pgPort = Number(process.env.PG_PORT || 54329);
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'udaan', password: 'udaan', port: pgPort, persistent: true, onLog: () => {} });
  if (fresh) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  if (fresh) await pg.createDatabase('udaan');
  process.env.DATABASE_URL = process.env.DATABASE_URL || `postgres://udaan:udaan@localhost:${pgPort}/udaan`;

  const stop = async () => { try { tunnel?.stop(); } catch {} try { await pg.stop(); } catch {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await require('../server').main();
  if (seed) await require('./seed').seed(seed);

  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  const pins = { admin: process.env.ADMIN_PIN || '9999', gate: process.env.GATE_PIN || '1111', stage: process.env.STAGE_PIN || '2222' };
  await printQr('Scan with a phone to REGISTER (this is the standee QR):', `${base}/`);
  if (tunnel) await printQr(`Scan with a volunteer's phone to open the GATE SCANNER (PIN ${pins.gate}):`, `${base}/gate`);
  console.log(`  On this laptop:
    Gate scanner (webcam)  http://localhost:${PORT}/gate     PIN ${pins.gate}
    Stage lucky draw       http://localhost:${PORT}/stage    PIN ${pins.stage}
    Organiser desk         http://localhost:${PORT}/admin    PIN ${pins.admin}
  ${tunnel ? 'Phones can use the https link above from anywhere, including mobile data.'
    : 'Phones must be on the same Wi-Fi as this laptop. Phone cameras need https, so scan passes with the laptop webcam,\n  or restart with "npm run demo:phone" to use a phone as the gate scanner.'}
  Press Ctrl+C to stop.\n`);
})().catch((e) => { console.error(`\n  Could not start: ${e.message}\n`); process.exit(1); });
