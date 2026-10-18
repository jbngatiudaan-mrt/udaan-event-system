// Shows a ribbon on every page outside production, so nobody mistakes the UAT site for the live one.
(() => {
  fetch('/api/event').then((r) => r.json()).then((e) => {
    if (!e.appEnv || e.appEnv === 'production') return;
    const b = document.createElement('div');
    b.className = 'env-ribbon';
    b.textContent = e.appEnv === 'uat' ? 'UAT test site: not the live event' : 'Local demo';
    b.title = `Environment: ${e.appEnv}. WhatsApp: ${e.whatsappLive ? e.waMode : 'demo (not sending)'}`;
    document.body.append(b);
  }).catch(() => {});
})();
