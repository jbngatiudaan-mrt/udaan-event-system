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
    if (!reduce && window.gsap) gsap.fromTo('#welcome .jai, #welcome .ornament', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .9, stagger: .15, ease: 'power3.out' });
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
    if (!reduce && window.gsap) {
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

  /** Roulette cursor: fast at first, slowing down, landing on the winner.
      Every name, the winner included, gets visited along the way, so the pointer never "jumps" to a name it skipped. */
  function spin(winnerIdx, totalMs) {
    return new Promise((resolve) => {
      const g = $('#grid');
      const cells = [...g.querySelectorAll('.cell')];
      const filled = cells.map((c, i) => (c.childElementCount ? i : -1)).filter((i) => i >= 0);
      if (!cells[winnerIdx]) { resolve(); return; }
      const TOTAL = reduce ? 3000 : totalMs;
      const intervals = [];
      for (let t = 0; t < TOTAL;) { const p = t / TOTAL; const iv = 45 + 640 * p ** 3; intervals.push(iv); t += iv; }
      const steps = intervals.length;
      const near = (i) => { const r = Math.floor(i / 10), c = i % 10; return filled.filter((j) => Math.abs(Math.floor(j / 10) - r) <= 2 && Math.abs((j % 10) - c) <= 2); };
      const around = near(winnerIdx);
      // shuffled passes over all names (winner included), so coverage is even and random
      const bag = [];
      const refill = () => { const a = filled.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } bag.push(...a); };
      const path = [];
      let prev = -1;
      for (let k = 0; k < steps; k++) {
        const left = steps - 1 - k;
        let next;
        if (left === 0) next = winnerIdx;
        else if (left <= 5 && around.length > 1) {
          // final approach: hover around the winner's neighbourhood (may pass over the winner too)
          do { next = around[Math.floor(Math.random() * around.length)]; } while (next === prev && around.length > 1);
        } else {
          if (!bag.length) refill();
          next = bag.shift();
          if (next === prev && filled.length > 1) { if (!bag.length) refill(); next = bag.shift(); }
        }
        path.push(next); prev = next;
      }
      // The winner is a visible part of the game: the pointer always passes over the winner's cell
      // early on, again in the slower middle part, and once more just before it stops.
      if (filled.length > 1 && steps > 12) {
        const put = (i) => {
          i = Math.max(1, Math.min(steps - 2, i));
          while (i < steps - 2 && (path[i - 1] === winnerIdx || path[i + 1] === winnerIdx)) i++;
          if (path[i - 1] !== winnerIdx && path[i + 1] !== winnerIdx) path[i] = winnerIdx;
        };
        // choose the moments by speed, so each pass rests long enough to be seen clearly on a big screen
        const firstSlower = (ms) => { const i = intervals.findIndex((iv) => iv >= ms); return i < 0 ? steps - 6 : i; };
        put(firstSlower(130 + Math.random() * 40));
        put(firstSlower(240 + Math.random() * 60));
        put(steps - 4);
      }
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
          g.classList.add('landed');
          if (window.gsap && !reduce) {
            gsap.timeline({ onComplete: () => setTimeout(resolve, 900) })
              .to(hot, { scale: 1.3, duration: .22, ease: 'power3.out' })
              .to(hot, { scale: 1.1, duration: .22, ease: 'power2.inOut', repeat: 3, yoyo: true });
          } else setTimeout(resolve, 1200);
          return;
        }
        setTimeout(step, intervals[k++]);
      };
      step();
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
          drawGrid(d.grid, d.gridSize || 100);
          show('roll');
          if (!reduce && window.gsap) gsap.from('#grid .cell', { opacity: 0, duration: .5, stagger: { grid: [10, 10], from: 'center', amount: .6 }, clearProps: 'opacity' });
          await new Promise((r) => setTimeout(r, reduce ? 200 : 1300));
          await spin(d.winner_index, Math.max(4000, 10500 - Math.min(late, 6500)));
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
