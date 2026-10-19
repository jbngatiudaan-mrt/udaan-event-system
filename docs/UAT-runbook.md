# Udaan UAT deployment runbook

Prepared for JITO Meerut · Udaan B2C Trade Fair, 21 October 2026 · Version 1.1 of the event system

This runbook takes the event system from the zip file to a working **UAT (user acceptance testing) site** on the internet, with **real WhatsApp delivery of each visitor's unique QR pass** through Meta's free test number. It ends with a test plan for the committee to sign off and a checklist for moving to production.

Everything in UAT runs on free plans. Follow the steps in order; each one ends with a check so you know it worked before moving on.

## What you will have at the end

| Piece | Service | Address (example) | Cost |
| --- | --- | --- | --- |
| Code | GitHub (private repository) | github.com/your-name/udaan-event-system | Free |
| Website and server | Render, free web service | https://udaan-uat.onrender.com | Free |
| Database | Supabase, free project | (internal) | Free |
| WhatsApp | Meta WhatsApp Cloud API, test number | +1 555 … (Meta's test number) | Free (see note) |

The UAT site has four pages: registration at `/`, gate scanner at `/gate`, stage lucky draw at `/stage` and organiser desk at `/admin`. Every page shows a yellow **"UAT test site: not the live event"** strip at the bottom so nobody confuses it with the real one.

**About WhatsApp cost in UAT.** Meta charges per delivered *template* message, but replies sent within 24 hours of a visitor messaging you are free, and utility templates delivered inside that window are free too ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)). The UAT plan below uses the "reply" delivery mode first, which only sends inside that window, so it is free under Meta's published pricing. The only messages that could be charged are the handful of template messages in tests T1 to T3, at India's utility rate of a few paise each.

Allow about 2 to 3 hours for the whole setup, plus waiting time for Meta to approve two message templates (usually minutes, sometimes a few hours).

## How the pieces connect

1. A visitor scans the standee QR and opens the registration page on Render.
2. Render saves the visitor in the Supabase database and shows their pass with a unique QR code on screen.
3. WhatsApp delivery:
   - **Reply mode (UAT default):** the visitor taps **Get my pass on WhatsApp**, which opens WhatsApp with a message already typed to your WhatsApp number. When they press send, Meta forwards that message to the site (the "webhook"), and the site replies with the pass image. Free, and not counted toward Meta's daily sending limit.
   - **Template mode:** the site pushes the pass immediately after registration using an approved template. One utility message is charged per pass in production; it counts toward the daily limit.
4. At the gate, a volunteer's phone scans the QR. The site marks the visitor as checked in and adds them to the lucky draw pool.
5. On stage, the draw picks winners from checked-in visitors and sends each winner a WhatsApp message.

## Before you start

**Accounts you need** (all free):

- A **GitHub** account (github.com).
- A **Render** account (render.com). Sign up with your GitHub account to save a step.
- A **Supabase** account (supabase.com). Sign up with GitHub as well.
- A **Facebook** account that will own the WhatsApp setup. Use an organiser's personal account that will stay with the committee, not a volunteer's.
- A **Meta business portfolio** for JITO Meerut. If you don't have one, Meta creates it during step 5.

**Things to have ready:**

- The file `udaan-event-system.zip` from this chat, unzipped on a laptop.
- Up to **5 phones with WhatsApp** belonging to UAT testers. Meta's test number can only message 5 numbers you register.
- Two of those phones for gate testing (one shows a pass, the other scans).
- A laptop with Chrome for the organiser desk and the stage screen.

**Secrets sheet.** Make a private note (not in WhatsApp groups or email) and fill it in as you go. You will paste these into Render in step 3 and step 5.

| Name | Where it comes from | Example |
| --- | --- | --- |
| DATABASE_URL | Supabase, step 2 | postgresql://postgres.abcd…:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres |
| PUBLIC_BASE_URL | Render, step 3 | https://udaan-uat.onrender.com |
| ADMIN_PIN, GATE_PIN, STAGE_PIN | You choose, step 3 | 6 digits for admin, 4 for the others |
| WA_PHONE_NUMBER_ID | Meta API Setup, step 5 | 1234567890123456 |
| WA_WABA_ID | Meta API Setup, step 5 | 9876543210987654 |
| WA_BUSINESS_NUMBER | Meta API Setup, step 5 | 15551234567 (digits only, with country code) |
| WA_TOKEN | Meta System User, step 5 | EAAG… (long) |
| WA_APP_SECRET | Meta App settings, step 5 | 32 letters and numbers |
| WA_WEBHOOK_VERIFY_TOKEN | You choose, step 5 | udaan-uat-verify-2026 |

