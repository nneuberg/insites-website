// Proposed mapping netlify/functions/referral-mailchimp-owner-check.mjs.
// Companion test-support modules map to netlify/lib/ with unchanged basenames.
export const WINDOW=Object.freeze({notBefore:Date.parse("2026-10-28T18:00:00Z"),expires:Date.parse("2026-10-28T19:00:00Z")}); // Choose only after operator readiness.
export const VERIFIED=Object.freeze({exactFilterVerified:true,singleEmailVerified:true,inertTemplateVerified:true,trackingReviewed:true,reentryReviewed:true});
export const config={schedule:'0 0 1 1 *'};
export function permitted(context,at,window=WINDOW){
 const start=new Date(window.notBefore),end=new Date(window.expires-1);
 return context?.site?.id==='a21b8d9c-9ce0-4114-985d-d77cabae32e9'&&context?.deploy?.context==='production'&&Number.isSafeInteger(window.notBefore)&&Number.isSafeInteger(window.expires)&&window.notBefore>0&&window.expires>window.notBefore&&window.expires-window.notBefore<=3600000&&at>=window.notBefore&&at<window.expires&&start.getUTCFullYear()===end.getUTCFullYear()&&!(start.getUTCMonth()===0&&start.getUTCDate()===1)&&!(end.getUTCMonth()===0&&end.getUTCDate()===1);
}
const EVIDENCE=Object.freeze({flow:'9531',owner:'neal@insites.services',reference:'Operator report?id=9531 fresh read 2026-10-28T17:54:56.172Z; paused, zero in progress, completed one, sent one',observedAt:Date.parse('2026-10-28T17:54:56.172Z'),inProgress:0,completed:1,start:WINDOW.notBefore,end:WINDOW.expires});
export default async(request,context)=>{
 if(!permitted(context,Date.now())||Object.values(VERIFIED).some(x=>x!==true))return new Response(null,{status:204});
 const env={MAILCHIMP_API_KEY:Netlify.env.get('MAILCHIMP_API_KEY'),MAILCHIMP_REFERRAL_AUDIENCE_ID:Netlify.env.get('MAILCHIMP_REFERRAL_AUDIENCE_ID'),REFERRAL_MAILCHIMP_ENABLED:Netlify.env.get('REFERRAL_MAILCHIMP_ENABLED')};
 if(env.MAILCHIMP_REFERRAL_AUDIENCE_ID!=='8f8749ba24'||env.REFERRAL_MAILCHIMP_ENABLED!=='false'){console.log(JSON.stringify({state:'configuration-blocked',sent:false}));return new Response(null,{status:204});}
 try{
  const [{getStore},{runOwnerThird,RUN},{ownerTransport}]=await Promise.all([import('@netlify/blobs'),import('../lib/mailchimp-owner-9531-runner.mjs'),import('../lib/mailchimp-owner-9531.mjs')]);
  const result=await runOwnerThird({store:getStore({name:RUN,consistency:'strong'}),transport:ownerTransport({env}),evidence:EVIDENCE});
  console.log(JSON.stringify(result));
 }catch{console.log(JSON.stringify({state:'third-held-inspect-checkpoint',retry:false}));}
 return new Response(null,{status:204});
};
