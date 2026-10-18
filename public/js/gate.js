(() => {
  const $ = (s) => document.querySelector(s);
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  let gateName = LS.get('gate_name', 'Gate 1');
  let online = navigator.onLine;
  let busy = false;
  let lastCode = '';
  let lastAt = 0;

  // ---------- Offline roster ----------
  // Map: tokenHash -> entry, ticketCode -> entry. Entries: {h, code, name, city, used, at, by}
  let roster = { byHash: new Map(), byCode: new Map(), at: null };
  function loadRoster(data) {
    roster = { byHash: new Map(), byCode: new Map(), at: data.at };
    for (const [h, code, name, city, used, at, by] of data.entries) {
      const e = { h, code, name, city, used: Boolean(used), at, by };
      roster.byHash.set(h, e); roster.byCode.set(code, e);
    }
  }
  const cached = LS.get('gate_roster', null);
  if (cached) loadRoster(cached);
  const queue = LS.get('gate_queue', []); // check-ins made while offline
  const localUsed = new Set(LS.get('gate_local_used', []));

  async function sha(text) {
    if (!crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
  }
  function parseScan(text) {
    const s = String(text || '').trim();
    const m = s.match(/\/t\/([A-Za-z0-9_-]{16,40})/);
    if (m) return { token: m[1] };
    const c = s.toUpperCase().replace(/\s/g, '').match(/^([A-Z]{2,5})-?([A-Z0-9]{6})$/);
    if (c) return { code: `${c[1]}-${c[2]}` };
    if (/^[A-Za-z0-9_-]{16,40}$/.test(s)) return { token: s };
    return {};
  }

  async function refreshRoster() {
    try {
      const r = await fetch('/api/gate/roster');
      if (r.status === 401) return showLogin();
      if (!r.ok) return;
      const data = await r.json();
      loadRoster(data);
      LS.set('gate_roster', data);
    } catch {}
  }

  // ---------- Network ----------
  function setOnline(v) {
    online = v;
    const n = $('#net');
    n.textContent = v ? 'Online' : 'Offline — saving scans on this phone';
    n.classList.toggle('on', v); n.classList.toggle('off', !v);
  }
  addEventListener('online', () => { setOnline(true); syncQueue(); });
  addEventListener('offline', () => setOnline(false));

  async function api(path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: ctl.signal });
      if (r.status === 401) { showLogin(); throw Object.assign(new Error('auth'), { auth: true }); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setOnline(true);
      return r.json();
    } finally { clearTimeout(t); }
  }

  function updatePending() {
    const p = $('#pending');
    p.hidden = !queue.length;
    p.textContent = `${queue.length} waiting to sync`;
  }

  async function syncQueue() {
    if (!queue.length || !navigator.onLine) return;
    try {
      const batch = queue.slice(0, 200);
      const { results } = await api('/api/gate/sync', { items: batch });
      for (const r of results) {
        const i = queue.findIndex((q) => q.id === r.id);
        if (i >= 0) queue.splice(i, 1);
        // Someone else let this ticket in first while we were offline: flag it on the log.
        if (r.result === 'DUPLICATE' && r.attendee?.checked_in_by !== gateName) {
          addLog('dup', r.attendee.name, `Synced: was already in at ${time(r.attendee.checked_in_at)} (${r.attendee.checked_in_by})`);
        }
      }
      LS.set('gate_queue', queue);
      updatePending();
    } catch (e) { if (!e.auth) setOnline(false); }
  }

  // ---------- Check-in ----------
  async function handle(raw, source = 'camera') {
    const now = Date.now();
    if (busy) return;
    if (source === 'camera' && raw === lastCode && now - lastAt < 10000) return; // same QR still in frame: ignore for 10 s
    lastCode = raw; lastAt = now;
    const parsed = parseScan(raw);
    if (!parsed.token && !parsed.code) return verdict('miss', 'Not an Udaan pass', '', 'This QR code is not an entry pass. Ask for the WhatsApp pass, or type the ticket code.');
    busy = true;
    try {
      const res = await api('/api/gate/checkin', { code: raw, gate: gateName });
      handleResult(res);
      refreshCount();
    } catch (e) {
      if (e.auth) { busy = false; return; }
      setOnline(false);
      await offlineCheckin(raw, parsed);
    }
  }

  function handleResult(res) {
    const a = res.attendee;
    if (res.result === 'OK') {
      markLocal(a.ticket_code, true, a.checked_in_at, gateName);
      verdict('ok', 'Welcome!', a.name, [a.business, a.city].filter(Boolean).join(', ') || a.ticket_code);
      addLog('ok', a.name, a.ticket_code);
    } else if (res.result === 'DUPLICATE') {
      markLocal(a.ticket_code, true, a.checked_in_at, a.checked_in_by);
      verdict('dup', 'Already used', a.name, `Checked in at ${time(a.checked_in_at)} by ${a.checked_in_by}`);
      addLog('dup', a.name, `Already in · ${time(a.checked_in_at)} ${a.checked_in_by}`);
    } else if (res.result === 'NOT_FOUND') {
      verdict('miss', 'Pass not found', '', 'No registration matches this pass. Send them to the help desk to register.');
      addLog('miss', 'Unknown pass', '');
    } else {
      verdict('miss', 'Not an Udaan pass', '', 'Ask for the WhatsApp pass, or type the ticket code.');
    }
  }

  function markLocal(code, used, at, by) {
    const e = roster.byCode.get(code);
    if (e) { e.used = used; e.at = at; e.by = by; }
  }

  async function offlineCheckin(raw, parsed) {
    let e = null;
    if (parsed.token) { const h = await sha(parsed.token); e = h && roster.byHash.get(h); }
    else e = roster.byCode.get(parsed.code);
    if (!e) {
      if (!roster.at) verdict('miss', 'Offline', '', 'No guest list saved on this phone yet. Reconnect to Wi-Fi or mobile data.');
      else verdict('miss', 'Pass not found', '', 'Not in the saved guest list. If they registered in the last few minutes, check again once online.');
      return;
    }
    if (e.used || localUsed.has(e.code)) {
      verdict('dup', 'Already used', e.name, e.at ? `Checked in at ${time(e.at)} by ${e.by}` : 'Checked in earlier on this phone');
      addLog('dup', e.name, 'Already in (offline check)');
      return;
    }
    const at = new Date().toISOString();
    e.used = true; e.at = at; e.by = gateName;
    localUsed.add(e.code); LS.set('gate_local_used', [...localUsed]);
    queue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, code: raw, gate: gateName, at });
    LS.set('gate_queue', queue); updatePending();
    verdict('ok', 'Welcome!', e.name, `${e.city || e.code} · saved offline, will sync`);
    addLog('ok', e.name, `${e.code} (offline)`);
  }

  // ---------- UI ----------
  let dismissTimer;
  function verdict(kind, title, name, sub) {
    busy = true;
    const el = $('#result');
    el.className = `result ${kind}`;
    $('#r-glyph').textContent = kind === 'ok' ? '✓' : kind === 'dup' ? '✕' : '?';
    $('#r-title').textContent = title;
    $('#r-name').textContent = name;
    $('#r-sub').textContent = sub;
    el.hidden = false;
    if (kind === 'ok') Sfx.ding(); else Sfx.buzz();
    if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [120, 80, 120]);
    if (window.gsap) gsap.fromTo('.result-inner', { scale: .92, opacity: 0 }, { scale: 1, opacity: 1, duration: .28, ease: 'back.out(2)' });
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(dismiss, kind === 'ok' ? 2200 : 4500);
  }
  function dismiss() {
    clearTimeout(dismissTimer);
    $('#result').hidden = true;
    busy = false;
  }
  $('#result').addEventListener('click', dismiss);

  function addLog(kind, name, sub) {
    const li = document.createElement('li');
    li.className = kind;
    const n = document.createElement('div');
    n.textContent = name;
    const s = document.createElement('small'); s.textContent = sub; n.append(s);
    const t = document.createElement('time'); t.textContent = time(new Date());
    li.append(n, t);
    const log = $('#log');
    log.prepend(li);
    while (log.children.length > 12) log.lastChild.remove();
  }

  async function refreshCount() {
    try { const s = await api('/api/gate/stats'); $('#count').textContent = s.checked_in.toLocaleString('en-IN'); } catch {}
  }

  $('#manual').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('#code').value.trim();
    if (!v) return;
    lastCode = ''; handle(v, 'manual');
    $('#code').value = '';
    $('#code').blur();
  });

  $('#mute').addEventListener('click', () => {
    Sfx.setMuted(!Sfx.muted);
    $('#mute').textContent = Sfx.muted ? '🔇' : '🔊';
    $('#mute').setAttribute('aria-pressed', String(Sfx.muted));
  });

  // ---------- Camera ----------
  async function startCamera() {
    $('#cam-start').hidden = true;
    $('#cam-msg').hidden = true;
    Sfx.unlock();
    if (!window.QrScan) { camError('Scanner could not load. Use the ticket code box below.'); return; }
    try {
      await QrScan.start($('#reader'), (text) => handle(text, 'camera'));
    } catch (e) {
      const msg = `${e?.name || ''} ${e?.message || e}`;
      camError(/NotAllowed|Permission|Security/i.test(msg)
        ? 'Camera permission is blocked. Allow the camera for this site in the browser settings, then tap the button.'
        : !window.isSecureContext
          ? 'The camera only works on the secure (https) link. Open the https address, or type ticket codes below.'
          : /NotFound|NoCamera|Overconstrained/i.test(msg)
            ? 'No camera was found on this device. Type ticket codes below.'
            : 'Could not start the camera. Close other apps using it, tap the button to try again, or type ticket codes below.');
    }
  }
  function camError(msg) {
    $('#cam-msg').textContent = msg; $('#cam-msg').hidden = false;
    $('#cam-start').hidden = false;
  }
  $('#cam-start').addEventListener('click', startCamera);

  // ---------- Login ----------
  function showLogin() {
    $('#app').hidden = true; $('#login').hidden = false;
    $('#gate-name').value = gateName;
    try { QrScan.stop(); } catch {}
  }
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#login-err').textContent = '';
    gateName = $('#gate-name').value;
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'gate', pin: $('#pin').value, label: gateName }) })
      .catch(() => null);
    if (!r) { $('#login-err').textContent = 'No internet connection. Connect and try again.'; return; }
    const j = await r.json();
    if (!r.ok) { $('#login-err').textContent = j.error; return; }
    LS.set('gate_name', gateName);
    $('#pin').value = '';
    boot();
  });

  function boot() {
    $('#login').hidden = true; $('#app').hidden = false;
    $('#who').textContent = gateName;
    setOnline(navigator.onLine);
    updatePending();
    refreshRoster(); refreshCount(); syncQueue();
    startCamera();
  }

  setInterval(() => { if (navigator.onLine) { syncQueue(); refreshCount(); } }, 8000);
  setInterval(() => { if (navigator.onLine) refreshRoster(); }, 60000);

  fetch('/api/whoami').then((r) => r.json()).then((w) => (w.gate || w.admin ? boot() : showLogin())).catch(() => {
    // Offline at load but we have a roster: keep working.
    if (roster.at) boot(); else showLogin();
  });
})();