Meta, Render and Supabase change their screens from time to time. If a button has moved, look for the same words nearby; the settings themselves don't change.

## Step 1 — Put the code on GitHub (10 minutes)

GitHub stores the code; Render pulls it from there and redeploys automatically whenever it changes.

1. Unzip `udaan-event-system.zip`. You get a folder named `udaan` containing `package.json`, `server.js`, `public`, `src`, `scripts`, `docs` and a few other files.
2. Go to **github.com/new**.
   - Repository name: `udaan-event-system`
   - Visibility: **Private**
   - Leave "Add a README" unticked.
   - Click **Create repository**.
3. On the empty repository page, click the link **uploading an existing file**.
4. Open the `udaan` folder on your laptop, select **everything inside it** (not the folder itself), and drag it into the browser window. Chrome uploads the sub-folders too.
5. Wait until every file shows in the list, then click **Commit changes**.
6. **Check:** the repository's main page lists `package.json`, `package-lock.json` and `server.js` at the top level, plus the folders `public`, `scripts`, `src` and `docs`. If you see a single folder named `udaan` instead, the files went one level too deep; delete and upload the folder's contents again.

If you are comfortable with git, the same thing from a terminal in the `udaan` folder:

```
git init
git add .
git commit -m "Udaan event system 1.1"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/udaan-event-system.git
git push -u origin main
```

## Step 2 — Create the UAT database on Supabase (10 minutes)

1. Go to **supabase.com/dashboard** and sign in with GitHub.
2. Click **New project**.
   - Organization: your own (create one called "JITO Meerut" if asked).
   - Project name: `udaan-uat`
   - Database password: click **Generate a password**, then copy it into your secrets sheet. If you type your own, use only letters and numbers: symbols such as `@ # / ?` break the connection address.
   - Region: **South Asia (Mumbai)**.
   - Plan: **Free**.
   - Click **Create new project** and wait about 2 minutes until the dashboard loads.
3. Click **Connect** at the top of the project page.
4. Choose the **Connection String** tab, type **URI**, and under **Session pooler** copy the address. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
5. Replace `[YOUR-PASSWORD]` (including the square brackets) with the password from step 2. Save the result as **DATABASE_URL** in your secrets sheet.

Use the **Session pooler** address, not "Direct connection". The direct connection only works over IPv6, which Render cannot reach; the pooler works over normal IPv4 on port 5432.

You don't need to create tables. The app creates them the first time it starts.

