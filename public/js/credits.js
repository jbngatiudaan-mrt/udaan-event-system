// Fills every .credits block: "Powered by Daily Loom, www.dailyloom.in (By Tushar Jain)" and "Co-powered by JBN Gati".
(() => {
  const html = '<span class="credit"><span class="nw">Powered by <strong>Daily Loom</strong>,</span> '
    + '<span class="nw"><a class="credit-link" href="https://www.dailyloom.in" target="_blank" rel="noopener">www.dailyloom.in</a> (By Tushar Jain)</span></span>'
    + '<span class="credit-sep" aria-hidden="true">·</span><span class="credit">Co-powered by <strong>JBN Gati</strong></span>';
  document.querySelectorAll('.credits').forEach((b) => { b.innerHTML = html; });
})();
