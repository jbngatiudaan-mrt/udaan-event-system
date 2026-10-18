# Udaan B2C Trade Fair — registration, gate check-in and lucky draw

Built for JITO Meerut's Udaan B2C Trade Fair, Wednesday 21 October 2026, Wheeler Club, Meerut.
Implements the system blueprint (`Event_Registration___Lucky_Draw_System_Architecture.md`) with the committee's answers:
official Meta WhatsApp Cloud API, fields name / WhatsApp / email / city / business (optional), 5 rounds of 1 winner,
winners told on WhatsApp, and stage sound effects.

| Page | Who uses it | URL |
| --- | --- | --- |
| Registration | Visitors, from the standee QR | `/` |
| Entry pass | Visitors (link in WhatsApp) | `/t/<token>` |
| Gate scanner | 2–5 volunteers on their phones | `/gate` (gate PIN) |
| Stage lucky draw | Projector / LED wall | `/stage` (stage PIN) |
| Organiser desk | Committee | `/admin` (admin PIN) |

If you buy a domain you can also point `register.`, `scan.`, `draw.` and `admin.` sub-domains at the same app; each one opens its own page at `/`.

## What it does

**Registration.** Validates Indian 10-digit mobiles (adds +91) or any international number typed with `+`. Each visitor gets a ticket code like `UDN-7K4P9Q` and a 128-bit secret token. The QR encodes `https://<site>/t/<token>`, so it can't be guessed from the ticket code. Registering again with the same number returns the same pass instead of a duplicate. The pass image (with name, QR, ticket, date and venue) is shown on screen immediately and sent on WhatsApp.

**WhatsApp.** Messages go through a durable outbox in Postgres with up to 4 retries and back-off, so a slow or failed Meta call never blocks registration. With no Meta credentials the app runs in **demo mode**: every message is logged in the organiser desk instead of being sent.

**Gate.** Camera scanner in the phone browser, no app to install (built-in QR detector on Android/Chrome, jsQR on iPhone). The check-in is a single atomic SQL update (`… WHERE status='REGISTERED'`), so if the same QR is scanned at two gates in the same instant, exactly one gets green; the other gets red with "Checked in at 1:42 pm by Gate 2". Full-screen green/red/amber verdicts with a chime or buzz and vibration. A manual ticket-code box covers cracked screens. **Offline:** each scanner keeps the guest list on the phone (refreshed every minute); if the venue network drops, scans keep working, are saved on the phone, and sync automatically when it's back.

