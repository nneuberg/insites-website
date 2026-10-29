import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {createCachedHiveReader} from '../lib/hive-source-reader.mjs';
import {CLAIM_LAUNCH,CLAIM_WORKER,CLAIM_BUDGET,CLAIM_SENDER} from '../lib/referral-claim-launch.mjs';
export default async(request,context)=>{
 if(!CLAIM_LAUNCH.enabled)return Response.json({error:'Reward claims are not yet available.'},{status:503,headers:{'Cache-Control':'no-store'}});
 // Live ledger must never receive sandbox issuance. Sandbox uses injected mocks
 // or an explicitly separate harness, never this production entry point.
 if(context?.deploy?.context!=='production'||CLAIM_LAUNCH.environment!=='production')return new Response(null,{status:503});
 const [{getStore},{createClaims,claimHandler},{tremendous},{ledger},{claimVault}]=await Promise.all([import('@netlify/blobs'),import('../lib/referral-claims.mjs'),import('../lib/tremendous.mjs'),import('../lib/referral-transport.mjs'),import('../lib/claim-vault.mjs')]);
 const production=context?.deploy?.context==='production';
 if(!production&&CLAIM_LAUNCH.environment==='production')return new Response(null,{status:503});
 const store=getStore({name:production?'insites-referral-claims':'insites-referral-claims-'+(context?.deploy?.id||'local'),consistency:'strong'});
 const [{qualifiedLedger},{qualifiedCaseReader}]=await Promise.all([import('../lib/referral-qualification-integration.mjs'),import('../lib/referral-qualified-case.mjs')]);
 const {validateClaimRuntime}=await import('../lib/referral-runtime-validation.mjs');validateClaimRuntime({launch:CLAIM_LAUNCH,worker:CLAIM_WORKER,budget:CLAIM_BUDGET,sender:CLAIM_SENDER});
 const verified=qualifiedLedger({ledger,launchCutoff:CLAIM_WORKER.startAfter,readCase:qualifiedCaseReader({store,reviewStore:getStore({name:'insites-review-campaign',consistency:'strong'}),readHive:createCachedHiveReader(sourceServices(context))})});
 const {productionBudgetProvider}=await import('../lib/referral-budget-runtime.mjs');
 const provider=productionBudgetProvider({provider:tremendous({...CLAIM_LAUNCH,key:process.env.TREMENDOUS_API_KEY}),store,config:CLAIM_BUDGET});
 return claimHandler({claims:createClaims({store,provider,ledger:verified.call,vault:claimVault(process.env.REFERRAL_CLAIM_ENCRYPTION_KEY),enabled:CLAIM_LAUNCH.enabled})})(request);
};
export const config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
