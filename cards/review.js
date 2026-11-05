'use strict';
(()=>{
 let credential='',session=0;const endpoint='/.netlify/functions/cards-approval-owner';
 const $=id=>document.getElementById(id),status=$('status');
 function say(text,error=false){status.textContent=text;status.className=error?'error':'';}
 async function call(body){
  const started=session;
  const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error'});
  const data=await result.json();if(started!==session)throw Error('Session locked.');if(!result.ok)throw Error(data.status==='configuration_required'?'Secure setup is not complete yet.':data.status==='unauthorized'?'This approval credential was not accepted.':data.status==='disabled'?'Ordering is not enabled yet.':data.status==='provider_spend_guard_required'?'Ordering is not ready yet. No order was placed.':'This card is held for a fresh verification. Refresh before trying again.');return data;
 }
 const element=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 function action(label,handler){const button=element('button',label);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await handler(button);}catch(e){say(e.message,true);}finally{button.disabled=false;}});return button;}
 function render(job){
  const card=element('article','');card.className='card';
  card.append(element('p',job.status.replaceAll('_',' ')));card.firstChild.className='badge';
  const r=job.recipient;card.append(element('h2',[r.firstName,r.lastName].filter(Boolean).join(' ')));
  card.append(element('address',[r.company,r.address,r.address2,[r.city,r.region,r.postcode].filter(Boolean).join(', '),r.country].filter(Boolean).join('\n')));
  const note=document.createElement('textarea');note.value=job.text;note.maxLength=1000;note.setAttribute('aria-label','Personal note');note.disabled=!['AWAITING_APPROVAL','APPROVED','MANUAL_REVIEW'].includes(job.status);card.append(note);
  const actions=element('div','');actions.className='row';card.append(actions);
  if(!note.disabled)actions.append(action('Approve this wording',async()=>{
   const proof=await call({action:'prepare',jobId:job.id,revision:job.revision,text:note.value});
   await call({action:'review',jobId:job.id,revision:job.revision,text:note.value,reviewedFingerprint:proof.reviewedFingerprint,approve:true});say('Wording approved. Review the proof and prepaid-credit cost before ordering.');await refresh();
  }));
  if(job.status==='APPROVED')actions.append(action('Review proof and cost',async button=>{
   if(note.value!==job.text)throw Error('Approve your edited wording first.');
   const quote=await call({action:'quote',jobId:job.id,revision:job.revision});
   const box=element('div','');box.className='proof';box.append(element('p','Cardly: one printed thank-you card, mailed directly to the business address above.\nCost: '+quote.credits+' prepaid Cardly credit(s). No new card payment or automatic top-up.\nStandard postage. Cardly generally does not allow cancellation after acceptance; lost or unreceived business cards are not automatically replaced.'));
   const preview=element('a','Open card proof');preview.href=quote.preview;preview.target='_blank';preview.rel='noreferrer noopener';box.append(preview);
   const terms=element('a','Cardly terms');terms.href='https://www.cardly.net/terms-conditions';terms.target='_blank';terms.rel='noreferrer noopener';box.append(element('p',''),terms);
   box.append(element('p','Check the proof, wording, address and cost before confirming. By ordering, you accept Cardly’s linked terms.'));
   box.append(action('Confirm and order this card',async send=>{
    if(note.value!==job.text){box.remove();throw Error('Your note changed. Approve the new wording and check a fresh proof first.');}
    send.disabled=true;const outcome=await call({action:'send',jobId:job.id,revision:job.revision,quoteFingerprint:quote.quoteFingerprint,confirmPurchase:true});
    if(outcome.status==='ORDERED'||outcome.status==='SENT'){say(outcome.status==='SENT'?'Cardly confirms this card has shipped.':'Cardly confirmed the order. Mailing is not yet confirmed.');await refresh();}
    else {say('The order outcome needs reconciliation. Do not order this card again.',true);await refresh();}
   }));card.querySelector('.proof')?.remove();card.append(box);button.disabled=true;
  }));
  if(['SUBMITTING','UNKNOWN','ORDERED'].includes(job.status))actions.append(action('Check provider status',async()=>{const result=await call({action:'reconcile',jobId:job.id});say(result.status==='SENT'?'Cardly confirms shipment.':result.status==='ORDERED'?'The order is confirmed. Shipment is still pending.':'Provider status is not yet settled. No repeat order was placed.');await refresh();}));
  return card;
 }
 async function refresh(){const data=await call({action:'queue'});$('cards').replaceChildren(...data.jobs.map(render));if(!data.jobs.length)$('cards').append(element('p','No verified cards are ready for review yet.'));$('workspace').hidden=false;}
 $('access').addEventListener('submit',async e=>{e.preventDefault();const started=++session;credential=$('token').value;$('token').value='';try{await refresh();if(started!==session)return;$('access').hidden=true;say('Ready. Each card stays here until you approve its wording and order.');}catch(error){if(started!==session)return;credential='';say(error.message,true);}});
 $('refresh').addEventListener('click',()=>refresh().catch(e=>say(e.message,true)));
 const lock=()=>{session++;credential='';$('token').value='';$('cards').replaceChildren();$('workspace').hidden=true;$('access').hidden=false;say('Locked.');};
 $('lock').addEventListener('click',lock);
 // Browsers may retain a page in the back/forward cache. Clear both the access
 // credential and customer DOM before navigation, not just on an explicit lock.
 globalThis.addEventListener?.('pagehide',lock);
})();