**Good to know:** Supabase pauses a free project after a week with no activity ([Supabase pricing](https://supabase.com/pricing.md)). If the UAT site shows database errors after a quiet week, open the project in Supabase and click **Restore**.

## Step 3 — Deploy the app on Render (20 minutes)

### 3.1 Create the web service

1. Go to **dashboard.render.com** and sign in with GitHub.
2. Click **New** → **Web Service**.
3. Under "Source Code", choose **GitHub**. If Render asks for access, choose **Only select repositories**, pick `udaan-event-system`, and save. Then select the repository.
4. Fill in the form:

| Field | Value |
| --- | --- |
| Name | `udaan-uat` (this becomes udaan-uat.onrender.com; Render adds letters if the name is taken) |
| Project | Optional. Leave blank or create "Udaan". |
| Language | **Node** |
| Branch | `main` |
| Region | **Singapore** (closest to India) |
| Root Directory | leave empty |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | **Free** |

### 3.2 Environment variables (first pass, WhatsApp off)

Scroll to **Environment Variables** and add these with **Add Environment Variable**. WhatsApp settings come later, in step 5, so the base system can be checked first.

| Key | Value |
| --- | --- |
| NODE_VERSION | `22` |
| APP_ENV | `uat` |
| DATABASE_URL | from your secrets sheet |
| PUBLIC_BASE_URL | `https://udaan-uat.onrender.com` (correct it in 3.4 if Render gives a different address) |
| SESSION_SECRET | click **Generate** |
| ADMIN_PIN | a 6-digit PIN for the organiser desk |
| GATE_PIN | a 4-digit PIN for gate volunteers |
| STAGE_PIN | a 4-digit PIN for the stage laptop |

Don't use the demo PINs (9999, 1111, 2222). The admin PIN also opens the gate and stage pages, so share it only with the core committee.

### 3.3 Health check and deploy

1. Open **Advanced** and set **Health Check Path** to `/healthz`. Leave **Auto-Deploy** on ("On Commit").
2. Click **Deploy Web Service**.
3. Watch the log. The first build takes 3 to 5 minutes. A good deploy ends with lines like:

```
[wa] DEMO mode (no WA_TOKEN set): messages are logged, not sent
Udaan running on https://udaan-uat.onrender.com (port 10000)
==> Your service is live 🎉
```

### 3.4 Confirm the address

1. Copy the address shown under the service name at the top (for example `https://udaan-uat.onrender.com`).
2. If it differs from the PUBLIC_BASE_URL you entered, go to **Environment**, edit PUBLIC_BASE_URL to match exactly (no slash at the end), and click **Save, rebuild, and deploy**. The QR codes on passes use this address, so it must be right.

### 3.5 Check

1. Open `https://udaan-uat.onrender.com/healthz`. You should see `{"ok":true,"env":"uat","whatsapp":"demo",…}`.
2. Open `https://udaan-uat.onrender.com/` on your phone. The registration page loads with the yellow UAT strip at the bottom.
3. Open `/admin` on the laptop and sign in with the admin PIN.

**Free plan sleep.** A free Render service goes to sleep after 15 minutes without visitors, and the next visit takes about a minute to wake it ([Render free tier](https://render.com/docs/free)). That's fine for UAT; tell testers the first page may be slow. Don't add a keep-awake setting to the UAT service: free hours are shared across your Render account (750 a month), and production will need them.

**If the deploy fails:**

| What the log says | What to do |
| --- | --- |
| `npm ci` … `package-lock.json` not found | `package-lock.json` was not uploaded. Upload it to the repository root (step 1). |
| `password authentication failed` | The password in DATABASE_URL is wrong, or `[YOUR-PASSWORD]` brackets are still there. |
| `ENOTFOUND` or `ENETUNREACH` with `db.….supabase.co` | You used the Direct connection address. Use the Session pooler address. |
| `Tenant or user not found` | The user part must be `postgres.` followed by your project reference, exactly as Supabase shows it. |
| Health check failing, service restarting | Open **Logs** and look for the first red line; it names the setting that is wrong. |

## Step 4 — Test the system without WhatsApp (15 minutes)

This proves registration, gate, stage and Excel work before WhatsApp is added.

1. **Register:** on a phone, open the UAT address, fill in the form, and tap **Send my pass on WhatsApp**. The pass appears on screen (WhatsApp is still off, so the page says so).
2. **Gate:** on a second phone, open `/gate`, choose "Gate 1", enter the gate PIN, and allow the camera. Point it at the pass on the first phone: green **Welcome!** with the name and a chime. Scan again: red **Already used** with the time and gate.
3. **Stage:** on the laptop open `/stage`, enter the stage PIN, click **Load 100 names** (with one checked-in visitor the board shows one name), then **Roll**. The winner card appears with fanfare.
4. **Organiser desk:** open `/admin`, check the counts, and click **Download Excel**. The file has an Attendees sheet and a Lucky draw sheet.
5. **Clean up:** in `/admin`, click **Reset all draws**, then **Delete all test data** (type DELETE). This button only exists on UAT; it is switched off on the production site.

Optional, for someone comfortable with a terminal: from the `udaan` folder on a laptop with Node.js 20 or newer, run `npm install`, then:

```
BASE_URL=https://udaan-uat.onrender.com ADMIN_PIN=xxxxxx GATE_PIN=xxxx STAGE_PIN=xxxx node scripts/smoke-test.js --yes
```

On Windows PowerShell, set each value first, for example `$env:BASE_URL="https://udaan-uat.onrender.com"`, then run `node scripts/smoke-test.js --yes`. It runs about a dozen automatic checks, including 10 simultaneous scans of one pass (exactly 1 must be accepted). Delete the test data afterwards.

## Step 5 — Connect WhatsApp with Meta's free test number (45 minutes)

Meta gives every WhatsApp developer app a **test phone number** that can message up to **5 numbers you register**. It behaves like the real thing, so it is ideal for UAT.

### 5.1 Create a Meta developer account

1. Go to **developers.facebook.com** and click **Get Started** (or **Log in**) with the Facebook account that will own the setup.
2. Accept the terms and verify your phone number or email if asked.

### 5.2 Create the app

1. Go to **My Apps** → **Create App**.
2. App name: `Udaan Event UAT`. Contact email: the committee's email.
3. Use case: choose **Connect with customers through WhatsApp**.
4. Business portfolio: choose JITO Meerut's portfolio, or create one when asked.
5. Click **Create app**, then re-enter your Facebook password if prompted.

### 5.3 Open API Setup and note the IDs

1. In the left menu, open **WhatsApp** → **API Setup** (on first visit, click **Start using the API**).
2. Meta creates a test WhatsApp Business Account and a test number automatically.
3. In the **From** box you see the test number (for example +1 555 …) with its **Phone number ID** below it. Copy:
   - Phone number ID → **WA_PHONE_NUMBER_ID**
   - WhatsApp Business Account ID → **WA_WABA_ID**
   - The test number itself, as digits only including the country code (for example `15551234567`) → **WA_BUSINESS_NUMBER**

### 5.4 Add the UAT testers' numbers

1. In the **To** box, choose **Manage phone number list** → **Add phone number**.
2. Enter a tester's WhatsApp number with country code (+91…). Meta sends a code to that WhatsApp; enter it to confirm.
3. Repeat for up to 5 testers.
4. **Check:** select one tester's number in **To** and click **Send message**. That phone receives Meta's "Hello World" message from the test number. Save the test number as a contact on each tester's phone (for example "Udaan UAT").

### 5.5 Create a permanent access token

The token on the API Setup page expires within about a day, so the site would stop sending overnight. Create a System User token that doesn't expire:

1. Go to **business.facebook.com** → **Settings** (gear icon) → **Users** → **System users** → **Add**.
2. Name: `udaan-server`. Role: **Admin**. Click **Create system user**.
3. With the new user selected, click **Assign assets**:
   - **Apps** → `Udaan Event UAT` → turn on **Full control (Manage app)**.
   - **WhatsApp accounts** → the test WhatsApp Business Account → turn on **Full control**.
   - Click **Save changes**.
4. Click **Generate token**:
   - App: `Udaan Event UAT`
   - Token expiration: **Never**
   - Permissions: tick `whatsapp_business_messaging`, `whatsapp_business_management` and `business_management`.
   - Click **Generate token** and copy it immediately (it is shown only once) → **WA_TOKEN**.

If the test WhatsApp account doesn't appear under **Assign assets**, use the temporary token from API Setup for now and replace it in Render whenever it expires; switch to a System User token for production.

### 5.6 Copy the app secret

1. Open **App settings** → **Basic** in the developer dashboard.
2. Next to **App secret**, click **Show**, enter your password, and copy it → **WA_APP_SECRET**.

The site uses it to confirm that webhook calls really come from Meta.

### 5.7 Add the WhatsApp settings to Render

In Render, open the `udaan-uat` service → **Environment** → **Edit**, add these, and click **Save, rebuild, and deploy**:

| Key | Value |
| --- | --- |
| WA_TOKEN | the System User token |
| WA_PHONE_NUMBER_ID | from 5.3 |
| WA_WABA_ID | from 5.3 |
| WA_BUSINESS_NUMBER | from 5.3, digits only |
| WA_APP_SECRET | from 5.6 |
| WA_WEBHOOK_VERIFY_TOKEN | a phrase you make up, for example `udaan-uat-verify-2026` |
| WA_MODE | `reply` |
| WA_TEMPLATE_LANG | `en` |

**Check:** after the deploy, the log shows `[wa] LIVE via Meta Cloud API, reply-to-visitor`.

### 5.8 Connect the webhook

The webhook is how Meta tells the site about visitors' messages and delivery receipts. Reply mode depends on it.

1. Wake the site first by opening the UAT address in a browser, because Meta gives up if the server is asleep.
2. In the developer dashboard, open **WhatsApp** → **Configuration**.
3. Under **Webhook**, click **Edit**:
   - Callback URL: `https://udaan-uat.onrender.com/api/wa/webhook`
   - Verify token: exactly the same phrase as WA_WEBHOOK_VERIFY_TOKEN
   - Click **Verify and save**. A green confirmation means the site answered correctly.
4. Under **Webhook fields**, click **Manage**, find **messages**, and switch **Subscribe** on.

### 5.9 Check the whole WhatsApp setup

1. Open `/admin` and click **Check WhatsApp setup** in the WhatsApp panel.
2. You should see Status **Live**, Delivery "Pass sent when the visitor messages you (free)", your test number with quality **GREEN**, and the webhook address with "(signature checked)".
3. The panel will also say the templates are not found. That's expected until step 6, and reply mode doesn't need them for passes.

### 5.10 First real pass on WhatsApp

1. On a tester's phone (one of the 5), open the UAT site and register with **that phone's WhatsApp number**.
2. On the success screen, tap the green **Get my pass on WhatsApp** button. WhatsApp opens a chat with the test number and a message already typed: "Hi, please send my Udaan entry pass (UDN-…)". Press **send**.
3. Within a few seconds, the pass image with the QR code arrives in that chat, with the ticket number and a link to the pass page.
4. In `/admin` → WhatsApp → Latest messages, the entry shows **Sent**, then **Delivered** and **Read** as the receipts arrive, marked "as chat reply (free)".
5. Scan that WhatsApp image at the gate (step 4.2). It must turn green.

If nothing arrives, see **Troubleshooting** at the end.

## Step 6 — Create the two message templates (20 minutes, then wait for approval)

Templates are needed for two things: winner messages to people who haven't messaged you in the last 24 hours, and **template mode** (pass pushed automatically without the visitor tapping anything). Create them on the test account now so UAT covers both.

1. Open **WhatsApp Manager**: business.facebook.com → **WhatsApp accounts** → your test account → **WhatsApp Manager**, or follow the "message templates" link in the developer dashboard.
2. Go to **Message templates** → **Create template**.

**Template 1: entry pass**

| Field | Value |
| --- | --- |
| Category | **Utility** |
| Name | `udaan_entry_pass` (exactly this, lower case) |
| Language | **English** (code `en`) |
| Header | **Image**. For the sample, upload any pass image saved from the UAT site. |
| Body | the text below |
| Footer | optional: `JITO Meerut` |
| Buttons | none |

```
Hi {{1}}, you're registered for Udaan B2C Trade Fair by JITO Meerut.

Wednesday, 21 October 2026, 12 PM to 9 PM at Wheeler Club, Meerut.

Your ticket number is {{2}}. Show the QR code in this message at the entry gate.
```

Sample values: {{1}} = `Priya Agarwal`, {{2}} = `UDN-7K4P9Q`. Click **Submit**.

**Template 2: lucky draw winner**

| Field | Value |
| --- | --- |
| Category | **Utility** |
| Name | `udaan_lucky_draw_winner` |
| Language | **English** (code `en`) |
| Header | none |
| Buttons | none |

```
Hi {{1}}, your ticket was drawn for {{2}} in lucky draw round {{3}} at Udaan B2C Trade Fair.

Please come to the stage with ticket {{4}} and a photo ID to collect it.
```

Sample values: `Priya Agarwal`, `Smart LED TV`, `1`, `UDN-7K4P9Q`. Click **Submit**.

**Rules that matter:**

- Keep the names exactly as above, or set `WA_TEMPLATE_PASS` and `WA_TEMPLATE_WINNER` in Render to the names you used.
- If Meta only offers "English (US)", pick it and set `WA_TEMPLATE_LANG` to `en_US` in Render.
- Keep the wording factual. Words like "offers", "shopping", "win prizes" or "don't miss" can make Meta re-categorise a utility template as **Marketing**, which costs more in production ([Meta utility templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates.md)).
- The number of `{{ }}` placeholders must match: 2 in the pass body plus an image header, 4 in the winner body.

**Check:** in `/admin`, click **Check WhatsApp setup**. Both templates show **APPROVED, utility** once Meta approves them; until then they show PENDING. If either says MARKETING, edit the wording and resubmit.

## Step 7 — UAT test plan

Run these with the committee. Use at least one Android phone and one iPhone. Before starting, in `/admin`: **Delete all test data**, then set real prize names for each round. Mark each case Pass or Fail; any Fail goes back for fixing before production.

**Registration**

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| R1 | Standee QR | Print or display the QR from `/admin` → Event links; scan it with a phone camera | Registration page opens with the UAT strip |
| R2 | Required fields | Tap the button with the form empty | Each missing field is highlighted with a message; nothing is saved |
| R3 | Phone validation | Enter `12345` as the WhatsApp number | "Enter a valid 10-digit WhatsApp number" |
| R4 | Indian formats | Register with `098765 43210`, then with `+91 98765 43210` | Both are accepted as the same number; the second shows "Welcome back" with the same ticket |
| R5 | International number | Register with `+44 7700 900123` | Accepted |
| R6 | Pass on screen | Complete a registration | Pass with name, QR and ticket shows; **Save pass to phone** downloads the image |
| R7 | Pass page link | Tap **Open pass page** | Shows the pass and "Not checked in yet" |

**WhatsApp (reply mode, `WA_MODE=reply`)**

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| W1 | Pass via WhatsApp | Register a tester's number; tap **Get my pass on WhatsApp**; press send | Pass image arrives in the chat within about 10 seconds |
| W2 | Pass from WhatsApp scans | Scan the WhatsApp image at the gate | Green Welcome |
| W3 | Ask again | Send "hi" to the test number from the same phone 3 minutes later | The pass is sent again (lost-pass recovery) |
| W4 | No double send | Send two messages within a minute | Only one pass arrives |
| W5 | Not registered | From a tester's number that has not registered, send "hi" | Reply with the registration link |
| W6 | Delivery receipts | Open `/admin` → WhatsApp → Latest messages | The pass shows Delivered, then Read |
| W7 | Number not allowed | Register a number that is **not** among the 5 testers, tap the button and send | No pass arrives. If Meta passed the message on, `/admin` shows the reply as Failed with "not in the test number's allowed list". In production any number works |

**WhatsApp (template mode, after templates are approved)**

In Render, set `WA_MODE` to `template` and save. Wait for the deploy.

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| T1 | Automatic pass | Register a tester's number that hasn't messaged the test number in the last 24 hours | Template message with the pass image arrives without tapping anything; `/admin` shows it "as template". (If that tester did message within 24 hours, the pass comes as a free chat reply instead; that is intended.) |
| T2 | Error explained | Register a number not among the 5 testers | `/admin` shows the message as Failed with the reason "not in the test number's allowed list" |
| T3 | Retry | Add that number to Meta's list (5.4), then click **Retry failed messages** | The pass arrives |

Set `WA_MODE` back to the mode you plan to use for the event when done.

**Gate**

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| G1 | Sign in | Open `/gate` on a volunteer phone, pick a gate, enter the gate PIN | Camera starts; wrong PIN shows "That PIN is not correct" |
| G2 | Valid pass | Scan an unscanned pass | Full-screen green, name, chime, vibration |
| G3 | Reused pass | Scan the same pass again | Full-screen red "Already used" with time and gate, buzz |
| G4 | Two gates at once | Two volunteers scan the same new pass at the same moment | One green, one red |
| G5 | Not a pass | Scan any other QR (a UPI QR, a website) | Amber "Not an Udaan pass" |
| G6 | Manual entry | Type a ticket code in the box | Same result as scanning |
| G7 | Screenshot of pass | Scan a screenshot forwarded on WhatsApp | Green (first time) |
| G8 | Network drop | Turn on airplane mode on the gate phone, scan a new pass, then turn it off | Green with "saved offline, will sync"; after reconnecting, "waiting to sync" clears and `/admin` shows the check-in |
| G9 | iPhone and Android | Repeat G2 on both | Works on both |
| G10 | Low light / brightness | Scan a pass on a phone at low brightness | Scans; if slow, ask for brightness up |

**Stage lucky draw** (the stage screen only displays; all controls are in `/admin` → Stage control)

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| S1 | Welcome screen | On the stage laptop open `/stage`, enter the stage PIN | Full screen opens; "Jai Jinendra" with the JITO/Udaan plaque and "Powered by Daily Loom, www.dailyloom.in (By Tushar Jain) · Co-powered by JBN Gati"; no buttons on screen |
| S2 | Fill the pool | In `/admin` → Lucky draw rounds, click **Add 300 demo visitors** (UAT only) | "300 demo visitors in the pool" |
| S3 | Roll | In `/admin` → Stage control, pick round 1, click **Roll** | Within a second the stage turns into a black 10×10 table of fresh names; the cursor runs about 10 s with a drum roll, lands, then the winner screen with fanfare and confetti |
| S4 | Next round | Click **Next round** | Stage goes back to "Jai Jinendra"; Stage control selects round 2 |
| S5 | New names each round | Roll rounds 2 to 5 | Each round shows a different random 100; 5 different winners |
| S6 | Refresh safety | Press F5 on the stage laptop during or after a roll | The same winner is shown; no new draw happens |
| S7 | Winner absent | In `/admin` click **Winner absent, redraw** on a round, select it in Stage control and **Roll** | New winner; the absent person is never drawn again |
| S8 | Winner WhatsApp | Make sure a real checked-in tester wins | Winner message about 12 s after the result; demo visitors never get messages |
| S9 | Sound | Play through the hall speakers; press M on the stage laptop to mute | Drum roll, ticks and fanfare audible; M toggles sound |

**Organiser desk and data**

| ID | Test | Steps | Expected result |
| --- | --- | --- | --- |
| A1 | Live counts | Register and check in a few people | Registered, Checked in and Pool counts update within 10 seconds |
| A2 | Search | Search by name, phone, ticket, city | Matching rows |
| A3 | Desk check-in | Click **Check in** on a registered visitor | Becomes checked in; pass page shows it |
| A4 | Resend pass | Click **Resend pass** | Pass is sent again on WhatsApp |
| A5 | Excel | **Download Excel** | Attendees and Lucky draw sheets, times in IST |
| A6 | PIN lockout | Enter a wrong admin PIN 6 times | From the 6th try: "Too many wrong PINs", locked for a minute |
| A7 | Cold start | Leave the site idle 20 minutes, then open it | First load takes up to a minute (free plan), then normal |

**Sign-off.** When all cases pass, record the date, the testers' names and any open issues. Then in `/admin`: **Reset all draws** and **Delete all test data**.

## Step 8 — Moving to production (after UAT sign-off)

Production uses a separate database, a separate Render service and a real WhatsApp number, so UAT data can never mix with real visitors. The code is the same.

### 8.1 WhatsApp production number — start this first

Meta reviews several things, so begin as early as possible, ideally the day UAT passes.

1. **Phone number:** a number that is **not** currently on the WhatsApp or WhatsApp Business app (a new SIM, or remove WhatsApp from an existing one first). It must be able to receive an SMS or call for verification.
2. **Add it** in WhatsApp Manager → **Phone numbers** → **Add phone number**. Display name: `JITO Meerut` (Meta reviews display names; use the organisation's real name).
3. **Payment method:** WhatsApp Manager → **Payment settings** → add a card. Required before templates can be sent to anyone in production.
4. **Business verification:** Business settings → **Security center** → **Start verification**, with the trust's registration documents. New portfolios can message only **250** people per day outside a 24-hour window; verification is one of the ways to raise that to **2,000** ([Meta messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits.md)). It can take several days.
5. **Templates:** create the same two templates on the production account (they don't carry over from the test account).
6. **Token:** add the production WhatsApp account to the `udaan-server` System User (5.5) with Full control, and generate a new token.
7. **Webhook:** same as 5.8 with the production address. Also confirm the app is subscribed to the production WhatsApp account; if passes in reply mode don't arrive, this is usually the cause.

### 8.2 Which delivery mode to use on the day

| | Reply mode (`WA_MODE=reply`) | Template mode (`WA_MODE=template`) |
| --- | --- | --- |
| What the visitor does | Taps **Get my pass on WhatsApp** and presses send | Nothing; the pass arrives by itself |
| Cost for 3,000 visitors | Free | About 3,000 utility messages (roughly ₹450 plus GST at about ₹0.15 each; check the current rate card) |
| Daily limit | Not counted | Counts toward the limit: 250 a day until business verification, then 2,000 |
| Needs approved templates | Only for winner messages | Yes |
| Risk | Some visitors may not tap the button; they still have the pass on screen and can save it | Hitting the daily limit if verification isn't done in time |

If business verification is not finished at least a few days before the event, use reply mode. If it is, either works; template mode is smoother for visitors. In both modes, the success screen also offers the WhatsApp button as a backup.

### 8.3 Production database and server

1. **Supabase:** create a second project `udaan-prod` (step 2). The free plan allows two active projects.
2. **Render:** create a second web service `udaan-jito` (step 3) with:
   - `APP_ENV` = `production` (removes the UAT strip and disables "Delete all test data")
   - the production DATABASE_URL, new PINs, new SESSION_SECRET, and the production WhatsApp values
   - `KEEPALIVE_URL` = `https://udaan-jito.onrender.com/healthz` so it doesn't fall asleep
   - For the event day, consider switching this one service to Render's lowest paid instance so it never sleeps or competes for free hours, and switch it back afterwards.
3. **Suspend the UAT service** in Render (Settings → Suspend) once production is up, so it doesn't use the shared free hours.
4. In production `/admin`, set the prize names, then download and print the **standee QR** from Event links. Never print the UAT QR.

### 8.4 Day before the event

- Open every production page once; run Check WhatsApp setup (everything green).
- Register one committee member end to end, scan them in, then delete that test visitor's row in Supabase (Table Editor → attendees) or leave them in and exclude them from the draw with **Winner absent, redraw** if drawn.
- Gate volunteers: open `/gate`, sign in, add to home screen, charge phones, keep power banks at each gate.
- Stage laptop: test sound on the hall system, full screen with F.

## Troubleshooting

**WhatsApp**

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tapping send in WhatsApp gives no reply (reply mode) | Webhook not connected or "messages" not subscribed | Repeat 5.8; check Render logs for `[wa] message from +91…` lines |
| Render log: `webhook call rejected: bad or missing signature` | WA_APP_SECRET doesn't match this app | Copy the App secret again (5.6) |
| Meta "Verify and save" fails | Site asleep, wrong URL, or verify token mismatch | Open the site first; URL must end in `/api/wa/webhook`; tokens must match exactly |
| Failed: "not in the test number's allowed list" (#131030) | Test number can only message the 5 listed numbers | Add the number in API Setup (5.4), then **Retry failed messages** |
| Failed: template does not exist (#132001) | Name or language mismatch, or not yet approved | Check names and `WA_TEMPLATE_LANG`; wait for APPROVED |
| Failed: token expired (#190) | Temporary token used | Create the System User token (5.5), update WA_TOKEN, **Retry failed messages** |
| Failed: more than 24 hours (#131047) | `WA_MODE=session` used outside the window | Use `reply` or `template` |
| Failed: undeliverable (#131026) | Number isn't on WhatsApp | Visitor saves the on-screen pass instead |
| Passes stop around 250 a day (production, template mode) | Daily messaging limit | Switch to reply mode, or complete business verification |

Every failed message in `/admin` shows a plain-language reason under it.

**Site**

| Symptom | Fix |
| --- | --- |
| First page takes about a minute | Free Render plan waking up; expected in UAT |
| Gate camera doesn't start | Must be the https address; allow camera in browser settings; close other camera apps |
| Gate shows "Offline" | Scanning still works and syncs later; check the venue Wi-Fi or mobile data |
| Database errors after a quiet week | Supabase paused the project; click Restore |
| QR on passes points to the wrong address | PUBLIC_BASE_URL is wrong; fix it and redeploy; passes are regenerated with the right link |

## Reference: all settings

| Setting | UAT value | Production value |
| --- | --- | --- |
| APP_ENV | `uat` | `production` |
| NODE_VERSION | `22` | `22` |
| DATABASE_URL | Supabase `udaan-uat` session pooler | Supabase `udaan-prod` session pooler |
| PUBLIC_BASE_URL | UAT Render address | production Render address or your domain |
| SESSION_SECRET | generated | generated (different) |
| ADMIN_PIN / GATE_PIN / STAGE_PIN | UAT PINs | new PINs |
| WA_TOKEN | System User token (test account) | System User token (production account) |
| WA_PHONE_NUMBER_ID | test number's ID | production number's ID |
| WA_WABA_ID | test account ID | production account ID |
| WA_BUSINESS_NUMBER | test number, digits only | production number, digits only |
| WA_APP_SECRET | app secret | same app's secret (or production app's) |
| WA_WEBHOOK_VERIFY_TOKEN | your phrase | your phrase |
| WA_MODE | `reply`, then `template` for T1–T3 | `reply` or `template` (8.2) |
| WA_TEMPLATE_LANG | `en` | `en` |
| KEEPALIVE_URL | leave empty | `https://<production address>/healthz` |
| DRAW_ROUNDS | `5` | `5` |

## Sources

- [Meta: WhatsApp Cloud API get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Meta: Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)
- [Meta: Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits.md)
- [Meta: Utility templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates.md)
- [Meta: Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md)
- [Render: Deploy for free](https://render.com/docs/free)
- [Supabase: Pricing](https://supabase.com/pricing.md)
- [OnCloudAPI: Test number vs production number](https://oncloudapi.com/blogs/whatsapp-cloud-api-test-number-vs-production-number-how-to-go-live)
