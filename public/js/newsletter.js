'use strict';
// Footer newsletter signup, shared by the store, blog and information pages
document.addEventListener('submit', async e => {
  const form = e.target.closest('.newsletter-form');
  if (!form) return;
  e.preventDefault();
  const msg = form.querySelector('.newsletter-msg');
  const btn = form.querySelector('button');
  const data = Object.fromEntries(new FormData(form));
  data.source = location.pathname;
  btn.disabled = true;
  msg.className = 'newsletter-msg';
  msg.textContent = 'Signing you up…';
  try {
    const res = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
    form.reset();
    msg.classList.add('ok');
    msg.textContent = '💌 Thank you! You\'re on the list.';
  } catch (err) {
    msg.classList.add('err');
    msg.textContent = err.message === 'Failed to fetch' ? 'Could not connect. Please check your internet and try again.' : err.message;
  } finally {
    btn.disabled = false;
  }
});
