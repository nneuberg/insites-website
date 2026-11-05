import {HISTORY_HEADERS,decodeHistory} from './cards-history.mjs';
import {readState,mutate,fingerprint,normalize} from './cards-core.mjs';
import {attachCardHistoryAudit} from './cards-history-audit.mjs';
// Audit only the two established card-history sources: the full Cardly account
// and the complete Sent Cards ledger. Never claim knowledge of off-system cards.
export async function auditAgentCardHistory({store,sheet,provider,agentId,recipient,now=Date.now()}){
 if(typeof agentId!=='string'||!agentId||!recipient?.firstName||provider?.mode!=='live')throw Error('history_audit_configuration_required');
 const snapshot=await sheet.readComplete(),before=await readState(store);
 const existing=attachCardHistoryAudit({snapshot,state:before,now});
 if(Object.values(before.jobs).some(j=>j.snapshot.agentId===agentId&&j.orderAttempt&&['SUBMITTING','UNKNOWN'].includes(j.status)))throw Error('history_outcome_unresolved');
 if(snapshot.complete!==true||snapshot.nextPageToken||!snapshot.revision||!snapshot.evidence||fingerprint(snapshot.headers)!==fingerprint(HISTORY_HEADERS))throw Error('history_incomplete');
 const all=snapshot.rows.filter(c=>c.some(v=>v!==''&&v!=null)).map(c=>Object.fromEntries(HISTORY_HEADERS.map((h,i)=>[h,c[i]??''])));
 if(new Set(all.map(r=>r.record_id)).size!==all.length||all.some(r=>!r.record_id||!r.hive_contact_id))throw Error('history_identity_conflict');
 const rows=all.filter(r=>r.hive_contact_id===agentId),aliases=new Set([normalize([recipient.firstName,recipient.lastName].filter(Boolean).join(' ')),...rows.map(r=>normalize(r.recipient_name)).filter(Boolean)]);
 const identityFingerprint=fingerprint({agentId,recipient,aliases:[...aliases].sort()});
 if(existing.reconciliation[agentId]?.complete===true&&existing.reconciliation[agentId].provider?.identityFingerprint===identityFingerprint)return {status:'audit_current'};
 const history=await provider.listOrders();
 if(history.complete!==true||history.testMode!==false||!Array.isArray(history.orders)||!history.evidence)throw Error('provider_history_incomplete');
 const matched=[];
 for(const order of history.orders){
  if(!order.id||!Array.isArray(order.items))throw Error('provider_history_incomplete');
  for(const item of order.items){
   if(typeof item.recipient?.name!=='string')throw Error('provider_history_incomplete');
   if(!aliases.has(normalize(item.recipient.name)))continue;
   if(order.items.length!==1||item.type!=='card'||item.quantity!==1)throw Error('provider_item_history_ambiguous');
   const tracked=rows.filter(r=>r.cardly_order_id===order.id);
   // Unknown text is a real blocker; the provider's order response has no text.
   // An old order cannot silently become an empty-history or generic-copy claim.
   if(order.status!=='paid'||!tracked.some(r=>['ORDERED','SENT','DELIVERED'].includes(r.status)&&r.evidence_reference&&(r.exact_sent_wording||r.exact_approved_wording)))throw Error('provider_wording_reconciliation_required');
   if(all.some(r=>r.cardly_order_id===order.id&&r.hive_contact_id!==agentId))throw Error('provider_identity_ambiguous');
   matched.push(order.id);
  }
 }
 for(const row of rows)if(['ORDERED','SENT','DELIVERED'].includes(row.status)&&(!row.cardly_order_id||!matched.includes(row.cardly_order_id)))throw Error('ledger_provider_order_unverified');
 const fresh=await sheet.readComplete();if(fresh.complete!==true||fresh.nextPageToken||fresh.revision!==snapshot.revision||fresh.evidence!==snapshot.evidence||fresh.version!==snapshot.version||fingerprint(fresh.headers)!==fingerprint(snapshot.headers)||fingerprint(fresh.rows)!==fingerprint(snapshot.rows))throw Error('history_changed_during_audit');
 const baselineRecords=Object.fromEntries(rows.map(r=>[r.record_id,fingerprint(r)]));
 const providerProof={complete:true,evidence:'cardly-full-history:'+history.evidence,identityFingerprint,matchedOrderIds:[...new Set(matched)].sort(),totalOrders:history.orders.length};
 const legacy={complete:true,evidence:'sent-cards-ledger:'+fingerprint({revision:snapshot.revision,rows}),scope:'complete_sent_cards_ledger'};
 const audit={complete:true,expectedRecords:rows.length,baselineRecords,provider:providerProof,legacy,verifiedAt:now,expiresAt:now+24*3600000};audit.evidence=fingerprint(audit);
 // Reuse the strict status/text decoder before certifying this audit.
 decodeHistory({...snapshot,reconciliation:{[agentId]:audit}},agentId);
 await mutate(store,s=>{
  if(Object.values(s.jobs).some(j=>j.snapshot.agentId===agentId&&j.orderAttempt&&['SUBMITTING','UNKNOWN'].includes(j.status)))throw Error('history_outcome_unresolved');
  s.historyAudits??={};s.historyAudits[agentId]=audit;return {status:'audited'};
 });
 return {status:'audited',recordCount:rows.length,matchedOrderCount:providerProof.matchedOrderIds.length};
}
