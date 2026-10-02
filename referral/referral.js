(() => {
  'use strict';
  const form = document.getElementById('referral-form');
  if (!form) return;
  const button = document.getElementById('submit-referral');
  const status = document.getElementById('form-status');
  const friendEmail = form.elements.friendEmail;
  const referrerEmail = form.elements.referrerEmail;
  const normalizeEmail = (value) => value.trim().toLowerCase();
  const validateEmails = () => {
    friendEmail.setCustomValidity(normalizeEmail(friendEmail.value) && normalizeEmail(friendEmail.value) === normalizeEmail(referrerEmail.value)
      ? 'Please enter your friend’s email. Self-referrals are not eligible.' : '');
  };
  friendEmail.addEventListener('input', validateEmails);
  referrerEmail.addEventListener('input', validateEmails);
  for (const name of ['referrerName', 'friendName']) {
    const input = form.elements[name];
    input.addEventListener('input', () => input.setCustomValidity(input.value.trim() ? '' : 'Please enter a full name.'));
  }
  let submitting = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    validateEmails();
    if (!form.reportValidity()) return;
    submitting = true;
    button.disabled = true;
    button.textContent = 'Sending your referral…';
    status.dataset.error = 'false';
    status.textContent = '';
    if (!form.elements.referralId.value) form.elements.referralId.value = crypto.randomUUID();
    const data = new FormData(form);
    for (const name of ['referrerEmail', 'friendEmail']) data.set(name, normalizeEmail(data.get(name)));
    for (const name of ['referrerName', 'friendName']) data.set(name, data.get(name).trim());
    try {
      const response = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('Unable to save referral');
      form.hidden = true;
      document.getElementById('referral-reference').textContent = 'Submission reference: ' + form.elements.referralId.value;
      const success = document.getElementById('referral-success');
      success.hidden = false;
      success.focus();
    } catch {
      status.dataset.error = 'true';
      status.textContent = 'We couldn’t confirm your submission. Your details are still here—please try again, or contact Neal at 330-990-9700 for help.';
      button.disabled = false;
      button.textContent = 'Try again →';
      submitting = false;
    }
  });
})();
