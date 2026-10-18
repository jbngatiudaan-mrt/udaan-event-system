// Fills every .credits block: "Powered by DAILY LOOM by Tushar Jain" (linked to WhatsApp when the number is set) and "Co-powered by JBN Gati".
(() => {
  const html = '<span class="credit">Powered by <a class="credit-link" target="_blank" rel="noopener"><strong>DAILY LOOM</strong> by Tushar Jain</a></span>'
    + '<span class="credit-sep" aria-hidden="true">·</span><span class="credit">Co-powered by <strong>JBN Gati</strong></span>';
  const blocks = document.querySelectorAll('.credits');
  blocks.forEach((b) => { b.innerHTML = html; });
  fetch('/api/event').then((r) => r.json()).then((e) => {
    document.querySelectorAll('.credit-link').forEach((a) => {
      if (e.poweredByWhatsapp) {
        a.href = `https://wa.me/${e.poweredByWhatsapp}?text=${encodeURIComponent('Hi Tushar, I saw DAILY LOOM on the Udaan B2C Trade Fair site.')}`;
        a.setAttribute('aria-label', 'DAILY LOOM by Tushar Jain on WhatsApp');
      } else {
        a.removeAttribute('href');
      }
    });
  }).catch(() => {});
})();
