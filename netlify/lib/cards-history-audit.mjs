import {HISTORY_HEADERS} from './cards-history.mjs';
import {fingerprint} from './cards-core.mjs';
// Bind an independent provider/legacy audit to the exact reviewed baseline rows.
// Later, only journal-confirmed application appends can extend that baseline.
// Unknown user/imported edits must be reconciled, never waved through by counting
// whatever rows happen to exist in the latest read.
export function attachCardHistoryAudit({snapshot,state,now=Date.now()}){
 if(snapshot?.complete!==true||fingerprint(snapshot.headers)!==fingerprint(HISTORY_HEADERS)||!Array.isArray(snapshot.rows))throw Error('history_incomplete');
 const ids=new Set(),records=new Map();
 for(const cells of snapshot.rows){
  if(!Array.isArray(cells)||cells.length>HISTORY_HEADERS.length)throw Error('history_invalid_row');
  if(cells.every(v=>v===''||v==null))continue;
  const row=Object.fromEntries(HISTORY_HEADERS.map((h,i)=>[h,cells[i]??'']));
  if(typeof row.record_id!=='string'||!row.record_id||!row.hive_contact_id||ids.has(row.record_id))throw Error('history_identity_conflict');
  ids.add(row.record_id);records.set(row.record_id,{agentId:row.hive_contact_id,digest:fingerprint(row)});
 }
 for(const [id,receipt] of Object.entries(state.sheetReceipts||{})){
  const actual=records.get(id),agentId=receipt.agentId||state.jobs?.[id.replace(/:v\d+$/,'')]?.snapshot?.agentId;
  if(!actual||actual.digest!==receipt.hash||(agentId&&actual.agentId!==agentId))throw Error('history_receipt_changed');
 }
 const rawRecords=Object.fromEntries(snapshot.rows.filter(r=>r.some(Boolean)).map(r=>[r[0],fingerprint(r)]));
 if(Object.entries(state.sheetObservation?.records||{}).some(([id,digest])=>rawRecords[id]!==digest))throw Error('history_observation_changed');
 const reconciliation={};
 for(const [agentId,audit] of Object.entries(state.historyAudits||{})){
  let complete=audit.complete===true&&Number.isFinite(audit.verifiedAt)&&audit.verifiedAt<=now&&Number.isFinite(audit.expiresAt)&&audit.expiresAt>now&&typeof audit.evidence==='string'&&!!audit.evidence&&['provider','legacy'].every(k=>audit[k]?.complete===true&&typeof audit[k].evidence==='string'&&!!audit[k].evidence);
  const baseline=audit.baselineRecords;
  if(!baseline||Array.isArray(baseline)||typeof baseline!=='object'||!Number.isSafeInteger(audit.expectedRecords)||audit.expectedRecords!==Object.keys(baseline||{}).length)complete=false;
  const expected=new Map(Object.entries(baseline||{}));
  for(const [id,digest] of expected){const actual=records.get(id);if(actual?.agentId!==agentId||actual.digest!==digest)complete=false;}
  for(const [id,actual] of records)if(actual.agentId===agentId&&!expected.has(id)){
   const receipt=state.sheetReceipts?.[id];
   if(receipt?.hash!==actual.digest||typeof receipt.operationId!=='string'||!receipt.operationId)complete=false;
   else expected.set(id,actual.digest);
  }
  reconciliation[agentId]={...audit,complete,expectedRecords:expected.size};
 }
 return {...snapshot,reconciliation};
}
