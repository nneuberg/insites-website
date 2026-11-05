// INACTIVE library only. No runtime route, credentials, network client or dispatcher.
// Service arguments are trusted application dependencies, NEVER request-body data.
import {hash,normalize,fingerprint,similar,importHistory,readState,mutate,changed,reviewFingerprint} from './cards-core.mjs';
export const HISTORY_HEADERS=Object.freeze('record_id,hive_contact_id,hive_inspection_id,agency_id,recipient_name,brokerage_name,address_line1,address_line2,city,region,postal_code,country,address_verified_at,exact_draft_wording,exact_approved_wording,exact_sent_wording,normalized_text_sha256,similarity_result,status,approval_by,approval_at,approval_fingerprint,artwork_version,idempotency_key,automation_instance_id,cardly_external_order_number,cardly_order_id,cost,currency,created_at,updated_at,ordered_at,sent_at,delivered_at,last_error,evidence_reference,history_reconciled'.split(','));
const terminal=new Set(['SENT','DELIVERED']);
const required=v=>typeof v==='string'&&v.trim().length>0;
export function decodeHistory(snapshot,agentId){
 if(!required(agentId)||snapshot?.complete!==true||snapshot.nextPageToken||!required(snapshot.revision)||!required(snapshot.evidence)||!Array.isArray(snapshot.headers)||!Array.isArray(snapshot.rows)||snapshot.headers.length!==HISTORY_HEADERS.length||snapshot.headers.some((h,i)=>h!==HISTORY_HEADERS[i]))throw Error('history_incomplete');
 // Headers-only is not evidence of no prior cards. Reconciliation must cover the
 // provider and any legacy/source ledger, independently of this empty sheet.
 const reconciliation=snapshot.reconciliation?.[agentId];
 if(reconciliation?.complete!==true||!required(reconciliation.evidence)||!Number.isInteger(reconciliation.expectedRecords)||reconciliation.expectedRecords<0)throw Error('history_unreconciled');
 const seen=new Set(),records=[];
 for(const cells of snapshot.rows){
  if(!Array.isArray(cells)||cells.length>HISTORY_HEADERS.length)throw Error('history_invalid_row');
  if(cells.every(v=>v===''||v==null))continue;
  const row=Object.fromEntries(HISTORY_HEADERS.map((h,i)=>[h,cells[i]??'']));
  if(!required(row.record_id)||!required(row.hive_contact_id)||seen.has(row.record_id))throw Error('history_identity_conflict');
  seen.add(row.record_id);
  if(row.hive_contact_id!==agentId)continue;
  if(!['HOLD','DRAFT','MANUAL_REVIEW','AWAITING_APPROVAL','APPROVED','SUBMITTING','ORDERED','UNKNOWN','FAILED','SENT','DELIVERED','CANCELLED'].includes(row.status))throw Error('history_status_unknown');
  if(row.exact_sent_wording&&!terminal.has(row.status))throw Error('history_sent_status_conflict');
  if(terminal.has(row.status)&&(!required(row.exact_sent_wording)||!required(row.cardly_order_id)||!required(row.sent_at)||!required(row.evidence_reference)))throw Error('history_sent_evidence_missing');
  const texts=[row.exact_draft_wording,row.exact_approved_wording,row.exact_sent_wording].filter(Boolean);
  if(texts.some(t=>typeof t!=='string'||!normalize(t)||t.length>1000))throw Error('history_invalid_text');
  if(row.exact_sent_wording&&row.normalized_text_sha256!==hash(normalize(row.exact_sent_wording)))throw Error('history_text_hash_mismatch');
  records.push(row);
 }
 if(records.length!==reconciliation.expectedRecords)throw Error('history_record_count_mismatch');
 // Append-only lifecycle records retain every prior wording. Only the latest
 // proven revision of each logical card determines whether an attempt remains
 // unresolved; an old UNKNOWN row must not poison a later real receipt forever.
 const latest=new Map();
 for(const row of records){
  const match=/^(.+):v([1-9][0-9]*)$/.exec(row.record_id),base=match?match[1]:row.record_id,version=match?Number(match[2]):0,key=row.idempotency_key||base;
  if(!Number.isSafeInteger(version))throw Error('history_revision_invalid');
  const prior=latest.get(key);
  if(prior&&(prior.base!==base||prior.row.hive_inspection_id!==row.hive_inspection_id||prior.version===version))throw Error('history_revision_conflict');
  if(!prior||version>prior.version)latest.set(key,{row,base,version});
 }
 if([...latest.values()].some(({row})=>['SUBMITTING','UNKNOWN'].includes(row.status)))throw Error('history_outcome_unresolved');
 return {records,evidence:fingerprint({revision:snapshot.revision,evidence:snapshot.evidence,reconciliation}),rows:records.flatMap(r=>[...new Set([r.exact_draft_wording,r.exact_approved_wording,r.exact_sent_wording].filter(Boolean))].map(text=>({id:r.record_id,text,inspectionId:r.hive_inspection_id})))};
}
export async function refreshHistory({store,history,agentId,now=Date.now()}){
 try{
  const decoded=decodeHistory(await history.readComplete(),agentId);
  await importHistory(store,{agentId,rows:decoded.rows,complete:true,evidence:decoded.evidence},now);
  return {status:'history_reconciled',recordCount:decoded.records.length,deliveryEnabled:false};
 }catch(error){
  await importHistory(store,{agentId,rows:[],complete:false,evidence:'history_read_failed'},now);
  throw error;
 }
}
export function repetitionReport(text,records){
 const normalized=normalize(text);
 if(!normalized)throw Error('message_required');
 return {algorithm:'normalized-character-trigram-dice-v1',threshold:0.82,matches:records.filter(r=>[r.exact_draft_wording,r.exact_approved_wording,r.exact_sent_wording].filter(Boolean).some(t=>similar(normalized,normalize(t)))).map(r=>r.record_id).sort()};
}
export function projectCard(job){
 const s=job.snapshot,r=s.recipient;
 if((terminal.has(job.status)&&!job.sentText)||(job.sentText&&(!terminal.has(job.status)||!job.receiptEvidence||!job.orderId||!job.sentAt)))throw Error('sent_receipt_required');
 const fields={record_id:job.id,hive_contact_id:s.agentId,hive_inspection_id:s.inspectionId,agency_id:s.agencyId,recipient_name:[r.firstName,r.lastName].filter(Boolean).join(' '),brokerage_name:r.company||'',address_line1:r.address,address_line2:r.address2||'',city:r.city,region:r.region,postal_code:r.postcode,country:r.country,address_verified_at:s.addressVerifiedAt||'',exact_draft_wording:job.draftText||'',exact_approved_wording:job.approvedText||'',exact_sent_wording:job.sentText||'',normalized_text_sha256:job.sentText?hash(normalize(job.sentText)):'',similarity_result:job.similarityResult||'',status:job.status==='SUPERSEDED'?'CANCELLED':job.status,approval_by:job.approval?.by||'',approval_at:job.approval?.at||'',approval_fingerprint:job.approval?.fingerprint||'',artwork_version:job.approval?.artwork?.revision||'',idempotency_key:job.idempotencyKey,automation_instance_id:job.automationInstanceId,cardly_external_order_number:job.externalOrderNumber,cardly_order_id:job.orderId||'',cost:job.cost??'',currency:job.currency||'',created_at:job.createdAt,updated_at:job.updatedAt,ordered_at:job.orderedAt||'',sent_at:job.sentAt||'',delivered_at:job.deliveredAt||'',last_error:job.error||'',evidence_reference:job.receiptEvidence||'',history_reconciled:job.historyReconciled===true};
 return Object.fromEntries(HISTORY_HEADERS.map(h=>[h,fields[h]??'']));
}
// Requires a SERIALIZED transactional gateway. Plain Sheets read + update is NOT
// compare-and-set. Gateway must atomically check the whole prior row (or absence),
// resolve stable record_id after sorting, reject duplicates, and apply RAW cells.
export async function projectNext({store,history,now=Date.now()}){
 const claimed=await mutate(store,s=>{
  if(s.historyWrite||s.projectionLease||s.sheetAppend)return {unchanged:true,status:'reconcile_required'};
  const job=Object.values(s.jobs).find(j=>j.projectionPending);if(!job)return {unchanged:true,status:'idle'};
  const next=projectCard(job),prior=s.historyProjections?.[job.id]??null;
  const intent={jobId:job.id,revision:job.revision,prior,next,operationId:fingerprint([job.id,job.revision,next]),at:now};
  s.historyWrite=intent;return {status:'claimed',intent};
 });
 if(!claimed.intent)return claimed;
 const i=claimed.intent;
 try{
  const outcome=await history.compareAndSetRecord({recordId:i.jobId,expected:i.prior,next:i.next,operationId:i.operationId,inputMode:'RAW'});
  if(outcome?.status!=='applied'&&outcome?.status!=='already_applied')return {status:'reconcile_required',deliveryEnabled:false};
  return reconcileProjection({store,history});
 }catch{return {status:'reconcile_required',deliveryEnabled:false};}
}
export async function reconcileProjection({store,history}){
 const intent=(await readState(store)).historyWrite;if(!intent)return {status:'idle'};
 // An authoritative operation lookup must establish quiescence. A row read alone
 // cannot rule out a timed-out write still arriving later. No automatic retries.
 const result=await history.lookupOperation(intent.operationId);
 if(result?.settled!==true)return {status:'reconcile_required'};
 if(!['applied','not_applied'].includes(result.status))return {status:'reconcile_required'};
 if(result.status==='applied'&&fingerprint(result.record)!==fingerprint(intent.next))return {status:'user_edit_conflict'};
 if(result.status==='not_applied'&&fingerprint(result.record??null)!==fingerprint(intent.prior))return {status:'user_edit_conflict'};
 return mutate(store,s=>{
  if(s.historyWrite?.operationId!==intent.operationId)throw Error('projection_changed');
  if(result.status==='applied'){
   s.historyProjections??={};s.historyProjections[intent.jobId]=intent.next;
   const job=s.jobs[intent.jobId];if(job?.revision===intent.revision)job.projectionPending=false;
  }
  s.historyWrite=null;return {status:result.status==='applied'?'projected':'safe_to_retry',deliveryEnabled:false};
 });
}
// Read-only provider lookup; never creates an order. A future separately authorized
// dispatcher must first persist orderAttempt with the reviewed fingerprint.
export async function reconcileProviderReceipt({store,jobId,provider,now=Date.now()}){
 const job=(await readState(store)).jobs[jobId];
 if(!job?.orderAttempt||!job.approvedText||!job.approval)throw Error('order_attempt_required');
 let receipt;
 try{receipt=await provider.lookupVerifiedReceipt(job.externalOrderNumber);}catch{return {status:'provider_reconcile_required'};}
 if(!receipt||receipt.verified!==true||!required(receipt.evidence)||!required(receipt.orderId)||receipt.externalOrderNumber!==job.externalOrderNumber||receipt.idempotencyKey!==job.idempotencyKey||receipt.exactText!==job.approvedText||receipt.recipientFingerprint!==fingerprint(job.snapshot.recipient)||receipt.approvalFingerprint!==job.approval.fingerprint||job.approval.fingerprint!==reviewFingerprint(job,job.approvedText,job.approval.artwork)||job.orderAttempt.approvalFingerprint!==job.approval.fingerprint||!['ORDERED','SENT','DELIVERED'].includes(receipt.status))return {status:'provider_reconcile_required'};
 if(!Number.isFinite(receipt.orderedAt)||receipt.orderedAt>now||((terminal.has(receipt.status))&&(!Number.isFinite(receipt.sentAt)||receipt.sentAt<receipt.orderedAt||receipt.sentAt>now))||(receipt.status==='DELIVERED'&&(!Number.isFinite(receipt.deliveredAt)||receipt.deliveredAt<receipt.sentAt||receipt.deliveredAt>now)))return {status:'provider_reconcile_required'};
 return mutate(store,s=>{
  const j=s.jobs[jobId];if(j.revision!==job.revision)throw Error('receipt_job_changed');
  if(j.orderId&&j.orderId!==receipt.orderId)throw Error('receipt_order_conflict');
  const rank={ORDERED:1,SENT:2,DELIVERED:3};if((rank[j.status]||0)>rank[receipt.status])return {unchanged:true,status:'stale_receipt_ignored'};
  const update={orderId:receipt.orderId,status:receipt.status,orderedAt:receipt.orderedAt,receiptEvidence:receipt.evidence};
  if(terminal.has(receipt.status)){update.sentText=receipt.exactText;update.sentAt=receipt.sentAt;}
  if(receipt.status==='DELIVERED')update.deliveredAt=receipt.deliveredAt;
  if(Object.entries(update).every(([k,v])=>j[k]===v))return {unchanged:true,status:'receipt_already_recorded'};
  Object.assign(j,update);changed(j,now);return {status:'receipt_recorded',deliveryEnabled:false};
 });
}

