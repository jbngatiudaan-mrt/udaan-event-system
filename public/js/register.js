(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#reg');
  const btn = $('#go');
  const phone = $('#phone');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ev = { whatsappLive: true, waMode: 'template', waBusinessNumber: null };
  fetch('/api/event').then((r) => r.json()).then((e) => { ev = e; }).catch(() => {});
  const waChat = (a) => `https://wa.me/${ev.waBusinessNumber}?text=${encodeURIComponent(`Hi, please send my Udaan entry pass (${a.ticket_code})`)}`;

  // City dropdown: North India, grouped by state; "My city is not listed" opens a text box.
  const citySel = $('#city-select');
  const cityOther = $('#city-other');
  const OTHER = '__other__';
  (window.UDAAN_CITIES || []).forEach(([group, cities]) => {
    const og = document.createElement('optgroup');
    og.label = group;
    cities.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; og.append(o); });
    citySel.append(og);
  });
  const other = document.createElement('option');
  other.value = OTHER; other.textContent = 'My city is not listed';
  citySel.append(other);
  citySel.addEventListener('change', () => {
    const isOther = citySel.value === OTHER;
    cityOther.hidden = !isOther;
    cityOther.required = isOther;
    if (isOther) cityOther.focus();
  });
  // Clear a field's error as soon as it is changed.
  const clearFieldError = (e) => {
    const f = e.target.closest('.field');
    if (f?.hasAttribute('data-error')) { f.removeAttribute('data-error'); const er = f.querySelector('.err'); if (er) er.textContent = ''; }
  };
  form.addEventListener('input', clearFieldError);
  form.addEventListener('change', clearFieldError);
  const chosenCity = () => (citySel.value === OTHER ? cityOther.value.trim() : citySel.value);

  // Typing a leading + switches to international mode (hides the +91 prefix).
  phone.addEventListener('input', () => {
    phone.closest('.phone-wrap').classList.toggle('intl', phone.value.trim().startsWith('+'));
  });

  function setErrors(fields = {}) {
    document.querySelectorAll('.field').forEach((f) => {
      const k = f.dataset.f;
      const msg = fields[k] || '';
      f.toggleAttribute('data-error', Boolean(msg));
      const e = f.querySelector('.err');
      if (e) e.textContent = msg;
      f.querySelectorAll('input:not([hidden]), select').forEach((el) => el.setAttribute('aria-invalid', msg ? 'true' : 'false'));
    });
  }

  function localCheck(d) {
    const f = {};
    if (d.name.trim().length < 2) f.name = 'Enter your full name.';
    const digits = d.phone.replace(/\D/g, '');
    if (d.phone.trim().startsWith('+') ? digits.length < 8 : !/^0?[6-9]\d{9}$/.test(digits) && !/^91[6-9]\d{9}$/.test(digits)) {
      f.phone = 'Enter a valid 10-digit WhatsApp number.';
    }
    if (!d.email.trim()) f.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) f.email = 'This email address looks incomplete.';
    if (!citySel.value) f.city = 'Select your city.';
    else if (!d.city.trim()) f.city = 'Type the name of your city.';
    return f;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#form-err').textContent = '';
    const d = Object.fromEntries(new FormData(form).entries());
    d.city = chosenCity();
    delete d.city_select; delete d.city_other;
    const f = localCheck(d);
    setErrors(f);
    if (Object.keys(f).length) {
      const first = form.querySelector('[data-error] select, [data-error] input:not([hidden])');
      first?.focus();
      if (!reduce && window.gsap) gsap.fromTo(first, { x: -6 }, { x: 0, duration: .4, ease: 'elastic.out(1, .3)' });
      return;
    }
    btn.disabled = true; btn.classList.add('busy');
    try {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrors(j.fields || {});
        $('#form-err').textContent = j.error || 'Registration did not go through. Check your connection and try again.';
        return;
      }
      try { localStorage.setItem('udaan_pass', JSON.stringify({ token: j.attendee.token, name: j.attendee.name })); } catch {}
      showDone(j.attendee, j.existing);
    } catch {
      $('#form-err').textContent = 'No internet connection. Check your signal and tap the button again.';
    } finally {
      btn.disabled = false; btn.classList.remove('busy');
    }
  });

  function showDone(a, existing) {
    const first = a.name.split(' ')[0];
    $('#done-title').textContent = existing ? `Welcome back, ${first}` : `You're in, ${first}!`;
    const waLive = ev.whatsappLive;
    const replyMode = waLive && ev.waMode === 'reply' && ev.waBusinessNumber;
    $('#done-text').textContent = replyMode
      ? `${existing ? `This WhatsApp number is already registered (ticket ${a.ticket_code}). ` : ''}Tap the green button and press send in WhatsApp. Your pass with the QR code arrives in that chat within a few seconds.`
      : existing
        ? `This WhatsApp number is already registered, so here is the same pass (ticket ${a.ticket_code}).${waLive ? ` We've sent it to ${a.phone} again.` : ''}`
        : waLive
          ? `Your pass is on its way to WhatsApp ${a.phone}. Show the QR at the gate on 21 October.`
          : 'WhatsApp sending is switched off in this demo, so save the pass below or share it to WhatsApp yourself.';
    const getBtn = $('#wa-get');
    const note = $('#wa-note');
    getBtn.hidden = !replyMode;
    note.hidden = !(waLive && ev.waBusinessNumber);
    if (ev.waBusinessNumber) {
      getBtn.href = waChat(a);
      note.innerHTML = replyMode
        ? 'Use the WhatsApp number you registered with. The message is already typed for you.'
        : 'No message after a minute? <a class="wa-link" target="_blank" rel="noopener">Message us on WhatsApp</a> and we\'ll send it again.';
      note.querySelector('a')?.setAttribute('href', waChat(a));
    }
    $('#share').hidden = waLive;
    const img = $('#pass-img');
    img.src = `/pass/${a.token}.png`;
    $('#dl').href = `/pass/${a.token}.png?download=1`;
    $('#open').href = `/t/${a.token}`;
    const link = `${location.origin}/t/${a.token}`;
    $('#share').href = `https://wa.me/?text=${encodeURIComponent(`My entry pass for Udaan B2C Trade Fair (ticket ${a.ticket_code}): ${link}`)}`;

    const done = $('#done');
    if (reduce || !window.gsap) { form.hidden = true; done.hidden = false; $('#done-title').focus?.(); return; }
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.to(form, { opacity: 0, y: -12, duration: .25, ease: 'power2.in' })
      .add(() => { form.hidden = true; done.hidden = false; })
      .from('#done-title, #done-text', { opacity: 0, y: 10, duration: .4, stagger: .06 })
      .from('.pass-frame', { opacity: 0, y: 60, rotate: -4, scale: .92, duration: .7, ease: 'back.out(1.4)' }, '<.1')
      .from('#wa-get:not([hidden]), .done-actions > *, #again', { opacity: 0, y: 8, duration: .35, stagger: .05 }, '-=.3');
    $('#card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#again').addEventListener('click', () => {
    form.reset(); setErrors();
    cityOther.hidden = true; cityOther.required = false;
    $('#done').hidden = true; form.hidden = false;
    if (window.gsap) gsap.set(form, { clearProps: 'all' });
    $('#name').focus();
  });

  // Returning visitor on the same phone: offer their pass without re-registering.
  try {
    const saved = JSON.parse(localStorage.getItem('udaan_pass') || 'null');
    if (saved?.token) {
      const p = document.createElement('p');
      p.className = 'lede';
      p.innerHTML = `Registered already as <strong></strong>? <a href="/t/${encodeURIComponent(saved.token)}">Open your pass</a>`;
      p.querySelector('strong').textContent = saved.name;
      form.querySelector('.lede').after(p);
    }
  } catch {}
})();