**Stage draw.** Each round puts 100 random checked-in, not-yet-won visitors on a 10×10 board. On Roll, the server picks the winner with a cryptographic random number and commits it before the animation starts (so a refresh or a second click can't change the result), then the gold cursor races across the board for ~10 seconds, slowing down and closing in on the winner, with a snare roll, ticks, cymbal and brass fanfare, and confetti in JITO colours. Winners can never be drawn again. If a winner isn't present, the organiser desk can reopen the round ("Winner absent, redraw"); that person stays excluded. Keyboard: **Space** roll / next round, **L** load names, **F** full screen, **W** winners board, **H** hide controls.

**Organiser desk.** Live counts, search, desk check-in, resend pass, prize names per round, add rounds, WhatsApp delivery log, one-click **Excel download** (Attendees + Lucky draw sheets, times in IST), the printable registration QR for standees. Optional live Google Sheet mirror (`docs/google-sheets-sync.gs`).

## Run it locally (demo for leadership)

Needs Node 20 or newer (nodejs.org, LTS installer) on Windows, macOS or Linux. No database install: an embedded PostgreSQL starts automatically.

```bash
npm install
npm run demo          # laptop + phones on the same Wi-Fi, 3,000 demo visitors
npm run demo:phone    # same, plus a free https link so a phone can be the gate scanner
npm test              # in a second terminal: end-to-end checks
```

Demo PINs: admin `9999`, gate `1111`, stage `2222`. `npm run dev` starts with an empty database.
On start the terminal prints a **QR code to register** (and, with `demo:phone`, a QR to open the gate scanner on a phone).
Windows may ask to allow Node.js through the firewall the first time: allow it on private networks, otherwise phones can't reach the laptop.

### How the QR is sent and scanned in a local demo

**Option A — laptop webcam is the gate (`npm run demo`, simplest).**
1. Laptop and phone on the same Wi-Fi. Phone camera scans the QR printed in the terminal (or the one under *Event links* in `/admin`), and the registration form opens.
2. Fill it in. The pass with its QR appears on the phone at once. Tap *Save pass to phone* or *Share on WhatsApp* (sends the pass link to any chat, e.g. your own number) — this stands in for the automatic WhatsApp message.
3. On the laptop open `http://localhost:3000/gate` (PIN 1111) and allow the webcam. Hold the phone's pass up to the webcam: green "Welcome!". Show it again: red "Already used".
4. Open `/stage` on the laptop or projector, *Load 100 names*, press Space.

Phone browsers only allow the camera on https pages, which is why the gate uses the laptop webcam here.

**Option B — a phone is the gate (`npm run demo:phone`).** Starts a free Cloudflare quick tunnel and prints an `https://….trycloudflare.com` link. Every QR then uses that link, so any phone (Wi-Fi or mobile data) can register, and a second phone can open the gate scanner from the printed QR and scan passes with its camera, exactly as on the day. The link changes each run and is for demos only.

**Option C — real WhatsApp delivery while testing locally.** No public URL is needed: the pass image is uploaded to Meta directly.
1. developers.facebook.com → My Apps → Create app → *Business* → add the **WhatsApp** product. Meta gives you a free **test number**.
2. WhatsApp → API Setup: add up to 5 recipient numbers you control (each confirms with a code). Copy the temporary access token and the *Phone number ID*.
3. From each recipient phone, send any message (e.g. "hi") to the test number. That opens a 24-hour window in which no template approval is needed.
4. Create a file `.env` in this folder:
   ```
   WA_TOKEN=paste-token
   WA_PHONE_NUMBER_ID=paste-id
   WA_MODE=session
   ```
5. `npm run demo` (or `demo:phone`). Register with one of those recipient numbers: the pass image arrives on WhatsApp in a few seconds, and lucky draw winners get a message too. The organiser desk badge shows "WhatsApp live" and the log shows each message's status.

Temporary tokens expire after about a day. For the event itself, remove `WA_MODE=session` and use approved templates (below).

## Go live (free tier, about 30 minutes)

1. **Database: Supabase** (free). New project, region Mumbai (ap-south-1). Project → Connect → copy the **Session pooler** connection string (port 5432, works over IPv4). The app creates its tables on first start.
2. **App: Render** (free web service, region Singapore). Push this folder to a GitHub repo, then Render → New → Blueprint → select the repo (uses `render.yaml`). Set:
   - `DATABASE_URL` — the Supabase string
   - `PUBLIC_BASE_URL` — your Render URL, e.g. `https://udaan-jito.onrender.com`
   - `ADMIN_PIN`, `GATE_PIN`, `STAGE_PIN` — new PINs
   - `KEEPALIVE_URL` — `https://<your-app>/healthz` (free Render services sleep after ~15 idle minutes; this keeps it awake)
3. Open `/admin`, download the standee QR, and run `BASE_URL=https://<your-app> npm test -- --yes` once. Then **Reset all draws** in the organiser desk and delete test rows if you like (`DELETE FROM attendees WHERE email LIKE '%@example.com'` in the Supabase SQL editor).
4. On the morning of the event, open each page once to wake everything up, and keep the admin page open on one laptop.

Free tiers change; check the current Render and Supabase limits before the event. For peace of mind on the day, Render's lowest paid instance (no sleeping) for one day costs very little and can be switched back afterwards.

## WhatsApp setup (Meta Cloud API)

Full click-by-click steps are in the UAT runbook (`docs/UAT-runbook.md` and the shared doc). Summary:

| Setting | What it is |
| --- | --- |
| `WA_TOKEN` | System User access token (permissions `whatsapp_business_messaging`, `whatsapp_business_management`) |
| `WA_PHONE_NUMBER_ID` | *Phone number ID* from API Setup (not the phone number) |
| `WA_WABA_ID` | WhatsApp Business Account ID, lets the organiser desk check template approval |
| `WA_APP_SECRET` | App settings → Basic → App secret; used to verify webhook signatures |
| `WA_WEBHOOK_VERIFY_TOKEN` | Any phrase you choose; enter the same in Meta's webhook settings |
| `WA_BUSINESS_NUMBER` | Your WhatsApp number, digits only with country code (e.g. `15551234567`) |
| `WA_MODE` | `reply` (visitor taps "Get my pass on WhatsApp", pass comes back free), `template` (pushed automatically with an approved template), or `session` (plain messages, tests only) |

Webhook: callback `https://<site>/api/wa/webhook`, subscribe to the **messages** field. It carries delivery receipts and the visitors' messages that trigger passes in reply mode.

Templates (category **Utility**, language English `en`):

**`udaan_entry_pass`** — Header: *Image*. Body:
```
Hi {{1}}, you're registered for Udaan B2C Trade Fair by JITO Meerut.

Wednesday, 21 October 2026, 12 PM to 9 PM at Wheeler Club, Meerut.

Your ticket number is {{2}}. Show the QR code in this message at the entry gate.
```

**`udaan_lucky_draw_winner`** — Body:
```
Hi {{1}}, your ticket was drawn for {{2}} in lucky draw round {{3}} at Udaan B2C Trade Fair.

Please come to the stage with ticket {{4}} and a photo ID to collect it.
```
Keep the wording factual: promotional words can get a template re-categorised as Marketing, which costs more.

The organiser desk has **Check WhatsApp setup** (number, quality, template approval, webhook) and **Retry failed messages**; failed messages show a plain-language reason.

## Day-of checklist

- Gate volunteers: open `https://<your-app>/gate`, pick their gate, enter the gate PIN, allow camera. Add to home screen. Phone brightness up, charger/power bank at each gate.
- Stage laptop: open `/stage`, stage PIN, press **F** for full screen, test sound on the hall speakers, set prize names in `/admin` first.
- Help desk: `/admin` for walk-ins (they can also register on the spot via the standee and get checked in immediately).
- After the event: download the Excel from `/admin`.

## Project layout

```
server.js              routes: registration, pass, gate, stage, admin, webhook
src/config.js          every setting, overridable by env var
src/db.js              Postgres pool + schema (auto-migrates)
src/whatsapp.js        Meta Cloud API sender with outbox, retries, demo mode
src/pass.js            renders the entry-pass image (bundled fonts, works on any host)
src/sheets.js          optional Google Sheet mirror
src/auth.js            PIN sign-in per role (signed cookies)
public/                pages, styles, scripts (GSAP, canvas-confetti, html5-qrcode served locally)
scripts/dev.js         local run with embedded Postgres; scripts/seed.js demo data
scripts/smoke-test.js  end-to-end checks
```
