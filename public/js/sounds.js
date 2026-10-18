// All sounds are synthesised with Web Audio — no audio files to load, nothing to license, works offline.
window.Sfx = (() => {
  let ctx, master, muted = false;
  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const now = () => ac().currentTime;

  function tone({ freq = 440, type = 'sine', t = now(), dur = 0.2, vol = 0.3, attack = 0.005, release, slideTo, dest }) {
    if (muted) return;
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (release ?? dur));
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + (release ?? dur) + 0.05);
  }

  let noiseBuf;
  function noise({ t = now(), dur = 0.08, vol = 0.3, filter = 1800, q = 0.8, type = 'bandpass' }) {
    if (muted) return;
    const c = ac();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = filter; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  return {
    unlock: () => ac(),
    setMuted: (m) => { muted = m; },
    get muted() { return muted; },

    // Gate: bright two-note chime
    ding() {
      const t = now();
      tone({ freq: 1318.5, type: 'triangle', t, dur: 0.5, vol: 0.5 });
      tone({ freq: 1975.5, type: 'triangle', t: t + 0.09, dur: 0.7, vol: 0.45 });
      tone({ freq: 2637, type: 'sine', t: t + 0.09, dur: 0.5, vol: 0.12 });
    },
    // Gate: unmistakable low double buzz
    buzz() {
      const t = now();
      [0, 0.22].forEach((d) => tone({ freq: 160, type: 'square', t: t + d, dur: 0.18, vol: 0.35, release: 0.18 }));
      [0, 0.22].forEach((d) => tone({ freq: 166, type: 'sawtooth', t: t + d, dur: 0.18, vol: 0.2, release: 0.18 }));
    },
    // Draw: one cursor step — a short wooden "tock", pitch rises as it slows
    tick(intensity = 0) {
      const t = now();
      tone({ freq: 1400 + intensity * 500, type: 'square', t, dur: 0.035, vol: 0.18, release: 0.05 });
      noise({ t, dur: 0.03, vol: 0.2, filter: 3500, q: 2 });
    },
    // Draw: snare roll that swells for `seconds`
    drumroll(seconds = 10) {
      if (muted) return () => {};
      const t0 = now();
      let stopped = false;
      const n = Math.floor(seconds * 22);
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const t = t0 + i / 22 + (Math.random() - 0.5) * 0.008;
        noise({ t, dur: 0.06, vol: 0.05 + p * 0.22, filter: 2400 + p * 900, q: 0.6 });
        if (i % 2 === 0) tone({ freq: 190, type: 'triangle', t, dur: 0.05, vol: 0.04 + p * 0.08 });
      }
      // Timpani swell underneath
      tone({ freq: 73.4, type: 'sine', t: t0, dur: seconds, vol: 0.18, attack: seconds * 0.9, release: seconds });
      return () => {
        if (stopped) return; stopped = true;
        // Can't cancel scheduled nodes cheaply; duck the master briefly instead.
        const g = master.gain; const t = now();
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + 0.05); g.linearRampToValueAtTime(0.9, t + 0.12);
      };
    },
    // Draw: cymbal crash + brass fanfare (C major, ta-ta-ta-taaa)
    fanfare() {
      const t = now() + 0.13;
      noise({ t, dur: 1.8, vol: 0.35, filter: 7000, q: 0.3, type: 'highpass' });
      tone({ freq: 65.4, type: 'sine', t, dur: 0.8, vol: 0.5 });
      const brass = (f, s, d, v = 0.16) => {
        tone({ freq: f, type: 'sawtooth', t: t + s, dur: d, vol: v, attack: 0.03 });
        tone({ freq: f * 1.005, type: 'sawtooth', t: t + s, dur: d, vol: v * 0.7, attack: 0.03 });
        tone({ freq: f / 2, type: 'square', t: t + s, dur: d, vol: v * 0.4, attack: 0.03 });
      };
      const G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
      brass(G4, 0.0, 0.14); brass(G4, 0.16, 0.14); brass(G4, 0.32, 0.14);
      brass(C5, 0.48, 0.45); brass(E5, 0.48, 0.45, 0.1);
      brass(G4, 0.95, 0.16); brass(C5, 1.13, 0.16);
      [C5, E5, G5, C6].forEach((f) => brass(f, 1.32, 1.4, 0.11));
      noise({ t: t + 1.32, dur: 2.2, vol: 0.25, filter: 8000, q: 0.3, type: 'highpass' });
    },
    // Draw: soft shimmer when a new grid loads
    shimmer() {
      const t = now();
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ freq: f, type: 'sine', t: t + i * 0.05, dur: 0.6, vol: 0.08 }));
    },
  };
})();
