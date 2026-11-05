import {createHash} from 'node:crypto';
import {validateClaimRuntime} from './referral-runtime-validation.mjs';
import {claimWorker,claimOperator,consumerSuppressionClient} from './referral-claim-worker.mjs';
import {createClaims} from './referral-claims.mjs';
import {invitations,invitationDelivery} from './referral-invitations.mjs';
import {qualifiedLedger} from './referral-qualification-integration.mjs';
import {qualificationSnapshot} from './referral-qualification-clock.mjs';
import {assessReferralIdentity} from './referral-identity-evidence.mjs';
import {customerReservationKeys,completionEvidence} from './referral-qualification-integration.mjs';
import {claimVault} from './claim-vault.mjs';
import {tremendous} from './tremendous.mjs';
import {productionBudgetProvider} from './referral-budget-runtime.mjs';
const SITE='a21b8d9c-9ce0-4114-985d-d77cabae32e9';
export function workerMode({worker,context}){
 if(context?.site?.id!==SITE||context?.deploy?.context!=='production')return 'disabled';
 if(worker.shadow===true){if(worker.dispatch||worker.reconciliation||worker.operations||worker.dryRun===false)throw Error('Shadow cannot enable mutation controls');return 'shadow';}
 return worker.dispatch||worker.reconciliation||worker.operations?'active':'disabled';
}
// True read-only shadow: do not use qualifiedLedger, which intentionally records
// qualifications. No cursor/clock/outbox/ledger writes and no provider construction.
export async function shadowClaimWorker({ledger,readCase,worker,now=()=>Date.now(),limit=10}){
 const report={mode:'shadow',checked:0,qualified:0,held:0,failed:0,sent:0,purchased:0};
 const snapshot=await ledger('codeSnapshot',{});
 if(!Array.isArray(snapshot?.uses))throw Error('Ledger snapshot unavailable');
 const ids=[...new Set(snapshot.uses.map(x=>x['Use ID']).filter(x=>/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(x||'')))].sort().slice(0,Math.max(1,Math.min(10,limit)));
 for(const useId of ids){report.checked++;try{
  const e=await readCase(useId),identity=assessReferralIdentity(e.identityInput);
  const completion=completionEvidence({inspectionId:e.facts.inspectionId,storedEvent:e.storedEvent,operatorEvidence:e.operatorEvidence,now:now()});
  const valid=identity.status==='usable-exact-identifier'&&identity.sourceContactIds.includes(e.facts.sourceContactId)&&identity.primaryEmail===String(e.facts.clientEmail||'').trim().toLowerCase();
  const state=qualificationSnapshot({facts:{...e.facts,canonicalCustomerId:valid?customerReservationKeys(identity).join('|'):null,identityVerified:valid,completion},observedAt:new Date(now()).toISOString(),launchCutoff:worker.startAfter}).state;
  if(state.qualified)report.qualified++;else report.held++;
 }catch{report.failed++;}}
 return report;
}
export async function runClaimWorker({context,launch,worker,budget,sender,env={},ledger,readCase,store,fetcher=fetch,now=()=>Date.now()}){
 const mode=workerMode({worker,context});
 if(mode==='disabled')return {mode,disabled:true,sent:0,purchased:0};
 if(mode==='shadow')return shadowClaimWorker({ledger,readCase,worker,now});
 validateClaimRuntime({launch,worker,budget,sender,now:now()});
 // No per-case operator credential guessing. Private recovery queue can support
// reconcile/revoke only here; evidence recording needs separately verified auth.
 const verified=qualifiedLedger({ledger,readCase,launchCutoff:worker.startAfter,now:()=>new Date(now()).toISOString()});
 const vault=claimVault(env.REFERRAL_CLAIM_ENCRYPTION_KEY);
 const provider=productionBudgetProvider({provider:tremendous({...launch,key:env.TREMENDOUS_API_KEY,fetcher}),store,config:budget,now});
 const claims=createClaims({store,provider,ledger:verified.call,vault,enabled:launch.enabled,now});
 const suppression=consumerSuppressionClient({env,sender,fetcher});
 const outbox=invitations({store,claims,vault,ledger:verified.call,suppression,sender,enabled:worker.dispatch&&worker.dryRun===false,send:invitationDelivery({key:env.RESEND_REWARDS_API_KEY,enabled:worker.dispatch&&worker.dryRun===false,fetcher}),now});
 const resolveToken=async useId=>{const key='claim-uses/'+createHash('sha256').update(useId).digest('hex'),row=await store.get(key,{type:'json'});if(!row?.capability)throw Error('Claim index unavailable');const {token}=vault.open(row.capability,key);if(row.claimKey!=='claims/'+createHash('sha256').update(token).digest('hex'))throw Error('Claim index mismatch');return token;};
 return claimWorker({ledger:verified.call,claims,invitations:outbox,operator:claimOperator({claims,invitations:outbox,resolveToken}),resolveToken,store,suppression,config:worker,now});
}
