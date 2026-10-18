(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
  const time = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  let page = 0;
  let total = 0;

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { $('#login').hidden = false; throw new Error('Signed out'); }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = `toast${bad ? ' bad' : ''}`; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function ask(title, text, { input, okLabel = 'Confirm' } = {}) {
    return new Promise((resolve) => {
      const d = $('#dlg');
      $('#dlg-title').textContent = title; $('#dlg-text').textContent = text;
      $('#dlg-input').hidden = !input; $('#dlg-input').value = ''; $('#dlg-input').placeholder = input || '';
      $('#dlg-ok').textContent = okLabel;
      d.onclose = () => resolve(d.returnValue === 'ok' ? (input ? $('#dlg-input').value : true) : null);
      d.showModal();
    });
  }

  async function stats() {
    const s = await api('/api/admin/stats');
    $('#s-total').textContent = fmt(s.total);
    $('#s-in').textContent = fmt(s.checked_in);
    $('#s-in-bar').style.width = s.total ? `${(100 * s.checked_in) / s.total}%` : '0';
    $('#s-pool').textContent = fmt(s.eligible);
    $('#s-sent').textContent = fmt(s.passes_sent);
    $('#s-failed').textContent = fmt(s.passes_failed);
    $('#s-win').textContent = fmt(s.winners);
    const m = $('#mode');
    m.textContent = s.whatsappLive ? 'WhatsApp live' : 'WhatsApp demo mode';
    m.className = `mode ${s.whatsappLive ? 'live' : 'demo'}`;
    m.title = s.whatsappLive ? 'Messages go out through the Meta Cloud API' : 'No Meta credentials set: messages are logged here, not sent';
  }

  const statusPill = (r) => (r.won_prize ? `<span class="pill win">Won round ${r.won_round}</span>`
    : r.status === 'CHECKED_IN' ? `<span class="pill in" title="${esc(r.checked_in_by)}">In ${esc(time(r.checked_in_at).split(', ').pop())}</span>`
      : '<span class="pill reg">Registered</span>');
  const passPill = (s) => ({ FAILED: '<span class="pill fail">Failed</span>', QUEUED: '<span class="pill reg">Queued</span>', RETRY: '<span class="pill reg">Retrying</span>',
    SENDING: '<span class="pill reg">Sending</span>', WAITING: '<span class="pill reg" title="Waiting for the visitor to message the WhatsApp number">Waiting</span>',
    MOCK: '<span class="pill ok">Demo</span>' })[s] || `<span class="pill ok">${esc(s.charAt(0) + s.slice(1).toLowerCase())}</span>`;

  async function rows() {
    const qs = new URLSearchParams({ q: $('#q').value, status: $('#status').value, page });
    const j = await api(`/api/admin/attendees?${qs}`);
    total = j.total;
    $('#rows').innerHTML = j.rows.map((r) => `<tr>
      <td class="code">${esc(r.ticket_code)}</td>
      <td>${esc(r.name)}<br><small class="muted">${esc(r.email)}</small></td>
      <td style="white-space:nowrap">${esc(r.phone)}</td>
      <td>${esc(r.city)}</td><td>${esc(r.business)}</td>
      <td>${statusPill(r)}</td><td>${passPill(r.pass_status)}</td>
      <td class="acts">
        ${r.status === 'REGISTERED' ? `<button data-act="checkin" data-id="${r.id}" data-name="${esc(r.name)}">Check in</button>` : ''}
        <button data-act="resend" data-id="${r.id}" data-name="${esc(r.name)}">Resend pass</button>
        <a href="/t/${esc(r.token)}" target="_blank" rel="noopener">View pass</a>
      </td></tr>`).join('') || '<tr><td colspan="8" class="muted">No visitors match this search.</td></tr>';
    const from = j.total ? page * 25 + 1 : 0;
    $('#count').textContent = `${fmt(from)}–${fmt(Math.min((page + 1) * 25, j.total))} of ${fmt(j.total)}`;
    $('#prev').disabled = page === 0;
    $('#next').disabled = (page + 1) * 25 >= j.total;
  }

  $('#rows').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const { act, id, name } = b.dataset;
    try {
      if (act === 'checkin') {
        if (!(await ask('Check in at the desk?', `${name} will be marked as visited and enter the lucky draw pool.`, { okLabel: 'Check in' }))) return;
        const r = await api(`/api/admin/attendees/${id}/checkin`, { body: {} });
        toast(r.result === 'OK' ? `${name} checked in` : `${name} was already checked in`);
      } else {
        await api(`/api/admin/attendees/${id}/resend`, { body: {} });
        toast(`Pass queued for ${name}`);
      }
      refresh();
    } catch (err) { toast(err.message, true); }
  });

  let qT;
  $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { page = 0; rows(); }, 250); });
  $('#status').addEventListener('change', () => { page = 0; rows(); });
  $('#search').addEventListener('submit', (e) => { e.preventDefault(); page = 0; rows(); });
  $('#prev').addEventListener('click', () => { page = Math.max(0, page - 1); rows(); });
  $('#next').addEventListener('click', () => { page++; rows(); });

  async function rounds() {
    const s = await api('/api/stage/state');
    $('#rounds').innerHTML = s.rounds.map((r) => `<li class="${r.status === 'DONE' ? 'done' : ''}">
      <span class="no">${r.round_no}</span>
      <div>
        <label class="sr-only" for="p${r.round_no}">Prize for round ${r.round_no}</label>
        <input id="p${r.round_no}" value="${esc(r.prize)}" data-round="${r.round_no}" maxlength="80">
        <small>${r.winner ? `Winner: <strong>${esc(r.winner.name)}</strong>, ${esc(r.winner.city)} (${esc(r.winner.ticket_code)}), ${esc(time(r.drawn_at))}` : r.status === 'READY' ? 'Names loaded on the stage screen' : 'Not drawn yet'}</small>
        ${(r.history || []).map((h) => `<small class="hist">Redrawn: ${esc(h.name)} (${esc(h.reason)})</small>`).join('')}
      </div>
      ${r.status === 'DONE' ? `<button data-void="${r.round_no}" data-name="${esc(r.winner?.name)}">Winner absent, redraw</button>` : '<span></span>'}
    </li>`).join('');
  }

  $('#rounds').addEventListener('change', async (e) => {
    const n = e.target.dataset.round;
    if (!n) return;
    try { await api(`/api/admin/rounds/${n}`, { method: 'PUT', body: { prize: e.target.value } }); toast(`Round ${n} prize saved`); } catch (err) { toast(err.message, true); }
  });
  $('#rounds').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-void]');
    if (!b) return;
    const reason = await ask(`Redraw round ${b.dataset.void}?`, `${b.dataset.name} will not get this prize and won't be drawn again. The round goes back to the stage for a fresh draw.`, { input: 'Reason, e.g. not present after 3 calls', okLabel: 'Redraw round' });
    if (reason === null) return;
    try { await api(`/api/admin/rounds/${b.dataset.void}/void`, { body: { reason } }); toast('Round reopened for a redraw'); refresh(); } catch (err) { toast(err.message, true); }
  });
  $('#add-round').addEventListener('click', async () => {
    try { const r = await api('/api/admin/rounds', { body: {} }); toast(`Round ${r.round_no} added`); rounds(); } catch (err) { toast(err.message, true); }
  });
  $('#reset').addEventListener('click', async () => {
    const v = await ask('Reset every draw?', 'All winners are cleared and everyone goes back into the pool. Use this only after a rehearsal. Type RESET to confirm.', { input: 'RESET', okLabel: 'Reset draws' });
    if (v === null) return;
    try { await api('/api/admin/reset-draw', { body: { confirm: v } }); toast('All draws reset'); refresh(); } catch (err) { toast(err.message, true); }
  });

  async function outbox() {
    const j = await api('/api/admin/outbox');
    const c = {};
    j.counts.forEach((x) => { c[x.status] = (c[x.status] || 0) + x.c; });
    $('#wa-counts').textContent = Object.entries(c).map(([k, v]) => `${k === 'MOCK' ? 'demo' : k.toLowerCase()} ${fmt(v)}`).join(', ');
    $('#outbox').innerHTML = j.rows.map((m) => `<li>
      <span><strong>${{ WINNER: 'Winner message', REPLY: 'Registration link' }[m.kind] || 'Entry pass'}</strong> to ${esc(m.name || '')} ${esc(m.to_phone)}</span>
      ${passPill(m.status)}
      <small>${esc(time(m.updated_at))}${m.via ? `, as ${m.via === 'template' ? 'template' : 'chat reply (free)'}` : ''}${m.attempts > 1 ? `, ${m.attempts} attempts` : ''}</small>
      ${m.error ? `<small class="e">${esc(m.error)}</small>` : ''}
      ${m.hint ? `<small class="h">${esc(m.hint)}</small>` : ''}
    </li>`).join('') || '<li class="muted">No messages yet.</li>';
  }

  async function waCheck() {
    const box = $('#wa-status');
    box.innerHTML = '<p class="muted">Contacting Meta…</p>';
    try {
      const c = await api('/api/admin/wa/check');
      const n = c.number || {};
      const modeText = { template: 'Pass sent automatically (template)', reply: 'Pass sent when the visitor messages you (free)', session: 'Plain messages (test only)' }[c.mode];
      box.innerHTML = `<dl>
        <dt>Status</dt><dd>${c.live ? 'Live' : 'Demo mode, not sending'}</dd>
        <dt>Delivery</dt><dd>${esc(modeText)}</dd>
        ${n.display_phone_number ? `<dt>Number</dt><dd>${esc(n.display_phone_number)} (${esc(n.verified_name || '')})</dd>
        <dt>Quality</dt><dd>${esc(n.quality_rating || '–')}${n.name_status ? `, display name ${esc(n.name_status.toLowerCase().replace(/_/g, ' '))}` : ''}</dd>` : ''}
        ${(c.templateStatus || []).map((t) => `<dt>${esc(t.name)}</dt><dd>${esc(t.status)}${t.category ? `, ${esc(t.category.toLowerCase())}` : ''}</dd>`).join('')}
        <dt>Webhook URL</dt><dd>${esc(c.webhookUrl)}${c.webhookSigned ? ' (signature checked)' : ''}</dd>
      </dl>
      ${c.problems.length ? `<ul>${c.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="good">Everything needed for sending is in place.</p>'}`;
    } catch (e) { box.innerHTML = `<ul><li>${esc(e.message)}</li></ul>`; }
  }
  $('#wa-check').addEventListener('click', waCheck);
  $('#wa-retry').addEventListener('click', async () => {
    try { const r = await api('/api/admin/wa/retry-failed', { body: {} }); toast(`${r.requeued} message${r.requeued === 1 ? '' : 's'} queued again`); outbox(); } catch (e) { toast(e.message, true); }
  });
  $('#wipe').addEventListener('click', async () => {
    const v = await ask('Delete all test data?', 'Every registration, check-in, winner and WhatsApp log on this UAT site is deleted. Type DELETE to confirm.', { input: 'DELETE', okLabel: 'Delete everything' });
    if (v === null) return;
    try { await api('/api/admin/wipe', { body: { confirm: v } }); toast('All test data deleted'); refresh(); } catch (e) { toast(e.message, true); }
  });
  fetch('/api/event').then((r) => r.json()).then((e) => { $('#wipe').hidden = e.appEnv === 'production'; }).catch(() => {});

  async function refresh() {
    try { await Promise.all([stats(), rows(), rounds(), outbox()]); } catch (e) { if (e.message !== 'Signed out') toast(e.message, true); }
  }

  $('#logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin', pin: $('#pin').value, label: 'Admin' }) });
    const j = await r.json();
    if (!r.ok) { $('#login-err').textContent = j.error; return; }
    $('#login').hidden = true; $('#pin').value = '';
    refresh();
  });

  const base = location.origin;
  $('#l-reg').textContent = `${base}/`; $('#l-gate').textContent = `${base}/gate`; $('#l-stage').textContent = `${base}/stage`;

  fetch('/api/whoami').then((r) => r.json()).then((w) => { if (w.admin) refresh(); else $('#login').hidden = false; });
  setInterval(() => { if ($('#login').hidden && !document.hidden) { stats().catch(() => {}); outbox().catch(() => {}); } }, 10000);
})();
