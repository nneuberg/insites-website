import {createHmac} from 'node:crypto';
// Staged only. Set an approved <=1-hour UTC window immediately before deployment.
export const WINDOW=Object.freeze({notBefore:1793063700000,expires:1793067300000});
export const config={schedule:'0 0 1 1 *'}; // January 1, 00:00 UTC; outside test window.
const SITE='a21b8d9c-9ce0-4114-985d-d77cabae32e9';
const DEPLOYMENT='AKfycbyPCklq_Xmb_cDVz-BrqHvJ5CzKyrYLKZnqU2lDfPUp5OLMF18sr8vV5wvqi3lL2w';
export async function check({context,window=WINDOW,now=Date.now(),env,fetcher=fetch}){
 const out={diagnostic:'ledger-capabilities-v1',checked:false};
 if(context?.site?.id!==SITE||context?.deploy?.context!=='production')return {...out,reason:'context-blocked'};
 if(!Number.isFinite(window.notBefore)||!Number.isFinite(window.expires)||window.notBefore<=0||window.expires-window.notBefore>3600000||window.expires<=window.notBefore||now<window.notBefore||now>=window.expires)return {...out,reason:'window-closed'};
 // Never allow an automatic January 1 cron occurrence to perform the check.
 const start=new Date(window.notBefore),end=new Date(window.expires-1);
 if(start.getUTCFullYear()!==end.getUTCFullYear()||(start.getUTCMonth()===0&&start.getUTCDate()===1)||(end.getUTCMonth()===0&&end.getUTCDate()===1))return {...out,reason:'window-blocked'};
 try{
  const url=env('REFERRAL_LEDGER_URL'),secret=env('REFERRAL_LEDGER_SECRET');
  if(url!==`https://script.google.com/macros/s/${DEPLOYMENT}/exec`||typeof secret!=='string'||!secret)return {...out,reason:'configuration-unavailable'};
  const payload=JSON.stringify({action:'claimCapabilities',data:{}}),timestamp=String(now);
  const signature=createHmac('sha256',secret).update(`${timestamp}.${payload}`).digest('hex');
  // One request only; Apps Script's normal content-service redirect is handled by fetch.
  const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,payload,signature}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)return {...out,reason:'http-failure',httpStatus:response.status};
  const body=await response.json();
  if(body?.ok!==true)return {...out,reason:'ledger-rejected'};
  const d=body.data;
  return {...out,checked:true,contractMatches:d?.contract==='referral-claims-v1',reservationMatches:d?.reservationAcknowledgement==='reserved:true',customerLockMatches:d?.customerReservation==='canonical-client-under-script-lock',schemaReady:d?.schemaReady===true};
 }catch{return {...out,reason:'request-failed'};}
}
export default async function handler(_request,context){
 const result=await check({context,env:name=>Netlify.env.get(name)});
 console.log(JSON.stringify(result)); // Allowlisted output only; never exceptions or response bodies.
}
