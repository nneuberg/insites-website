(() => {
 'use strict';
 const form=document.getElementById('referral-form');if(!form)return;
 const $=id=>document.getElementById(id),button=$('submit-referral'),status=$('form-status'),dialog=$('text-dialog');
 let submitting=false,fingerprint='';
 const validate=()=>form.elements.referrerName.setCustomValidity(form.elements.referrerName.value.trim()?'':'Please enter your name.');
 form.addEventListener('input',validate);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(submitting)return;validate();if(!form.reportValidity())return;
  const data=Object.fromEntries(new FormData(form));data.referrerName=data.referrerName.trim();data.referrerEmail=data.referrerEmail.trim().toLowerCase();delete data.referralId;
  const next=JSON.stringify(data);if(next!==fingerprint)form.elements.referralId.value=crypto.randomUUID();fingerprint=next;data.referralId=form.elements.referralId.value;
  submitting=true;button.disabled=true;button.textContent='Getting your code…';status.textContent='';
  try{
   const response=await fetch('/api/referral-share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});const result=await response.json();
   if(!response.ok||!result.ok||!/^INS25[A-Z2-9]{7}$/.test(result.code||''))throw Error(result.error||'We couldn’t retrieve your code. Please try again.');
   const message=`Hey! I got a home inspection recently from Neal with InSites and they were great! They’re doing a referral program where friends can get $25 off a full home inspection with this code: ${result.code}. Book at https://www.insites.services and enter the code when scheduling. I can also get a $25 gift card after your inspection is completed and paid.`;
   $('text-message').value=message;
   const body=encodeURIComponent(message),apple=/iPad|iPhone|iPod/.test(navigator.userAgent);
   $('open-sms').href=`sms:${apple?'&':'?'}body=${body}`;
   $('open-email').href=`mailto:?subject=${encodeURIComponent('$25 off a home inspection with InSites')}&body=${body}`;
   $('success-title').textContent='Your code is ready.';$('success-copy').textContent='This code stays linked to you. Return with the same email to retrieve it and share with more friends.';$('referral-reference').textContent='Your referral code: '+result.code;
   form.hidden=true;$('referral-success').hidden=false;dialog.showModal();
  }catch(error){status.dataset.error='true';status.textContent=error.name==='TimeoutError'?'This is taking longer than expected. Try again with the same details to retrieve your code.':error.message;}
  finally{submitting=false;button.disabled=false;button.textContent='Generate code →';}
 });
 $('copy-text').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('text-message').value);$('copy-status').textContent='Copied. Paste it into your message.';}catch{$('text-message').focus();$('text-message').select();$('copy-status').textContent='Select and copy the message above.';}});
 $('close-text').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>$('referral-success').focus());$('share-again').addEventListener('click',()=>dialog.showModal());
})();
