import {readState,mutate,fingerprint,hash,qualification,reviewFingerprint,changed} from './cards-core.mjs';
import {randomUUID} from 'node:crypto';
import {buildOrderBody,verifyCardlyOrder} from './cardly-provider.mjs';
// Credential presence never activates sending. Both explicit deployment flags and
// an owner-approved, current per-card quote are required by the runtime caller.
export const CARD_DELIVERY_PLAN=Object.freeze({enabled:false,version:'owner-approved-provider-v1',maxCreditsPerCard:1});
function eligible(state,job,now){
 if(!job||job.status!=='APPROVED'||job.orderAttempt||job.orderId||job.sentAt||!job.approval)throw Error('owner_approval_required');
 if(qualification(job.snapshot,job.snapshot.organizationId)||job.historyReconciled!==true||state.historyReady[hash(job.snapshot.agentId)]?.complete!==true)throw Error('qualification_required');
 const office=state.offices?.[hash(job.snapshot.agentId)];
 if(!job.snapshot.officeHash||office?.officeHash!==job.snapshot.officeHash||office.doNotMail!==false||!Number.isFinite(office.verifiedAt)||office.verifiedAt>now||now-office.verifiedAt>30*86400000)throw Error('office_review_required');
 if(job.approval.fingerprint!==reviewFingerprint(job,job.approvedText,job.approval.artwork))throw Error('approval_changed');
 if(Object.values(state.jobs).some(j=>j.id!==job.id&&j.status!=='SUPERSEDED'&&j.snapshot.organizationId===job.snapshot.organizationId&&j.snapshot.inspectionId===job.snapshot.inspectionId&&(j.orderAttempt||j.orderId||j.snapshot.agentId!==job.snapshot.agentId)))throw Error('inspection_conflict');
 if(state.dispatchFlight)throw Error('dispatch_reconciliation_required');
 return buildOrderBody(job);
}
async function verifyCurrentSource(job,source){
 if(!source||!job.snapshot.sourceRecords)throw Error('source_verification_required');
 const inspection=await source.getInspection(job.snapshot.inspectionId),contact=await source.getContact(job.snapshot.agentId);
 if(fingerprint({inspection,contact})!==job.snapshot.sourceRecords)throw Error('source_changed');
}
export async function prepareCardQuote({store,source,provider,jobId,revision,now=Date.now()}){
 const state=await readState(store),job=state.jobs[jobId];if(job?.revision!==revision)throw Error('stale_revision');
 const body=eligible(state,job,now);await verifyCurrentSource(job,source);
 const result=await provider.preview(body.lines[0],body.purchaseOrderNumber),quote=result.data?.order;
 if(provider.mode!=='live'||result.testMode!==false||!Number.isFinite(quote?.creditCost)||quote.creditCost<=0||quote.creditCost>CARD_DELIVERY_PLAN.maxCreditsPerCard||Number(quote.giftCreditCost||0)!==0||!Number.isFinite(result.data.balance)||result.data.balance<quote.creditCost)throw Error('funding_or_quote_requires_review');
 const preview=result.data.preview;let previewURL;try{previewURL=new URL(preview?.urls?.card);}catch{throw Error('preview_verification_required');}
 if(preview?.format!=='pdf'||previewURL.protocol!=='https:'||previewURL.username||previewURL.password||previewURL.port||!(previewURL.hostname==='api.card.ly'||previewURL.hostname.endsWith('.cardly.net')))throw Error('preview_verification_required');
 const expires=Date.parse(preview.expires);if(!Number.isFinite(expires)||expires<=now)throw Error('preview_expired');
 const prepared={jobId,revision,approvalFingerprint:job.approval.fingerprint,bodyHash:fingerprint(body),credits:quote.creditCost,paymentType:'prepaid_cardly_credits',shippingMethod:'standard',recipientFingerprint:fingerprint(job.snapshot.recipient),preparedAt:now,expiresAt:Math.min(expires,now+15*60000),preview:preview.urls.card,delivery:quote.delivery||null};
 const quoteFingerprint=fingerprint(prepared);
 await mutate(store,s=>{const j=s.jobs[jobId];if(j?.revision!==revision||j.orderAttempt)throw Error('quote_job_changed');eligible(s,j,now);j.dispatchQuote={...prepared,quoteFingerprint};});
 return {...prepared,quoteFingerprint,ownerConfirmationRequired:true};
}
const receiptRank={ORDERED:1,SENT:2,DELIVERED:3};
// Only immutable submission fields identify an attempt. Response diagnostics may
// arrive later and must not make a legitimate read-only receipt appear unrelated.
const attemptFingerprint=a=>fingerprint(a?Object.fromEntries(['attemptId','requestBody','bodyHash','approvalFingerprint','idempotencyKey','externalOrderNumber','maxCredits','submittedAt','testMode','quoteFingerprint'].map(k=>[k,a[k]??null])):null);
const currentResult=j=>({status:j.status,orderId:j.orderId,credits:j.creditCost});
const sameAttempt=(j,attempt)=>j?.orderAttempt&&attemptFingerprint(j.orderAttempt)===attemptFingerprint(attempt);
// Transport request IDs, observation times and their derived evidence hashes are
// not new mailing facts. Keep the first durable proof for equivalent observations.
const receiptIdentity=r=>fingerprint(Object.fromEntries(['orderId','externalOrderNumber','idempotencyKey','exactText','textProvenance','recipientFingerprint','approvalFingerprint','orderedAt','credits'].map(k=>[k,r[k]??null]).concat([['itemId',r.proof?.itemId??null],['bodyHash',r.proof?.bodyHash??null]])));
const receiptSemantics=r=>fingerprint([receiptIdentity(r),r.status,r.sentAt??null,r.deliveredAt??null]);
function clearOwnFlight(s,jobId,attempt){
 const f=s.dispatchFlight;if(f?.jobId===jobId&&f.bodyHash===attempt.bodyHash&&(!f.attemptFingerprint||f.attemptFingerprint===attemptFingerprint(attempt)))s.dispatchFlight=null;
}
async function authoritativeResult(store,jobId,attempt,fallback){
 const j=(await readState(store)).jobs[jobId];
 if(!sameAttempt(j,attempt))return {status:'provider_reconcile_required',requiresReconciliation:true};
 return receiptRank[j.status]?currentResult(j):fallback;
}
async function settleReceipt({store,jobId,attempt,order,requestId,now}){
 // Validate against the CURRENT job inside the same CAS that saves lifecycle,
 // evidence, credits and flight state. A CAS retry revalidates the entire receipt.
 const result=await mutate(store,s=>{
  const j=s.jobs[jobId];if(!sameAttempt(j,attempt))throw Error('receipt_attempt_changed');
  const receipt=verifyCardlyOrder({job:j,attempt:j.orderAttempt,order,requestId,now});
  if(j.orderId&&j.orderId!==receipt.orderId)throw Error('receipt_order_changed');
  const currentRank=receiptRank[j.status]||0,nextRank=receiptRank[receipt.status]||0;
  if(j.creditCost!=null&&j.creditCost!==receipt.credits||j.providerReceipt&&receiptIdentity(j.providerReceipt)!==receiptIdentity(receipt))throw Error('receipt_facts_changed');
  if(j.orderedAt!=null&&j.orderedAt!==receipt.orderedAt||j.sentAt!=null&&receipt.sentAt!=null&&j.sentAt!==receipt.sentAt)throw Error('receipt_timing_changed');
  if(currentRank>nextRank)return {unchanged:true,...currentResult(j)};
  if(currentRank===nextRank&&j.providerReceipt){
   if(receiptSemantics(j.providerReceipt)!==receiptSemantics(receipt))throw Error('receipt_facts_changed');
   return {unchanged:true,...currentResult(j)};
  }
  Object.assign(j,{orderId:receipt.orderId,status:receipt.status,orderedAt:receipt.orderedAt,receiptEvidence:receipt.evidence,providerReceipt:{...receipt,observedAt:now},creditCost:receipt.credits,error:null});
  if(receipt.status==='SENT'){j.sentText=receipt.exactText;j.sentAt=receipt.sentAt;}
  changed(j,now);clearOwnFlight(s,jobId,attempt);return currentResult(j);
 });
 return authoritativeResult(store,jobId,attempt,result);
}
async function recordAttemptFailure({store,jobId,attempt,rejected=false,receiptFailure=false,now}){
 const result=await mutate(store,s=>{
  const j=s.jobs[jobId];if(!sameAttempt(j,attempt))return {unchanged:true,status:'provider_reconcile_required',requiresReconciliation:true};
  // A late HTTP error is not evidence against an already verified order/shipment.
  if(receiptRank[j.status]||j.orderId||j.sentAt)return {unchanged:true,...currentResult(j)};
  if(j.status==='FAILED')return {unchanged:true,status:'FAILED',requiresReconciliation:false};
  j.status=rejected?'FAILED':'UNKNOWN';j.error=rejected?'provider_rejected':receiptFailure?'provider_receipt_requires_reconciliation':'provider_outcome_unknown';
  j.orderAttempt.outcome=rejected?'not_applied':'unknown';changed(j,now);
  if(rejected)clearOwnFlight(s,jobId,attempt);
  return {status:j.status,requiresReconciliation:!rejected};
 });
 return authoritativeResult(store,jobId,attempt,result);
}
export async function dispatchApprovedCard({store,source,provider,jobId,revision,quoteFingerprint,enabled=CARD_DELIVERY_PLAN.enabled,production=false,now=Date.now()}){
 if(enabled!==true||production!==true||provider?.mode!=='live')return {status:'disabled',deliveryEnabled:false};
 // Preview is not a price cap. The trusted adapter must prove provider-enforced
 // price/quote binding; credential presence and an owner quote are insufficient.
 if(provider.orderPriceBindingVerified!==true)return {status:'provider_spend_guard_required',deliveryEnabled:false};
 const state=await readState(store),job=state.jobs[jobId];if(job?.revision!==revision)throw Error('stale_revision');
 eligible(state,job,now);await verifyCurrentSource(job,source);
 const claimed=await mutate(store,s=>{
  const j=s.jobs[jobId];if(j?.revision!==revision)throw Error('stale_revision');
  const body=eligible(s,j,now),q=j.dispatchQuote;
  if(!q)throw Error('quote_requires_confirmation');
  const {quoteFingerprint:storedFingerprint,...quoteFields}=q;
  if(storedFingerprint!==quoteFingerprint||storedFingerprint!==fingerprint(quoteFields)||q.revision!==revision||q.bodyHash!==fingerprint(body)||q.approvalFingerprint!==j.approval.fingerprint||!Number.isFinite(q.expiresAt)||q.expiresAt<=now||!Number.isFinite(q.preparedAt)||q.preparedAt>now||q.expiresAt-q.preparedAt>15*60000||!Number.isFinite(q.credits)||q.credits<=0||q.credits>CARD_DELIVERY_PLAN.maxCreditsPerCard)throw Error('quote_requires_confirmation');
  const attempt={attemptId:randomUUID(),requestBody:body,bodyHash:fingerprint(body),approvalFingerprint:j.approval.fingerprint,idempotencyKey:j.idempotencyKey,externalOrderNumber:j.externalOrderNumber,maxCredits:q.credits,submittedAt:now,testMode:false,quoteFingerprint};
  j.orderAttempt=attempt;j.status='SUBMITTING';changed(j,now);s.dispatchFlight={jobId,bodyHash:attempt.bodyHash,attemptFingerprint:attemptFingerprint(attempt),at:now};return {attempt};
 });
 // From here every uncertain result stays quarantined. Never repeat a POST based
 // only on a timeout, a missing order lookup, or a cleared/expired process lease.
 let result;
 try{result=await provider.place({body:claimed.attempt.requestBody,idempotencyKey:claimed.attempt.idempotencyKey});}
 catch(error){
  const rejected=error?.outcome==='not_applied';
  return recordAttemptFailure({store,jobId,attempt:claimed.attempt,rejected,now:Date.now()});
 }
 try{
  if(result.testMode!==false)throw Error('provider_test_response');
  // Persist the returned ID before validating all fields, so an anomalous paid
  // response remains findable and cannot be lost or mistaken for a safe retry.
  await mutate(store,s=>{const j=s.jobs[jobId];if(!sameAttempt(j,claimed.attempt))throw Error('receipt_attempt_changed');if(receiptRank[j.status]||j.orderId)return {unchanged:true};const id=typeof result.data?.order?.id==='string'?result.data.order.id:null;if(j.orderAttempt.responseOrderId&&id!==j.orderAttempt.responseOrderId)throw Error('response_order_changed');j.orderAttempt.responseOrderId=id;j.orderAttempt.requestId=result.requestId||null;});
  return await settleReceipt({store,jobId,attempt:claimed.attempt,order:result.data?.order,requestId:result.requestId,now:Date.now()});
 }catch(error){
  if(['receipt_facts_changed','receipt_timing_changed','receipt_order_changed'].includes(error?.message))return {status:'provider_reconcile_required',requiresReconciliation:true};
  return recordAttemptFailure({store,jobId,attempt:claimed.attempt,receiptFailure:true,now:Date.now()});
 }
}
export async function reconcileCardOrder({store,provider,jobId,now=Date.now()}){
 const job=(await readState(store)).jobs[jobId];if(!job?.orderAttempt||provider.mode!=='live')throw Error('order_attempt_required');
 let order,requestId;
 try{
  const id=job.orderId||job.orderAttempt.responseOrderId;
  if(id){const found=await provider.getOrder(id);if(found.testMode!==false)throw Error('test_receipt');order=found.data;requestId=found.requestId;}
  else{
   const history=await provider.listOrders();if(history.complete!==true||history.testMode!==false)throw Error('history_incomplete');
   const matches=history.orders.filter(o=>o.customer?.purchaseOrderNo===job.externalOrderNumber);
   if(matches.length!==1)return {status:'provider_reconcile_required'};
   order=matches[0];
  }
  return await settleReceipt({store,jobId,attempt:job.orderAttempt,order,requestId,now});
 }catch{return {status:'provider_reconcile_required'};}
}
// One read-only provider lookup per scheduled tick, with a durable fair cursor.
// An older unshipped order cannot permanently starve newer uncertain receipts.
export async function runCardReceiptWorker({store,provider,enabled=false,now=Date.now()}){
 if(enabled!==true)return {status:'disabled'};
 const selected=await mutate(store,s=>{
  const ids=Object.values(s.jobs).filter(j=>j.orderAttempt&&['SUBMITTING','UNKNOWN','ORDERED'].includes(j.status)).map(j=>j.id).sort();
  if(!ids.length)return {unchanged:true,status:'idle'};
  const after=s.cardReceiptCursor?.after;
  const jobId=ids.find(id=>typeof after==='string'&&id>after)||ids[0];
  s.cardReceiptCursor={after:jobId};return {jobId};
 });
 if(!selected.jobId)return selected;
 return reconcileCardOrder({store,provider:provider(),jobId:selected.jobId,now});
}
