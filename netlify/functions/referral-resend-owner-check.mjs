export const WINDOW={start:1793215500000,end:1793219100000};
export const config={schedule:'0 0 1 1 *'};
export default async(request,context)=>{
 const now=Date.now(),date=new Date(now);
 if(context?.site?.id!=='a21b8d9c-9ce0-4114-985d-d77cabae32e9'||context?.deploy?.context!=='production'||!WINDOW.start||WINDOW.end-WINDOW.start>3600000||now<WINDOW.start||now>=WINDOW.end||(date.getUTCMonth()===0&&date.getUTCDate()===1))return new Response(null,{status:204});
 const key=Netlify.env.get('RESEND_REWARDS_API_KEY'),encryption=Netlify.env.get('REFERRAL_CLAIM_ENCRYPTION_KEY'),webhook=Netlify.env.get('RESEND_REWARDS_WEBHOOK_SECRET');
 if(!key||!encryption||!webhook){console.log(JSON.stringify({state:'configuration-missing',attempts:0}));return new Response(null,{status:204});}
 try{
  const [{getStore},{claimVault},{invitationDelivery},{ownerResendTest}]=await Promise.all([import('@netlify/blobs'),import('../lib/claim-vault.mjs'),import('../lib/referral-invitations.mjs'),import('../lib/referral-resend-owner-test.mjs')]);
  const report=await ownerResendTest({store:getStore({name:'insites-referral-claims',consistency:'strong'}),vault:claimVault(encryption),send:invitationDelivery({key,enabled:true,timeoutMs:5000})});
  console.log(JSON.stringify(report));
 }catch{console.log(JSON.stringify({state:'uncertain-stop-no-retry'}));}
 return new Response(null,{status:204});
};
