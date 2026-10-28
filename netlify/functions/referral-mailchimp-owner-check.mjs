// Proposed mapping netlify/functions/referral-mailchimp-owner-check.mjs.
// Companion test-support modules map to netlify/lib/ with unchanged basenames.
export const WINDOW=Object.freeze({notBefore:1793202300000,expires:1793205900000}); // Choose only after operator readiness.
export const VERIFIED=Object.freeze({exactFilterVerified:true,singleEmailVerified:true,inertTemplateVerified:true,trackingReviewed:true,reentryReviewed:true});
export const config={schedule:'0 0 1 1 *'};
export function permitted(context,at,window=WINDOW){
 const start=new Date(window.notBefore),end=new Date(window.expires-1);
 return context?.site?.id==='a21b8d9c-9ce0-4114-985d-d77cabae32e9'&&context?.deploy?.context==='production'&&Number.isSafeInteger(window.notBefore)&&Number.isSafeInteger(window.expires)&&window.notBefore>0&&window.expires>window.notBefore&&window.expires-window.notBefore<=3600000&&at>=window.notBefore&&at<window.expires&&start.getUTCFullYear()===end.getUTCFullYear()&&!(start.getUTCMonth()===0&&start.getUTCDate()===1)&&!(end.getUTCMonth()===0&&end.getUTCDate()===1);
}
export default async(request,context)=>{
 if(!permitted(context,Date.now())||Object.values(VERIFIED).some(x=>x!==true))return new Response(null,{status:204});
 const env={MAILCHIMP_API_KEY:Netlify.env.get('MAILCHIMP_API_KEY'),MAILCHIMP_REFERRAL_AUDIENCE_ID:Netlify.env.get('MAILCHIMP_REFERRAL_AUDIENCE_ID'),REFERRAL_MAILCHIMP_ENABLED:Netlify.env.get('REFERRAL_MAILCHIMP_ENABLED')};
 if(env.MAILCHIMP_REFERRAL_AUDIENCE_ID!=='8f8749ba24'||env.REFERRAL_MAILCHIMP_ENABLED!=='false'){console.log(JSON.stringify({state:'configuration-blocked',sent:false}));return new Response(null,{status:204});}
 try{
  const [{getStore},{runOwnerPair,RUN,readProductionWallet},{ownerTransport,TARGET}]=await Promise.all([import('@netlify/blobs'),import('../lib/mailchimp-owner-9531-runner.mjs'),import('../lib/mailchimp-owner-9531.mjs')]);
  const store=getStore({name:RUN,consistency:'strong'});
  const result=await runOwnerPair({store,transport:ownerTransport({env}),configuration:{...TARGET,...VERIFIED,start:WINDOW.notBefore,end:WINDOW.expires}});
  // Separate read-only funding readiness; only after the first bounded batch,
  // never on repeated dashboard calls, no secret returned or raw error logged.
  const wallet=result.state==='observations-required'?await readProductionWallet({key:Netlify.env.get('TREMENDOUS_API_KEY')}):{verified:false,reason:'batch-not-completed'};
  console.log(JSON.stringify({...result,wallet}));
 }catch{console.log(JSON.stringify({state:'held-inspect-checkpoint',retry:false}));}
 return new Response(null,{status:204});
};
