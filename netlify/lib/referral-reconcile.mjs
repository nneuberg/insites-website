import {isOwnedSyntheticInspection} from './referral-test-isolation.mjs';
import {matchReferral} from './referral-hive.mjs';
const validId=id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id);
export async function reconcileInspection({id,eventId='',read,callLedger,snapshot,serviceIds=[],now=()=>Date.now()}){
 if(!validId(id))throw Error('Invalid inspection ID');
 if(isOwnedSyntheticInspection(id,snapshot))return {matched:false,held:false,ignoredSynthetic:true};
 const observedAt=new Date(now()).toISOString();
 let inspection;
 try{inspection=await read('inspections/'+encodeURIComponent(id));if(inspection.id!==id)throw Error('Inspection mismatch');}
 catch(error){await callLedger('holdCodeUse',{inspectionId:id,reason:'Hive verification unavailable; retry required'});throw error;}
 const match=matchReferral(inspection,snapshot,{serviceIds,now:now()});
 if(!match.matched||!match.facts.clientId||!match.facts.clientEmail||match.holds.some(h=>h.includes('changed'))){
  if(match.matched||match.hold)await callLedger('holdCodeUse',{inspectionId:id,reason:match.hold||match.holds?.join('; ')||'Referral attribution unavailable'});
  return {matched:false,held:!!match.hold||!!match.matched};
 }
 const result=await callLedger('recordCodeUse',{inspection:match.facts,observedAt,eventId,evidence:'Hive API: exact discount code; published report and elapsed end; full payment observed. New-client/refund/dispute evidence remains unverified.'});
 return {matched:result.matched===true,held:result.held===true||match.holds.length>0};
}
// Resumable scan plus priority rechecks. This module never sends messages or rewards.
export async function reconcileTick({read,callLedger,loadState,saveState,pending=[],ack=async()=>{},serviceIds=[],now=()=>Date.now(),maxItems=5,budgetMs=35000}){
 const started=now(),snapshot=await callLedger('codeSnapshot',{});
 if(snapshot.version!=='2026-10-22-reconcile')throw Error('Referral ledger update required');
 if(!Array.isArray(snapshot.codes)||!Array.isArray(snapshot.uses))throw Error('Invalid ledger snapshot');
 const state=(await loadState())||{cursor:null,items:[],nextCursor:null,reviewOffset:0};
 state.retryIds=(state.retryIds||[]).filter(id=>!isOwnedSyntheticInspection(id,snapshot));
 const report={read:0,matched:0,held:0,errors:0,scanComplete:false};
 const seen=new Map();
 const work=async(id,eventId='')=>{
  if(isOwnedSyntheticInspection(id,snapshot)){seen.set(id,true);return true;}
  if(seen.has(id))return seen.get(id);
  if(report.read>=maxItems||now()-started>=budgetMs)return false;
  report.read++;
  try{const result=await reconcileInspection({id,eventId,read,callLedger,snapshot,serviceIds,now});if(result.matched)report.matched++;if(result.held)report.held++;seen.set(id,true);return true;}
  catch{report.errors++;seen.set(id,false);return false;}
 };
 // One event and one known referral per tick leave capacity for discovering new referrals.
 for(const job of pending.slice(0,1)){if(await work(job.inspectionId,job.eventId))await ack(job.key);}
 if(state.retryIds.length){const retry=state.retryIds.shift();if(!await work(retry))state.retryIds.push(retry);await saveState(state);}
 const known=snapshot.uses.filter(u=>validId(u['Hive Inspection ID'])&&!isOwnedSyntheticInspection(u['Hive Inspection ID'],snapshot));
 if(known.length){const at=(state.reviewOffset||0)%known.length;await work(known[at]['Hive Inspection ID']);state.reviewOffset=(at+1)%known.length;}
 if(!state.items?.length&&report.read<maxItems&&now()-started<budgetMs){
  const query=new URLSearchParams({limit:'5'});if(state.cursor)query.set('cursor',state.cursor);
  const page=await read('inspections?'+query);
  if(!Array.isArray(page.data)||page.data.some(i=>!validId(i.id)))throw Error('Invalid Hive page');
  if(page.next_cursor&&page.next_cursor===state.cursor)throw Error('Repeated Hive cursor');
  state.items=[...new Set(page.data.map(i=>i.id))];state.nextCursor=page.next_cursor||null;state.pageLoaded=true;
  await saveState(state);
 }
 while(state.items?.length&&report.read<maxItems&&now()-started<budgetMs){
  const id=state.items[0];if(!await work(id)){if(!seen.has(id))break;if(!state.retryIds.includes(id))state.retryIds.push(id);}
  state.items.shift();await saveState(state);
 }
 if(state.pageLoaded&&!state.items?.length){state.pageLoaded=false;state.cursor=state.nextCursor||null;report.scanComplete=!state.cursor&&!state.retryIds.length;if(report.scanComplete)state.lastScanCompletedAt=new Date(now()).toISOString();}
 await saveState(state);return report;
}
