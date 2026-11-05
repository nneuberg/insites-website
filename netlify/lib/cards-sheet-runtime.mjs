import {randomUUID} from 'node:crypto';
import {ledger} from './referral-transport.mjs';
import {HISTORY_HEADERS,decodeHistory,projectCard} from './cards-history.mjs';
import {readState,mutate,importHistory,fingerprint,changed} from './cards-core.mjs';
export const CARD_HISTORY_PLAN=Object.freeze({enabled:false,version:'append-history-v1',deliveryEnabled:false});
export function createCardSheetClient({call=ledger,env=process.env}={}){
 return {readComplete:()=>call('cardHistorySnapshot',{},env,7500),append:input=>call('cardHistoryAppend',input,env,7500),lookup:operationId=>call('cardHistoryOperation',{operationId},env,7500)};
}
const literal=v=>v==null?'':typeof v==='boolean'?String(v).toUpperCase():String(v);
export function appendRecord(job){
 const record=projectCard(job);
 if(!['HOLD','DRAFT','MANUAL_REVIEW','AWAITING_APPROVAL','APPROVED','SUPERSEDED'].includes(job.status)||job.orderAttempt||job.orderId||job.sentText)throw Error('provider_history_requires_separate_integration');
 // Immutable event row identity, stable logical card identity in idempotency_key.
 record.record_id=job.id+':v'+job.revision;
 record.cardly_external_order_number='';
 return Object.fromEntries(HISTORY_HEADERS.map(h=>[h,literal(record[h])]));
}
export async function reconcileAppend({store,sheet}){
 const intent=(await readState(store)).sheetAppend;if(!intent)return {status:'idle'};
 let outcome;try{outcome=await sheet.lookup(intent.operationId);}catch{return {status:'reconcile_required'};}
 if(outcome?.settled!==true)return {status:'reconcile_required'};
 if(outcome.status==='applied'&&fingerprint(outcome.record)!==fingerprint(intent.record))return {status:'user_edit_conflict'};
 if(!['applied','not_applied'].includes(outcome.status))return {status:'reconcile_required'};
 return mutate(store,s=>{
  if(s.sheetAppend?.operationId!==intent.operationId)throw Error('append_changed');
  if(outcome.status==='applied'){
   const j=s.jobs[intent.jobId];if(j?.revision===intent.revision)j.projectionPending=false;
   s.sheetReceipts??={};s.sheetReceipts[intent.record.record_id]={operationId:intent.operationId,hash:fingerprint(intent.record)};
  }
  s.sheetAppend=null;return {status:outcome.status==='applied'?'appended':'safe_to_retry',deliveryEnabled:false};
 });
}
export async function appendNext({store,sheet,now=Date.now()}){
 const claimed=await mutate(store,s=>{
  if(s.sheetAppend||s.historyWrite||s.projectionLease)return {unchanged:true,status:'reconcile_required'};
  const j=Object.values(s.jobs).find(j=>j.projectionPending);if(!j)return {unchanged:true,status:'idle'};
  const record=appendRecord(j);const intent={jobId:j.id,revision:j.revision,record,operationId:randomUUID(),at:now};s.sheetAppend=intent;return {intent};
 });
 if(!claimed.intent)return claimed;
 try{await sheet.append({operationId:claimed.intent.operationId,record:claimed.intent.record});}catch{return {status:'reconcile_required'};}
 return reconcileAppend({store,sheet});
}
async function refreshSheetHistoryUnchecked({store,sheet,now=Date.now()}){
 let snapshot;
 try{snapshot=await sheet.readComplete();if(snapshot?.version!==CARD_HISTORY_PLAN.version||snapshot.complete!==true)throw Error('sheet_version_mismatch');}
 catch(error){const s=await readState(store);for(const agentId of new Set(Object.values(s.jobs).map(j=>j.snapshot.agentId)))await importHistory(store,{agentId,rows:[],complete:false,evidence:'sheet_read_failed'},now);throw error;}
 const state=await readState(store);
 if(!Array.isArray(snapshot.rows)||!Array.isArray(snapshot.headers)||fingerprint(snapshot.headers)!==fingerprint(HISTORY_HEADERS))throw Error('sheet_schema_changed');
 for(const cells of snapshot.rows){const receipt=state.sheetReceipts?.[cells[0]];if(receipt&&receipt.hash!==fingerprint(Object.fromEntries(HISTORY_HEADERS.map((h,i)=>[h,cells[i]??'']))))throw Error('sheet_receipt_changed');}
 const observed=Object.fromEntries(snapshot.rows.filter(r=>r.some(Boolean)).map(r=>[r[0],fingerprint(r)]));
 if(Object.entries(state.sheetObservation?.records||{}).some(([id,digest])=>observed[id]!==digest)){
  for(const agentId of new Set([...Object.values(state.jobs).map(j=>j.snapshot.agentId),...snapshot.rows.map(r=>r[1]).filter(Boolean)]))await importHistory(store,{agentId,rows:[],complete:false,evidence:'sheet_edits_require_reconciliation'},now);
  throw Error('sheet_edits_require_reconciliation');
 }
 // Reconciliation attestations originate from a separately verified provider/legacy
 // audit in trusted CAS state, never a sheet boolean or an empty-row inference.
 const agents=new Set([...Object.values(state.jobs).map(j=>j.snapshot.agentId),...snapshot.rows.map(r=>r[1]).filter(Boolean)]);
 const reports=[];
 for(const agentId of agents){
  const audit=state.historyAudits?.[agentId];
  const rows=snapshot.rows.filter(r=>r[1]===agentId);
  const imports={...snapshot,reconciliation:{[agentId]:{complete:audit?.complete===true&&Number.isFinite(audit.verifiedAt)&&audit.verifiedAt<=now&&Number.isFinite(audit.expiresAt)&&audit.expiresAt>now,evidence:audit?.evidence||'',expectedRecords:rows.length}}};
  try{const decoded=decodeHistory(imports,agentId);await importHistory(store,{agentId,rows:decoded.rows.filter(row=>{const own=state.jobs[row.id.replace(/:v\d+$/,'')];return !(own?.snapshot.agentId===agentId&&state.sheetReceipts?.[row.id]);}),complete:true,evidence:decoded.evidence},now);reports.push({agentId,status:'reconciled'});}
  catch{await importHistory(store,{agentId,rows:[],complete:false,evidence:'provider_legacy_audit_required'},now);reports.push({agentId,status:'history_unreconciled'});}
 }
 await mutate(store,s=>{s.sheetObservation={revision:snapshot.revision,at:now,rowCount:snapshot.rows.length,records:observed};});
 return {status:'sheet_read',rowCount:snapshot.rows.length,reports,deliveryEnabled:false};
}
export async function refreshSheetHistory(args){
 try{return await refreshSheetHistoryUnchecked(args);}
 catch(error){
  await mutate(args.store,s=>{
   for(const readiness of Object.values(s.historyReady))readiness.complete=false;
   for(const j of Object.values(s.jobs)){
    const modified=j.historyReconciled!==false||(!j.orderAttempt&&!j.orderId&&!j.sentAt&&j.status!=='HOLD');
    j.historyReconciled=false;
    if(!j.orderAttempt&&!j.orderId&&!j.sentAt){j.status='HOLD';j.error='history_unreconciled';j.approvedText=null;j.approval=null;}
    if(modified)changed(j,args.now??Date.now());
   }
  });
  throw error;
 }
}
export async function runCardHistory({store,sheet,enabled=CARD_HISTORY_PLAN.enabled,production=false,now=Date.now()}){
 if(!enabled||!production)return {status:'disabled',deliveryEnabled:false};
 // Never append while a past outcome is unknown; reconcile it first.
 const prior=(await readState(store)).sheetAppend;
 if(prior)return reconcileAppend({store,sheet});
 const read=await refreshSheetHistory({store,sheet,now});
 const write=await appendNext({store,sheet,now});
 return {...read,projection:write.status,deliveryEnabled:false};
}

// Presentation only: repetition checks still use every historical exact wording.
export function latestCardRecords(records){
 const groups=new Map();
 for(const record of records){
  const key=record.idempotency_key||record.record_id;
  const match=new RegExp('^(.+):v([1-9][0-9]*)$').exec(record.record_id);
  const version=match&&match[1]===key?Number(match[2]):0;
  if(!Number.isSafeInteger(version))throw Error('invalid_card_revision');
  const prior=groups.get(key);
  if(prior&&version===prior.version&&fingerprint(prior.record)!==fingerprint(record))throw Error('ambiguous_latest_card');
  if(!prior||version>prior.version)groups.set(key,{version,record});
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([,entry])=>entry.record);
}
