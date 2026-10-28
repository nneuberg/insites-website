// Prepared, not deployed. Zero window cannot run until exact deployment authorization.
export const WINDOW={start:Date.parse('2026-10-28T18:35:00Z'),end:Date.parse('2026-10-28T19:35:00Z')};
export const config={schedule:'0 0 1 1 *'};
export default async(request,context)=>{
 const now=Date.now(),date=new Date(now);
 if(context?.site?.id!=='a21b8d9c-9ce0-4114-985d-d77cabae32e9'||context?.deploy?.context!=='production'||!WINDOW.start||WINDOW.end-WINDOW.start>3600000||now<WINDOW.start||now>=WINDOW.end||(date.getUTCMonth()===0&&date.getUTCDate()===1))return new Response(null,{status:204});
 try{
  const [{getStore},{mailchimpEvidenceReader},{summarizeOwnerEvidence}]=await Promise.all([import('@netlify/blobs'),import('../lib/mailchimp-serial-evidence.mjs'),import('../lib/mailchimp-owner-evidence.mjs')]);
  const store=getStore({name:'mailchimp-owner-evidence-9531',consistency:'strong'});
  const lock=await store.setJSON('readonly-audit-v1',{startedAt:now},{onlyIfNew:true});if(!lock.modified){console.log(JSON.stringify({state:'already-attempted-no-retry'}));return new Response(null,{status:204});}
  const snapshot=await mailchimpEvidenceReader({env:{MAILCHIMP_API_KEY:Netlify.env.get('MAILCHIMP_API_KEY'),MAILCHIMP_REFERRAL_AUDIENCE_ID:Netlify.env.get('MAILCHIMP_REFERRAL_AUDIENCE_ID')}})('neal@insites.services');
  const summary=summarizeOwnerEvidence(snapshot);await store.setJSON('sanitized-result-v1',summary,{onlyIfNew:true});console.log(JSON.stringify(summary));
 }catch{console.log(JSON.stringify({state:'read-unavailable',eventsSubmitted:0,emailsSent:0}));}
 return new Response(null,{status:204});
};
