import {randomUUID} from 'node:crypto';
import {mutate,readState,hash,fingerprint,review} from './cards-core.mjs';
import {prepareDraftContext} from './cards-history.mjs';
// The automation role can request personal draft context and return candidates.
// It cannot approve, modify identity/address, attest history or place an order.
export async function claimCardDraft({store,history,source,now=Date.now()}){
 const state=await readState(store);
 const job=Object.values(state.jobs).find(j=>j.status==='MANUAL_REVIEW'&&!j.draftText&&!j.orderAttempt&&!j.draftLease&&j.historyReconciled===true);
 if(!job)return {status:'idle'};
 if(!source||!job.snapshot.sourceRecords)throw Error('source_verification_required');
 const inspection=await source.getInspection(job.snapshot.inspectionId),contact=await source.getContact(job.snapshot.agentId);
 if(fingerprint({inspection,contact})!==job.snapshot.sourceRecords)throw Error('source_changed');
 const verifiedHistory={async readComplete(){const snapshot=await history.readComplete(),r=snapshot?.reconciliation?.[job.snapshot.agentId];if(!['provider','legacy'].every(k=>r?.[k]?.complete===true&&typeof r[k].evidence==='string'&&r[k].evidence.trim()))throw Error('provider_legacy_history_unreconciled');return snapshot;}};
 const context=await prepareDraftContext({store,history:verifiedHistory,snapshot:job.snapshot,now});
 if(Buffer.byteLength(JSON.stringify(context))>64000)throw Error('draft_context_requires_manual_review');
 const token=randomUUID();
 const result=await mutate(store,s=>{
  const j=s.jobs[job.id];if(j?.revision!==job.revision||j.draftLease||j.status!=='MANUAL_REVIEW'||j.orderAttempt||s.historyReady[hash(j.snapshot.agentId)]?.complete!==true)return {unchanged:true,status:'busy'};
  j.draftLease={token,revision:j.revision,sourceRecords:j.snapshot.sourceRecords,at:now,until:now+10*60000};return {status:'claimed',jobId:j.id,revision:j.revision,token};
 });
 return result.status==='claimed'?{...result,context,recipientFirstName:job.snapshot.recipient.firstName}:result;
}
export async function completeCardDraft({store,source,jobId,revision,token,text,now=Date.now()}){
 const state=await readState(store),job=state.jobs[jobId],lease=job?.draftLease;
 if(!lease||lease.token!==token||lease.revision!==revision||job.revision!==revision||lease.until<=now||job.status!=='MANUAL_REVIEW'||job.orderAttempt)throw Error('draft_lease_invalid');
 const inspection=await source.getInspection(job.snapshot.inspectionId),contact=await source.getContact(job.snapshot.agentId);
 if(fingerprint({inspection,contact})!==lease.sourceRecords)throw Error('source_changed');
 // review() applies fresh office/history, first-person, grounded-reference and
 // all-history repetition checks. approve:false can never authorize a purchase.
 const result=await review(store,{jobId,revision,text,approve:false,draftLeaseToken:token},now);
 return {...result,deliveryEnabled:false};
}
