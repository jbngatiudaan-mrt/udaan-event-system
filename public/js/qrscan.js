// Camera QR scanner for the gate.
// Uses the browser's built-in BarcodeDetector where it exists (Android Chrome, desktop Chrome/Edge) and
// jsQR everywhere else (iPhone Safari, Firefox). Only the centre square of the picture is decoded, at most
// 720 px wide, ~10 times a second — fast on old phones and gentle on battery.
window.QrScan = (() => {
  let stream = null;
  let video = null;
  let running = false;
  let detector = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function makeDetector() {
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) return new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch {}
    return null;
  }

  async function decode() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const side = Math.floor(Math.min(vw, vh) * 0.85);
    const size = Math.min(side, 720);
    canvas.width = size; canvas.height = size;
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
    if (detector) {
      const codes = await detector.detect(canvas);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    }
    if (window.jsQR) {
      const img = ctx.getImageData(0, 0, size, size);
      const r = window.jsQR(img.data, size, size, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
    return null;
  }

  async function loop(onCode) {
    while (running) {
      const t = performance.now();
      try {
        const text = await decode();
        if (text) onCode(text);
      } catch {}
      const wait = Math.max(0, 100 - (performance.now() - t));
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  return {
    async start(container, onCode) {
      if (running) return;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('NoCamera');
      detector = detector || (await makeDetector());
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video = video || Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
      video.setAttribute('playsinline', ''); // iOS Safari needs the attribute, not just the property
      video.srcObject = stream;
      if (!video.isConnected) container.append(video);
      await video.play();
      running = true;
      loop(onCode);
    },
    stop() {
      running = false;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    },
    get engine() { return detector ? 'native' : 'jsqr'; },
  };
})();
