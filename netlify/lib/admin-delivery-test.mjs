export const STARTS_AT = 1792550821585;
export const EXPIRES_AT = 1792553521585;
export const STORE = 'insites-admin-review-delivery-20261021';
export const SUBJECT = 'TEST ONLY — admin review-match delivery — 2026-10-21';
export async function run({store,env,transport=fetch,now=Date.now}) {
 const t=now();
 if(t<STARTS_AT||t>=EXPIRES_AT||env.REVIEW_ENABLED==='true'||!env.RESEND_API_KEY)throw Error('Test unavailable');
 const held=await store.setJSON('one-send-attempt',{attemptedAt:t},{onlyIfNew:true});
 if(!held.modified)throw Error('Already attempted; reconcile delivery before any further action');
 // Existing review-match sender and HTML layout; synthetic content, no active match link.
 const html='<h2>TEST ONLY — synthetic Google review</h2><p><strong>TEST ONLY</strong> · FIVE · October 21, 2026</p><blockquote>Synthetic delivery verification; not a public Google review.</blockquote><p>Possible contacts are shown below. A similar name or date does not prove a match.</p><p><strong>TEST ONLY Review Agent</strong> (Agent)<br>123 Test Street (test only)<br>Feedback: 4 stars · synthetic test<br>Delivery verification only — no match action is enabled.</p>';
 const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'insites-admin-review-delivery-20261021-once'},body:JSON.stringify({from:'InSites Reviews <neal@insites.services>',to:['neal@insites.services'],subject:SUBJECT,html}),redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok){await store.setJSON('result',{accepted:false,status:response.status});throw Error('Provider status '+response.status+'; do not resend');}
 const result=await response.json();
 await store.setJSON('result',{accepted:true,id:result.id||null,at:now()});
 return {accepted:true,id:result.id||null,recipient:'neal@insites.services'};
}
