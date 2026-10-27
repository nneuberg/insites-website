// Deployment mapping: netlify/functions/referral-qualification-check.mjs.
// Companion fixture/harness map to netlify/lib/referral-qualification-test-*.mjs.
export const WINDOW=Object.freeze({notBefore:1793102400000,expires:1793106000000}); // Set only in approved release.
export const config={schedule:'0 0 1 1 *'};
export function permitted(context,at,window=WINDOW){
 const start=new Date(window.notBefore),end=new Date(window.expires-1);
 return context?.site?.id==='a21b8d9c-9ce0-4114-985d-d77cabae32e9'&&context?.deploy?.context==='production'&&window.notBefore>0&&window.expires>window.notBefore&&window.expires-window.notBefore<=3600000&&at>=window.notBefore&&at<window.expires&&start.getUTCFullYear()===end.getUTCFullYear()&&!(start.getUTCMonth()===0&&start.getUTCDate()===1)&&!(end.getUTCMonth()===0&&end.getUTCDate()===1);
}
export default async(request,context)=>{
 if(!permitted(context,Date.now()))return new Response(null,{status:204});
 // Netlify scheduled-function platform protection must independently reject public
 // HTTP. Do not publish as an ordinary callable function or bypass this check.
 const [{getStore},{ledger},{runSynthetic},{fixture,RUN}]=await Promise.all([import('@netlify/blobs'),import('../lib/referral-transport.mjs'),import('../lib/referral-qualification-test-harness.mjs'),import('../lib/referral-qualification-test-fixture.mjs')]);
 const inputs=fixture(WINDOW.notBefore),store=getStore({name:RUN,consistency:'strong'});
 const result=await runSynthetic({store,ledger:(action,data)=>ledger(action,data,process.env,5000),fixture:inputs});
 console.log(JSON.stringify(result));return new Response(null,{status:204});
};
