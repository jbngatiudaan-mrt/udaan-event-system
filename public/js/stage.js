// Stage screen: display only. It follows /api/stage/display, which the organiser desk changes.
(() => {
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#1F4FA3', '#D7262B', '#2E8B3D', '#F4B400', '#E8C877', '#FFFFFF', '#F59A1E'];
  const fire = window.confetti ? confetti.create($('#confetti'), { resize: true, useWorker: true }) : () => {};
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The same header (logo plaque, "Lucky Draw", credits) on every screen, including the black draw table
  document.querySelectorAll('.slot-header').forEach((slot) => slot.replaceWith($('#header-tpl').content.cloneNode(true)));

  // Scale the 1920 x 1080 frame evenly to the screen; re-run on resize and full-screen changes
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    document.documentElement.style.setProperty('--s', s.toFixed(5));
  }
  fit();
  addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  window.visualViewport?.addEventListener('resize', fit);

  // Long names shrink to fit the width instead of spilling off the screen
  function fitName() {
    const el = $('#w-name');
    el.style.fontSize = '';
    const max = 1720;
    let size = 176;
    while (el.scrollWidth > max && size > 72) { size -= 6; el.style.fontSize = `${size}px`; }
  }

  let lastSeq = null;
  let busy = false;      // an animation is playing; newer states wait
  let pending = null;
  let current = 'welcome';

  function show(id) {
    ['welcome', 'roll', 'winner'].forEach((s) => { $(`#${s}`).hidden = s !== id; });
    current = id;
  }

  // ---------- Screens ----------
  function showWelcome() {
    show('welcome');
    if (!reduce && window.gsap && !document.hidden) gsap.fromTo('#welcome .jai, #welcome .ornament', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .9, stagger: .15, ease: 'power3.out' });
  }

  function cellHTML(p) {
    return p ? `<div class="cell" role="gridcell"><span class="n">${esc(p.name)}</span><span class="c">${esc(p.city)}</span></div>` : '<div class="cell" role="gridcell"></div>';
  }

  function drawGrid(grid, size) {
    const cells = grid.slice(0, size);
    while (cells.length < size) cells.push(null);
    const g = $('#grid');
    g.className = 'grid';
    g.innerHTML = cells.map(cellHTML).join('');
  }

  function fillWinner(d) {
    const w = d.winner || {};
    $('#w-name').textContent = w.name || '';
    $('#w-meta').textContent = [w.business && w.business !== 'Demo visitor' ? w.business : '', w.city].filter(Boolean).join(', ');
    $('#w-prize').textContent = d.prize || '';
    $('#w-code').textContent = w.ticket_code ? `Ticket ${w.ticket_code}` : '';
  }

  function showWinner(d, celebrate) {
    fillWinner(d);
    show('winner');
    fitName();
    if (!celebrate) return;
    Sfx.fanfare();
    burst();
    if (!reduce && window.gsap && !document.hidden) {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('#winner .winner-body', { opacity: 0, duration: .4 })
        .from('.w-congrats', { opacity: 0, y: 20, duration: .5 }, '<.1')
        .from('.w-name', { opacity: 0, scale: .7, duration: .9, ease: 'back.out(1.5)' }, '<.15')
        .from('.w-meta, #winner .ornament, .w-prize, .w-code', { opacity: 0, y: 18, duration: .5, stagger: .1 }, '-=.4');
    }
  }

  function burst() {
    if (reduce) { fire({ particleCount: 120, spread: 120, origin: { y: .6 }, colors: COLORS }); return; }
    const end = Date.now() + 3500;
    fire({ particleCount: 160, spread: 100, startVelocity: 55, origin: { y: .5 }, colors: COLORS, scalar: 1.2 });
    (function frame() {
      fire({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: .75 }, colors: COLORS });
      fire({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: .75 }, colors: COLORS });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  /** Roulette cursor, driven by the clock rather than by animation frames.
      The pointer's position is worked out from the time since the spin started, so the draw stays correct
      and finishes on time even if the browser holds the page back (background tab, covered window, slow laptop).
      Every name on the board, the winner included, is swept; the winner's cell is passed over three times at
      readable speed before the pointer lands on it. */
  function spin(winnerIdx, totalMs, startAt) {
    return new Promise((resolve) => {
      const g = $('#grid');
      const cells = [...g.querySelectorAll('.cell')];
      const filled = cells.map((c, i) => (c.childElementCount ? i : -1)).filter((i) => i >= 0);
      if (!cells[winnerIdx] || !filled.length) { resolve(); return; }
      const TOTAL = reduce ? 3000 : totalMs;

      // step lengths: fast at first, slowing down towards the end
      const intervals = [];
      for (let t = 0; t < TOTAL;) { const p = t / TOTAL; const iv = 45 + 640 * p ** 3; intervals.push(iv); t += iv; }
      const steps = intervals.length;
      const at = [0];
      for (let k = 1; k < steps; k++) at.push(at[k - 1] + intervals[k - 1]);
      const end = at[steps - 1];

      // the path: shuffled sweeps over every name, a final approach around the winner, landing on the winner
      const near = (i) => { const r = Math.floor(i / 10), c = i % 10; return filled.filter((j) => Math.abs(Math.floor(j / 10) - r) <= 2 && Math.abs((j % 10) - c) <= 2); };
      const around = near(winnerIdx);
      const bag = [];
      const refill = () => { const x = filled.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } bag.push(...x); };
      const path = [];
      let prev = -1;
      for (let k = 0; k < steps; k++) {
        const left = steps - 1 - k;
        let next;
        if (left === 0) next = winnerIdx;
        else if (left <= 5 && around.length > 1) {
          do { next = around[Math.floor(Math.random() * around.length)]; } while (next === prev);
        } else {
          if (!bag.length) refill();
          next = bag.shift();
          if (next === prev && filled.length > 1) { if (!bag.length) refill(); next = bag.shift(); }
        }
        path.push(next); prev = next;
      }
      if (filled.length > 1 && steps > 12) {
        const put = (i) => {
          i = Math.max(1, Math.min(steps - 2, i));
          while (i < steps - 2 && (path[i - 1] === winnerIdx || path[i + 1] === winnerIdx)) i++;
          if (path[i - 1] !== winnerIdx && path[i + 1] !== winnerIdx) path[i] = winnerIdx;
        };
        const firstSlower = (ms) => { const i = intervals.findIndex((iv) => iv >= ms); return i < 0 ? steps - 6 : i; };
        put(firstSlower(130 + Math.random() * 40));
        put(firstSlower(240 + Math.random() * 60));
        put(steps - 4);
      }

      const t0 = startAt ?? performance.now();
      const remaining = Math.max(0, t0 + end - performance.now());
      const stopRoll = Sfx.drumroll(Math.max(0.5, remaining / 1000));
      let shown = -1;
      let hot = null;
      let done = false;
      let timer = null;

      const land = () => {
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', frame);
        stopRoll();
        g.classList.add('landed');
        if (window.gsap && !reduce && !document.hidden) {
          gsap.timeline()
            .to(hot, { scale: 1.3, duration: .22, ease: 'power3.out' })
            .to(hot, { scale: 1.1, duration: .22, ease: 'power2.inOut', repeat: 3, yoyo: true });
        }
        setTimeout(resolve, 1800); // the reveal never waits on an animation finishing
      };

      function frame() {
        if (done) return;
        const el = performance.now() - t0;
        let k = shown < 0 ? 0 : shown;
        while (k + 1 < steps && at[k + 1] <= el) k++;
        if (k !== shown) {
          const jumped = k - shown > 1;
          if (hot) hot.classList.remove('hot');
          hot = cells[path[k]];
          hot.classList.add('hot');
          if (!jumped && !document.hidden) {
            Sfx.tick(k / steps);
            if (window.gsap && !reduce) gsap.fromTo(hot, { scale: 1.14 }, { scale: 1, duration: Math.min(intervals[k] / 1000, .35), ease: 'power2.out', overwrite: true, clearProps: 'transform' });
          }
          shown = k;
        }
        if (k === steps - 1) { land(); return; }
        timer = setTimeout(frame, Math.max(10, Math.min(at[k + 1] - el, 100)));
      }
      document.addEventListener('visibilitychange', frame);
      frame();
    });
  }

  // ---------- Following the organiser desk ----------
  async function apply(d, firstLoad) {
    if (d.mode === 'draw' && d.grid) {
      // A new draw always plays the board. If this screen heard about it late (slow network), the spin is shortened
      // so the winner still appears at about the same moment. Only a page reload long after the draw skips straight to the winner.
      const late = Math.max(0, d.elapsed_ms || 0);
      if (late < (firstLoad ? 8000 : 14000)) {
        busy = true;
        try {
          // names are drawn at once (no fade-in), so they show even if the browser is holding animations back
          drawGrid(d.grid, d.gridSize || 100);
          show('roll');
          // the spin is timed from when the organiser clicked Roll, so a screen that heard late simply joins in
          const drawStart = performance.now() - late;
          const lead = reduce ? 200 : 1300;
          const wait = drawStart + lead - performance.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          await spin(d.winner_index, 10500, drawStart + lead);
          showWinner(d, true);
        } catch (err) {
          console.error(err);
          showWinner(d, false); // never leave the stage stuck on the grid
        } finally {
          busy = false;
        }
      } else {
        showWinner(d, false);
      }
    } else {
      showWelcome();
    }
  }

  async function poll() {
    try {
      const r = await fetch('/api/stage/display', { cache: 'no-store' });
      if (r.status === 401) { showLogin(); return; }
      const d = await r.json();
      $('#net').hidden = true;
      if (d.seq !== lastSeq) {
        const first = lastSeq === null;
        lastSeq = d.seq;
        if (busy) pending = d; else await apply(d, first);
      } else if (!busy && pending) {
        const p = pending; pending = null; await apply(p, false);
      }
    } catch {
      $('#net').hidden = false;
    }
  }

  let timer = null;
  function startPolling() {
    if (timer) return;
    poll();
    timer = setInterval(() => { if (!busy) poll(); }, 1000);
    // the moment the stage page is on screen again, check the desk straight away
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) poll(); });
  }

  // ---------- Full screen and sound ----------
  const fs = () => document.documentElement.requestFullscreen?.().catch(() => {});
  function toggleFs() { if (document.fullscreenElement) document.exitFullscreen(); else fs(); }
  addEventListener('keydown', (e) => {
    if (e.target.matches('input')) return;
    if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'm' || e.key === 'M') Sfx.setMuted(!Sfx.muted);
  });
  addEventListener('dblclick', toggleFs);

  // Browsers allow full screen and sound only after a click, so the first click opens both.
  function showStart() {
    const v = $('#start');
    v.hidden = false;
    v.addEventListener('click', () => { Sfx.unlock(); fs(); v.hidden = true; }, { once: true });
  }

  // ---------- Sign-in ----------
  function showLogin() {
    clearInterval(timer); timer = null;
    $('#login').hidden = false; $('#pin').focus();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    Sfx.unlock(); fs(); // this click counts as the gesture
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'stage', pin: $('#pin').value, label: 'Stage' }) });
    const j = await r.json();
    if (!r.ok) { $('#login-err').textContent = j.error; return; }
    $('#login').hidden = true; $('#pin').value = '';
    startPolling();
  });

  showWelcome();
  fetch('/api/whoami').then((r) => r.json()).then((w) => {
    if (w.stage || w.admin) { showStart(); startPolling(); } else showLogin();
  }).catch(showLogin);
})();
