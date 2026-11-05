import {CLAIM_LAUNCH,CLAIM_WORKER,CLAIM_BUDGET,CLAIM_SENDER} from '../lib/referral-claim-launch.mjs';
import {workerMode,runClaimWorker} from '../lib/referral-worker-runtime.mjs';
// Prepared only. Controls default OFF; no dependency/secret/provider use when OFF.
export const config={schedule:'*/15 * * * *'};
export default async(request,context)=>{
 if(workerMode({worker:CLAIM_WORKER,context})==='disabled')return new Response(null,{status:204});
 try{
  const [{getStore},{ledger},{sourceServices},{cachedQualifiedCaseReader}]=await Promise.all([import('@netlify/blobs'),import('../lib/referral-transport.mjs'),import('../lib/hive-source-runtime.mjs'),import('../lib/referral-cache-source.mjs')]);
  const env=Object.fromEntries(['REFERRAL_LEDGER_URL','REFERRAL_LEDGER_SECRET','TREMENDOUS_API_KEY','REFERRAL_CLAIM_ENCRYPTION_KEY','RESEND_REWARDS_API_KEY','MAILCHIMP_API_KEY','MAILCHIMP_REFERRAL_AUDIENCE_ID'].map(k=>[k,Netlify.env.get(k)]));
  const store=getStore({name:'insites-referral-claims',consistency:'strong'}),reviewStore=getStore({name:'insites-review-campaign',consistency:'strong'});
  const call=(action,data)=>ledger(action,data,env);
  const readCase=cachedQualifiedCaseReader({store,reviewStore,services:sourceServices(context),ledger:call});
  console.log(JSON.stringify(await runClaimWorker({context,launch:CLAIM_LAUNCH,worker:CLAIM_WORKER,budget:CLAIM_BUDGET,sender:CLAIM_SENDER,env,ledger:call,readCase,store})));
 }catch{console.log(JSON.stringify({mode:'held',reason:'worker-prerequisite-unavailable',sent:0,purchased:0}));}
 return new Response(null,{status:204});
};
