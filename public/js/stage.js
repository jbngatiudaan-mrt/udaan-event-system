(() => {
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#1F4FA3', '#D7262B', '#2E8B3D', '#F4B400', '#E8C877', '#FFFFFF', '#F59A1E'];
  const fire = window.confetti ? confetti.create($('#confetti'), { resize: true, useWorker: true }) : () => {};

  let state = { rounds: [], eligible: 0, current: null };
  let sel = 1;          // selected round number
  let grid = [];        // people on the board (null for empty cells)
  let rolling = false;

  // ---------- API ----------
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('Signed out'); }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 5000);
  }

  const round = (n) => state.rounds.find((r) => r.round_no === n);

  async function load(keepSel) {
    state = await api('/api/stage/state');
    if (!keepSel) {
      sel = state.current?.round_no || (state.rounds.find((r) => r.status !== 'DONE') || state.rounds[state.rounds.length - 1])?.round_no || 1;
    }
    if (state.current && state.current.round_no === sel) grid = state.current.grid;
    render();
  }

  // ---------- Render ----------
  function render() {
    const r = round(sel);
    const total = state.rounds.length;
    $('#round-title').textContent = r ? `Round ${r.round_no} of ${total}: ${r.prize}` : '';
    $('#pips').innerHTML = state.rounds.map((x) => `<li class="${x.status === 'DONE' ? 'done' : ''} ${x.round_no === sel ? 'now' : ''}" title="${x.prize.replace(/"/g, '')}">${x.round_no}</li>`).join('');
    $('#round-sel').innerHTML = state.rounds.map((x) => `<option value="${x.round_no}" ${x.round_no === sel ? 'selected' : ''}>Round ${x.round_no}${x.status === 'DONE' ? ' (drawn)' : ''}</option>`).join('');
    $('#eligible').textContent = state.eligible.toLocaleString('en-IN');

    const ready = r?.status === 'READY' && grid.length;
    const done = r?.status === 'DONE';
    $('#idle').hidden = Boolean(ready || (done && grid.length));
    $('#grid').hidden = !$('#idle').hidden;
    $('#b-roll').disabled = !ready || rolling;
    $('#b-load').hidden = done;
    $('#b-load').textContent = ready ? 'Board loaded' : 'Load 100 names';
    $('#b-load').disabled = ready || rolling;
    $('#b-shuffle').hidden = !ready;
    $('#b-next').hidden = !done || sel >= total;
    $('#b-roll').hidden = done;
  }

  function cellHTML(p) {
    if (!p) return '<div class="cell empty" role="gridcell"></div>';
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<div class="cell" role="gridcell"><span class="n">${esc(p.name)}</span><span class="c">${esc(p.city || p.ticket_code)}</span></div>`;
  }

  function drawGrid(animate) {
    const g = $('#grid');
    const cells = [...grid];
    while (cells.length < 100) cells.push(null);
    g.className = 'grid';
    g.innerHTML = cells.map(cellHTML).join('');
    if (animate && !reduce && window.gsap) {
      gsap.from('#grid .cell', { opacity: 0, scale: .6, rotateX: -70, duration: .55, ease: 'back.out(1.6)', stagger: { grid: [10, 10], from: 'center', amount: .9 }, clearProps: 'opacity,transform' });
      Sfx.shimmer();
    }
  }

  // ---------- Actions ----------
  async function prepare(reshuffle) {
    if (rolling) return;
    Sfx.unlock();
    try {
      const j = await api(`/api/stage/rounds/${sel}/prepare`, { reshuffle: Boolean(reshuffle) });
      grid = j.grid;
      await load(true);
      drawGrid(true);
    } catch (e) { toast(e.message); }
  }

  async function roll() {
    if (rolling || $('#b-roll').disabled) return;
    Sfx.unlock();
    rolling = true; render();
    $('#controls').classList.add('quiet');
    let res;
    try {
      res = await api(`/api/stage/rounds/${sel}/roll`, {});
    } catch (e) { rolling = false; render(); toast(e.message); return; }
    if (res.replay) { rolling = false; await load(true); showWinner(round(sel), false); return; }
    await spin(res.winner_index);
    await load(true);
    rolling = false; render();
    showWinner(round(sel), true);
  }

  /** Roulette cursor: fast at first, slowing over ~10.5 s, closing in on the winner's neighbourhood at the end. */
  function spin(winnerIdx) {
    return new Promise((resolve) => {
      const cells = [...document.querySelectorAll('#grid .cell')];
      const filled = cells.map((c, i) => (c.classList.contains('empty') ? -1 : i)).filter((i) => i >= 0);
      const g = $('#grid');
      if (window.gsap) { gsap.killTweensOf(cells); gsap.set(cells, { clearProps: 'opacity,transform' }); } // end any entrance tween first
      g.classList.add('rolling');
      const TOTAL = reduce ? 3000 : 10500;
      const intervals = [];
      for (let t = 0; t < TOTAL;) { const p = t / TOTAL; const iv = 45 + 640 * p ** 3; intervals.push(iv); t += iv; }
      const near = (i) => { const r = Math.floor(i / 10), c = i % 10; return filled.filter((j) => j !== i && Math.abs(Math.floor(j / 10) - r) <= 2 && Math.abs((j % 10) - c) <= 2); };
      const around = near(winnerIdx);
      const path = [];
      let prev = -1;
      intervals.forEach((_, k) => {
        const left = intervals.length - 1 - k;
        let pool = left <= 4 && left > 0 && around.length ? around : filled;
        let next;
        do { next = pool[Math.floor(Math.random() * pool.length)]; } while ((next === prev || (left > 0 && next === winnerIdx)) && pool.length > 2);
        if (left === 0) next = winnerIdx;
        path.push(next); prev = next;
      });
      const stopRoll = Sfx.drumroll(TOTAL / 1000);
      let k = 0;
      let hot = null;
      const step = () => {
        if (hot) hot.classList.remove('hot');
        hot = cells[path[k]];
        hot.classList.add('hot');
        Sfx.tick(k / path.length);
        if (window.gsap && !reduce) gsap.fromTo(hot, { scale: 1.14 }, { scale: 1, duration: Math.min(intervals[k] / 1000, .35), ease: 'power2.out', overwrite: true, clearProps: 'transform' });
        if (k === path.length - 1) {
          stopRoll();
          g.classList.remove('rolling');
          g.classList.add('landed');
          if (window.gsap && !reduce) {
            gsap.timeline({ onComplete: () => setTimeout(resolve, 700) })
              .to(hot, { scale: 1.32, duration: .22, ease: 'power3.out' })
              .to(hot, { scale: 1.12, duration: .22, ease: 'power2.inOut', repeat: 3, yoyo: true });
          } else setTimeout(resolve, 800);
          return;
        }
        setTimeout(step, intervals[k++]);
      };
      step();
    });
  }

  function showWinner(r, celebrate) {
    if (!r?.winner) return;
    const w = r.winner;
    $('#w-round').textContent = `Round ${r.round_no} winner`;
    $('#w-name').textContent = w.name;
    $('#w-meta').textContent = [w.business, w.city].filter(Boolean).join(', ');
    $('#w-prize').textContent = r.prize;
    $('#w-code').textContent = `Ticket ${w.ticket_code}`;
    const el = $('#winner');
    el.hidden = false;
    if (!celebrate) return;
    Sfx.fanfare();
    burst();
    if (window.gsap && !reduce) {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from(el, { opacity: 0, duration: .3 })
        .from('.winner-card', { scale: .55, y: 60, rotate: -3, duration: .8, ease: 'back.out(1.5)' }, '<')
        .from('#w-round, #w-name, #w-meta, #w-prize, .winner .jito-rule, #w-code', { opacity: 0, y: 20, duration: .5, stagger: .09 }, '-=.45');
    }
  }

  function burst() {
    if (reduce) { fire({ particleCount: 120, spread: 120, origin: { y: .6 }, colors: COLORS }); return; }
    const end = Date.now() + 3500;
    fire({ particleCount: 160, spread: 100, startVelocity: 55, origin: { y: .55 }, colors: COLORS, scalar: 1.2 });
    (function frame() {
      fire({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: .75 }, colors: COLORS });
      fire({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: .75 }, colors: COLORS });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  function hideOverlays() { $('#winner').hidden = true; $('#final').hidden = true; }

  function nextRound() {
    hideOverlays();
    const n = state.rounds.find((r) => r.round_no > sel && r.status !== 'DONE') || state.rounds.find((r) => r.status !== 'DONE');
    if (!n) { showFinal(); return; }
    sel = n.round_no; grid = n.status === 'READY' && state.current?.round_no === sel ? state.current.grid : [];
    $('#grid').innerHTML = '';
    render();
  }

  function showFinal() {
    const done = state.rounds.filter((r) => r.status === 'DONE' && r.winner);
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    $('#final-list').innerHTML = done.length
      ? done.map((r) => `<li><b>${r.round_no}</b><div><strong>${esc(r.winner.name)}</strong><span>${esc(r.winner.city)}  ${esc(r.winner.ticket_code)}</span></div><em>${esc(r.prize)}</em></li>`).join('')
      : '<li><div><strong>No winners drawn yet</strong></div></li>';
    $('#winner').hidden = true;
    $('#final').hidden = false;
    if (window.gsap && !reduce) gsap.from('#final li', { opacity: 0, x: -40, duration: .5, stagger: .12, ease: 'power3.out' });
  }

  // ---------- Wiring ----------
  $('#b-load').addEventListener('click', () => prepare(false));
  $('#b-shuffle').addEventListener('click', () => prepare(true));
  $('#b-roll').addEventListener('click', roll);
  $('#b-next').addEventListener('click', nextRound);
  $('#b-final').addEventListener('click', () => ($('#final').hidden ? showFinal() : hideOverlays()));
  $('#winner').addEventListener('click', () => { $('#winner').hidden = true; });
  $('#final').addEventListener('click', hideOverlays);
  $('#round-sel').addEventListener('change', (e) => {
    sel = Number(e.target.value); hideOverlays();
    const r = round(sel);
    grid = r.status === 'READY' && state.current?.round_no === sel ? state.current.grid : [];
    if (r.status === 'DONE') load(true).then(() => { drawWinnerGrid(r); showWinner(round(sel), false); });
    else { if (grid.length) drawGrid(false); render(); }
  });
  function drawWinnerGrid() { $('#grid').innerHTML = ''; grid = []; render(); }
  $('#b-mute').addEventListener('click', () => {
    Sfx.setMuted(!Sfx.muted);
    $('#b-mute').textContent = Sfx.muted ? 'Sound off' : 'Sound on';
    $('#b-mute').setAttribute('aria-pressed', String(Sfx.muted));
  });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  $('#b-full').addEventListener('click', fullscreen);

  addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || !$('#login').hidden) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (!$('#winner').hidden) nextRound();
      else roll();
    } else if (e.key === 'l' || e.key === 'L') prepare(false);
    else if (e.key === 'f' || e.key === 'F') fullscreen();
    else if (e.key === 'h' || e.key === 'H') $('#controls').classList.toggle('quiet');
    else if (e.key === 'w' || e.key === 'W') ($('#final').hidden ? showFinal() : hideOverlays());
    else if (e.key === 'Escape') hideOverlays();
  });

  // Controls fade out on the projector after a few idle seconds; any mouse movement brings them back.
  let idleT;
  addEventListener('mousemove', () => {
    $('#controls').classList.remove('quiet');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (!$('#grid').hidden) $('#controls').classList.add('quiet'); }, 4000);
  });

  setInterval(async () => {
    if (rolling || !$('#login').hidden || $('#idle').hidden) return;
    try { const s = await api('/api/stage/state'); state.eligible = s.eligible; $('#eligible').textContent = s.eligible.toLocaleString('en-IN'); } catch {}
  }, 10000);

  // ---------- Login ----------
  function showLogin() { $('#login').hidden = false; $('#pin').focus(); }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'stage', pin: $('#pin').value, label: 'Stage' }) });
    const j = await r.json();
    if (!r.ok) { $('#login-err').textContent = j.error; return; }
    $('#login').hidden = true; $('#pin').value = '';
    start();
  });

  async function start() {
    try {
      await load(false);
      if (grid.length) drawGrid(false);
      const r = round(sel);
      if (r?.status === 'DONE') showWinner(r, false);
    } catch (e) { if (e.message !== 'Signed out') toast(e.message); }
  }

  fetch('/api/whoami').then((r) => r.json()).then((w) => (w.stage || w.admin ? start() : showLogin()));
})();
