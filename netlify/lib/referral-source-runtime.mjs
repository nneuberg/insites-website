import {historicalClientLookup} from './referral-history-archive.mjs';
import {ledgerPriorRewardReader} from './referral-prior-reward.mjs';
import {automaticQualifiedCaseReader} from './referral-automatic-evidence.mjs';
// One server-owned evidence path for invitation preparation AND reward redemption.
// Missing source adapters hold; never substitute manual per-referral attestations,
// an empty ledger, or a bounded search for verified full historical coverage.
export function productionQualifiedCaseReader({store,reviewStore,readHive,ledger,legacyLookup,readPriorReward,now=()=>Date.now()}){
 return automaticQualifiedCaseReader({readHive,ledger,reviewStore,now,
  readCoverage:()=>store.get('qualification-source-policy/current',{type:'json'}),
  legacyLookup:legacyLookup||historicalClientLookup({readArchive:()=>store.get('qualification-source-history/current',{type:'json'})}),readPriorReward:readPriorReward||ledgerPriorRewardReader({readHive})});
}
