import {MARKETING_ADMISSION} from '../lib/marketing-admission-config.mjs';
import {verifyMarketingRun} from '../lib/marketing-run-auth.mjs';
export default async(request,context)=>{
 if(MARKETING_ADMISSION.orchestration!=='netlify-waiter'||context?.deploy?.context!=='production'||MARKETING_ADMISSION.enabled!==true||MARKETING_ADMISSION.allMarketingWritersCovered!==true||MARKETING_ADMISSION.cutover?.verified!==true||!Number.isSafeInteger(MARKETING_ADMISSION.cutover.at)||MARKETING_ADMISSION.cutover.at<=0||MARKETING_ADMISSION.cutover.at>Date.now())return Response.json({off:true});
 if(request.method!=='POST'||!verifyMarketingRun(request,await request.text(),process.env.REFERRAL_LEDGER_SECRET))return new Response(null,{status:401});
 const deadline=Date.now()+MARKETING_ADMISSION.workMs;
 const [{getStore},{createAdmissionClient},{createMarketingMailchimp},{runAdmission},{createMarketingEligibility},{createProgramProducer},{discoverPrograms},{createMarketingHiveEligibility},{sourceServices},{reviewStore}]=await Promise.all([import('@netlify/blobs'),import('../lib/marketing-admission-client.mjs'),import('../lib/marketing-mailchimp.mjs'),import('../lib/marketing-admission-worker.mjs'),import('../lib/marketing-eligibility.mjs'),import('../lib/marketing-program-producer.mjs'),import('../lib/marketing-program-discovery.mjs'),import('../lib/marketing-hive-eligibility.mjs'),import('../lib/hive-source-runtime.mjs'),import('../lib/review-runtime.mjs')]);
 const store=getStore({name:'insites-marketing-admission-cursors',consistency:'strong'}),client=createAdmissionClient({deadline}),provider=createMarketingMailchimp({deadline});
 const sourceNoBusiness=createMarketingHiveEligibility({services:()=>sourceServices(context)});
 const producer=createProgramProducer({config:MARKETING_ADMISSION,client,provider,sourceNoBusiness});
 const eligibility=createMarketingEligibility({sourceNoBusiness,reviewRow:token=>reviewStore(context).get('requests/'+token,{type:'json'}),provider,client});
 const old=await store.get('finite-v1',{type:'json'})||{};
 // Bounded discovery runs first so permanently held due rows cannot starve new eligible identities.
 // All ledger commands still share the durable 40-read/40-write budget and work deadline.
 const discovered=await discoverPrograms({config:MARKETING_ADMISSION,cache:sourceServices(context).cache,producer,cursor:old.discoveryCursor||0,deadline});
 const result=await runAdmission({config:MARKETING_ADMISSION,client,provider,eligibility,producer,cursor:old.dueCursor||2,deadline});
 await store.setJSON('finite-v1',{dueCursor:result.cursor,discoveryCursor:discovered.cursor});
 console.log('Marketing admission result',JSON.stringify({processed:result.processed,attempts:result.sentAttempts,settled:result.settled,held:result.held,considered:discovered.considered||0,enrolled:discovered.enrolled||0}));
 return Response.json({processed:result.processed});
};
