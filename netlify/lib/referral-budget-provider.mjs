// Server-only composition; no top-up or external notification capability.
function hold(reason){const e=Error(reason);e.beforeSubmission=true;e.holdReason=reason;return e;}
export function budgetedProvider({provider,budget,readAvailableCents,maxFeeCents,feeEvidence,verifiedActualFee=()=>null,amountCents=2500}){
 async function preflight(input){
  if(![500,1000,2500].includes(amountCents)||provider.purchaseIntent?.currency!=='USD'||provider.purchaseIntent?.amount!==amountCents/100||(input.amountCents!==undefined&&input.amountCents!==amountCents))return {ready:false,reason:'purchase-intent-mismatch'};
  const existing=await budget.status(input.externalId);if(existing&&['uncertain','issued'].includes(existing.state))return {ready:false,reason:'outcome-unverified',reconcile:true};
  if(!Number.isSafeInteger(maxFeeCents)||maxFeeCents<0||!feeEvidence)return {ready:false,reason:'funding-unverified'};
  let available;try{available=await readAvailableCents();}catch{return {ready:false,reason:'balance-unavailable'}}
  if(!Number.isSafeInteger(available)||available<0)return {ready:false,reason:'balance-unavailable'};
  if(available<amountCents+maxFeeCents)return {ready:false,reason:'insufficient-balance'};
  const r=await budget.reserve({externalId:input.externalId,amountCents,maxFeeCents,feeEvidence});
  if(!r.reserved)return {ready:false,reason:r.reason||'budget-held'};
  if(r.state!=='reserved')return {ready:false,reason:'outcome-unverified',reconcile:true};
  return {ready:true};
 }
 return {purchaseIntent:provider.purchaseIntent,preflight,lookup:provider.lookup.bind(provider),link:provider.link.bind(provider),
 async recordVerifiedReceipt(order){const fee=verifiedActualFee(order);await budget.issued({externalId:order.external_id,orderId:order.id,actualFeeCents:Number.isSafeInteger(fee)&&fee>=0?fee:null});},
 async releaseVerifiedAttempt({externalId,reference}){return budget.retryVerified({externalId,reference});},
 async create(input){
  const p=await preflight(input);if(!p.ready){if(p.reconcile)throw Error('Existing purchase attempt requires lookup-only reconciliation');throw hold(p.reason);}
  const attempt=await budget.attempted(input.externalId);
  if(!attempt.started){if(attempt.state==='budget-held')throw hold('budget-held');throw Error('Existing purchase attempt requires lookup-only reconciliation');}
  // Once attempted succeeds, every error is uncertain. Never relabel it no-submit.
  return provider.create(input);
 }};
}
