import {ledgerPriorRewardReader} from './referral-prior-reward.mjs';
import {automaticQualifiedCaseReader} from './referral-automatic-evidence.mjs';
// One server-owned evidence path for invitation preparation AND reward redemption.
// Missing source adapters hold; never substitute manual per-referral attestations,
// an empty ledger, or a bounded search for verified full historical coverage.
export function productionQualifiedCaseReader({store,reviewStore,readHive,ledger,readPriorReward,now=()=>Date.now()}){
 return automaticQualifiedCaseReader({readHive,ledger,reviewStore,now,
  readCoverage:async()=>{
   const policy=await store.get('qualification-source-policy/current',{type:'json'});
   // All historical data now lives in Hive. Missing migration policy holds;
   // never fall back to a Spectora archive or invent an empty legacy receipt.
   if(policy?.historyCoverage?.sourceMode!=='hive-migrated')throw Error('Hive migrated history policy unverified');
   return policy;
  },readPriorReward:readPriorReward||ledgerPriorRewardReader({readHive})});
}
