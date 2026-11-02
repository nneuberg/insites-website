import {MARKETING_ADMISSION} from '../lib/marketing-admission-config.mjs';
import {signMarketingRun} from '../lib/marketing-run-auth.mjs';
export default async(_request,context)=>{
 if(MARKETING_ADMISSION.orchestration!=='netlify-waiter'||context?.deploy?.context!=='production'||MARKETING_ADMISSION.enabled!==true||MARKETING_ADMISSION.allMarketingWritersCovered!==true)return Response.json({off:true});
 const timestamp=String(Date.now()),body='{}',signature=signMarketingRun(process.env.REFERRAL_LEDGER_SECRET,timestamp);
 const response=await fetch('https://www.insites.services/.netlify/functions/marketing-admission-background',{method:'POST',headers:{'Content-Type':'application/json','x-marketing-time':timestamp,'x-marketing-signature':signature},body,signal:AbortSignal.timeout(12000)});
 return Response.json({accepted:response.status===202}, {status:response.status===202?200:503});
};
export const config={schedule:'7,22,37,52 * * * *'};