export async function prepareDraftContext({store,history,snapshot,now=Date.now()}){
 // Caller supplies a trusted source-cache snapshot, never arbitrary event fields.
 const p=snapshot?.personalization;
 if(p?.verified!==true||!required(p.evidence)||p.inspectionId!==snapshot.inspectionId||p.agentId!==snapshot.agentId||![p.streetName,p.clientName].some(required))throw Error('personalization_source_required');
 let decoded;
 try{decoded=decodeHistory(await history.readComplete(),snapshot.agentId);}catch(error){await importHistory(store,{agentId:snapshot.agentId,rows:[],complete:false,evidence:'history_context_failed'},now);throw error;}
 const state=await readState(store),records=new Map(decoded.records.map(r=>[r.record_id,r]));
 // An append-only revision of this same card is not another card. Only an exact
 // journal-confirmed row may be excluded from self-collision; all other cards
 // and unrecognized rows still enter the repetition history. Keep every wording
 // in the returned context, including this card's previous draft revisions.
 const rows=decoded.rows.filter(row=>{
  const own=state.jobs[row.id.replace(/:v\d+$/,'')],receipt=state.sheetReceipts?.[row.id];
  return !(own?.snapshot.agentId===snapshot.agentId&&own.snapshot.organizationId===snapshot.organizationId&&own.snapshot.inspectionId===snapshot.inspectionId&&receipt?.operationId&&receipt.hash===fingerprint(records.get(row.id)));
 });
 await importHistory(store,{agentId:snapshot.agentId,rows,complete:true,evidence:decoded.evidence},now);
 return {source:{inspectionId:snapshot.inspectionId,agentId:snapshot.agentId,streetName:p.streetName||null,clientName:p.clientName||null,evidence:p.evidence},priorCards:decoded.records.map(r=>({recordId:r.record_id,status:r.status,exactDraft:r.exact_draft_wording,exactApproved:r.exact_approved_wording,exactSent:r.exact_sent_wording})),historyEvidence:decoded.evidence,instructions:['Write as me, not as InSites.','Use the verified street or client name naturally.','Keep it warm and lightly playful, with natural phrasing rather than forced jokes.','Never invent shared moments or tease about property defects.','Preserve already approved wording exactly; these guidelines apply to future drafts.','Do not invent interactions, outcomes or personal details.','Use the full prior wording to avoid repetition, not a rotating name/address template.','Owner review is required.'],deliveryEnabled:false};
}
