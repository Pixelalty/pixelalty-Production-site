import { configured, rpc } from './api.js';
export function bindSubmission(form, kind, buildPayload) {
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('[type=submit]');
  let inFlight = false;
  let started = new Date().toISOString();
  let requestId = crypto.randomUUID();
  const cooldownKey = 'pixelalty-submit-' + kind;
  const show = (message, type = '') => { status.textContent = message; status.className = 'form-status ' + type; };
  if (!configured()) {
    submit.disabled = true;
    show(kind === 'contact' ? 'The inquiry form is not connected yet. Please contact @pixelalty on Instagram using the link on this page.' : 'The review form is not connected yet. Please try again later or contact @pixelalty on Instagram.');
    return;
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (inFlight || !form.reportValidity()) return;
    let last = 0;
    try { last = Number(sessionStorage.getItem(cooldownKey)) || 0; } catch { /* Server cooldown still applies. */ }
    if (Date.now() - last < 60000) { show('Please wait one minute before sending another submission.', 'error'); return; }
    if (Date.now() - Date.parse(started) < 3000) { show('Please take a moment to check your details, then submit again.', 'error'); return; }
    const data = Object.fromEntries(new FormData(form));
    const payload = buildPayload(data);
    payload.request_id = requestId;
    payload.started_at = started;
    payload.website = data.website || '';
    inFlight = true; submit.disabled = true; form.setAttribute('aria-busy', 'true');
    show('Sending securely…');
    try {
      await rpc(kind === 'review' ? 'submit_review' : 'submit_contact', { payload });
      show(kind === 'review' ? 'Thank you. Your review has been submitted and is awaiting moderation.' : 'Thanks. Pixelalty has received your inquiry.', 'success');
      form.reset(); form.dispatchEvent(new Event('reset-done'));
      try { sessionStorage.setItem(cooldownKey, String(Date.now())); } catch { /* Optional local cooldown. */ }
      requestId = crypto.randomUUID(); started = new Date().toISOString();
    } catch (error) {
      const msg = error.message === 'RATE_LIMIT' ? 'Please wait before submitting again. If you have already sent several messages today, contact @pixelalty on Instagram.' : error.message === 'INVALID_SUBMISSION' ? 'Please check the required fields and length limits, then try again.' : 'We could not confirm your submission. Please retry; the same request will not be saved twice. You can also contact @pixelalty on Instagram.';
      show(msg, 'error');
    } finally { inFlight = false; submit.disabled = false; form.removeAttribute('aria-busy'); }
  });
}
