(() => {
  'use strict';
  const form = document.getElementById('referral-form');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const button = $('submit-referral'), status = $('form-status'), dialog = $('text-dialog');
  let submitting = false, submittedFingerprint = '';
  const normalize = value => value.trim().toLowerCase();
  const choices = [...document.querySelectorAll('[data-channel]')];
  choices.forEach(choice => choice.addEventListener('click', () => {
    if (submitting) return;
    form.elements.channel.value = choice.dataset.channel;
    choices.forEach(b => b.setAttribute('aria-pressed', String(b === choice)));
    const isEmail = choice.dataset.channel === 'email';
    $('channel-fields').hidden = false;
    $('friend-fields').hidden = !isEmail;
    $('friend-fields').disabled = !isEmail;
    $('text-help').hidden = isEmail;
    $('permission-copy').textContent = isEmail ? 'I have my friend’s permission to share their details and receive this one-time referral email from InSites, and I agree to the' : 'I’ll share only with people I know, and I agree to the';
    button.textContent = isEmail ? 'Email my friend →' : 'Get my text message →';
  }));
  function validate() {
    form.elements.friendEmail.setCustomValidity(form.elements.channel.value === 'email' && normalize(form.elements.friendEmail.value) === normalize(form.elements.referrerEmail.value) ? 'Self-referrals are not eligible. Please enter your friend’s email.' : '');
    for (const name of ['referrerName','friendName']) form.elements[name].setCustomValidity(form.elements[name].value.trim() ? '' : 'Please enter a full name.');
  }
  form.addEventListener('input', validate);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !form.elements.channel.value) return;
    validate(); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    for (const key of ['referrerEmail','friendEmail']) if (data[key]) data[key] = normalize(data[key]);
    for (const key of ['referrerName','friendName']) if (data[key]) data[key] = data[key].trim();
    delete data.referralId;
    const fingerprint = JSON.stringify(data);
    if (fingerprint !== submittedFingerprint) form.elements.referralId.value = crypto.randomUUID();
    submittedFingerprint = fingerprint;
    data.referralId = form.elements.referralId.value;
    submitting = true; button.disabled = true; choices.forEach(b => b.disabled = true);
    const label = button.textContent; button.textContent = 'Preparing your referral…'; status.textContent = '';
    try {
      const response = await fetch('/api/referral-share', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data), signal:AbortSignal.timeout(30000)});
      const result = await response.json();
      if (!response.ok || !result.ok || !/^INS25[A-Z2-9]{7}$/.test(result.code || '')) throw Error(result.error || 'We couldn’t prepare your referral. Please try again or contact Neal.');
      form.hidden = true; $('referral-success').hidden = false;
      $('referral-reference').textContent = 'Your referral code: ' + result.code;
      if (data.channel === 'text') {
        $('success-title').textContent = 'Your message is ready.';
        $('success-copy').textContent = 'Share your code with friends. Each qualifying new client can earn you a $25 Amazon gift card after their full inspection is completed and paid.';
        const message = `Hey! I got a home inspection recently from Neal with InSites and they were great! They’re doing a referral program where friends can get $25 off a full home inspection with this code: ${result.code}. Book at https://www.insites.services and enter the code when scheduling. I can also get a $25 gift card after your inspection is completed and paid.`;
        $('text-message').value = message; $('open-sms').href = 'sms:?&body=' + encodeURIComponent(message); dialog.showModal();
      } else {
        $('success-title').textContent = 'Your introduction is on its way.';
        $('success-copy').textContent = 'We’ve sent your friend an email with your unique code and $25 off a full home inspection. Keep sharing—this same code connects each qualifying inspection to you.';
        $('referral-success').focus();
      }
    } catch (error) { status.dataset.error = 'true'; status.textContent = error.name === 'TimeoutError' ? 'This is taking longer than expected. Please try again; we’ll check your previous request before sending another email.' : error.message; }
    finally {submitting = false; button.disabled = false; choices.forEach(b => b.disabled = false); button.textContent = label;}
  });
  $('copy-text').addEventListener('click', async () => {try {await navigator.clipboard.writeText($('text-message').value); $('copy-status').textContent = 'Copied. Paste it into a text to your friend.';} catch {$('text-message').focus(); $('text-message').select(); $('copy-status').textContent = 'Select and copy the message above.';}});
  $('close-text').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => $('referral-success').focus());
  $('share-again').addEventListener('click', () => {form.hidden = false; $('referral-success').hidden = true; form.elements.friendName.value = ''; form.elements.friendEmail.value = ''; form.elements.permissionAndTerms.checked = false; form.elements.referralId.value = ''; submittedFingerprint = ''; choices[0].focus();});
})();
