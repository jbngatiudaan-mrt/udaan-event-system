(() => {
  const token = location.pathname.split('/').pop();
  const card = document.getElementById('card');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  let rendered = false;

  async function load() {
    try {
      const r = await fetch(`/api/ticket/${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) {
        card.innerHTML = `<div class="notfound"><h1>Pass not found</h1><p class="lede">${esc(j.error)}</p><a class="btn" href="/">Register for a pass</a></div>`;
        return;
      }
      const a = j.attendee;
      const status = a.won_prize
        ? `<p class="status s-win">Lucky draw winner, round ${esc(a.won_round)}</p>`
        : a.status === 'CHECKED_IN'
          ? `<p class="status s-in">Checked in at ${esc(time(a.checked_in_at))}</p>`
          : `<p class="status s-wait">Not checked in yet</p>`;
      if (!rendered) {
        card.innerHTML = `<div id="st">${status}</div>
          <h1>${esc(a.name)}</h1>
          <p class="lede">Ticket <strong>${esc(a.ticket_code)}</strong>. Show this QR at the gate, with screen brightness up.</p>
          <div class="pass-frame"><img src="/pass/${encodeURIComponent(token)}.png" alt="Entry pass QR for ${esc(a.name)}"></div>
          <div class="done-actions"><a class="btn" href="/pass/${encodeURIComponent(token)}.png?download=1">Save pass to phone</a></div>
          <a class="wa-link" id="wa-again" target="_blank" rel="noopener" hidden>Send this pass to my WhatsApp</a>`;
        fetch('/api/event').then((r) => r.json()).then((e) => {
          if (!e.whatsappLive || !e.waBusinessNumber) return;
          const l = document.getElementById('wa-again');
          l.href = `https://wa.me/${e.waBusinessNumber}?text=${encodeURIComponent(`Hi, please send my Udaan entry pass (${a.ticket_code})`)}`;
          l.hidden = false;
        }).catch(() => {});
        rendered = true;
      } else {
        document.getElementById('st').innerHTML = status;
      }
    } catch {
      if (!rendered) card.innerHTML = '<p class="lede">No internet connection. Your WhatsApp message also has the QR — show that at the gate.</p>';
    }
  }
  load();
  setInterval(load, 30000);
})();
