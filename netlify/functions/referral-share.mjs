import {ledger,json} from '../lib/referral-transport.mjs';
import {validateShare,sendReferralEmail} from '../lib/referral-sharing.mjs';
export function createShareHandler({callLedger=ledger,sendEmail=sendReferralEmail,env=process.env}={}) {return async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!['https://www.insites.services','https://insites.services',env.REFERRAL_PREVIEW_ORIGIN].filter(Boolean).includes(request.headers.get('origin')))return json({error:'Forbidden'},403);
 const raw=await request.text();if(raw.length>4096)return json({error:'Request too large'},413);
 let input;try{const parsed=JSON.parse(raw);if(parsed.company)return json({error:'Unable to process this request.'},400);input=validateShare(parsed);}catch(error){return json({error:error.message || 'Check your form details.'},400);}
 if(env.REFERRAL_CODES_ENABLED!=='true')return json({error:'We’re preparing our new referral program. Please contact Neal at 330-990-9700 for help.'},503);
 try {
  const prepared=await callLedger('prepareShare',input,env);
  if(!prepared.code)return json({error:'We need to confirm your past-client details before sharing a code. Contact Neal at 330-990-9700.'},409);
  if(input.channel==='email' && prepared.status!=='EMAIL SENT') {
   if(!prepared.canSend)return json({error:'Your earlier email request is being checked. Please contact Neal before trying a new request.'},409);
   const emailId=await sendEmail({...input,referrerName:prepared.referrerName},prepared.code,env);
   await callLedger('shareEmailSent',{shareId:input.shareId,requestHash:input.requestHash,emailId},env);
  }
  return json({ok:true,code:prepared.code},200);
 }catch{return json({error:'We couldn’t confirm your referral. Please retry with these same details, or contact Neal at 330-990-9700.'},503);}
};}
export default createShareHandler();
export const config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
