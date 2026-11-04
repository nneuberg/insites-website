// LOCAL ONLY. Both programs share this single strongly-consistent CAS document.
// Never reset this ledger, separate programs into keys, or release uncertain orders.
const KEY='reward-budget/referral-usd-v1',CAP=20000;
const cents=v=>Number.isSafeInteger(v)&&v>=0;
const validIntent=(id,amount)=>/^insites-referral-[a-f0-9]{64}$/.test(id||'')?amount===2500:/^insites-realtor-[a-f0-9]{64}$/.test(id||'')&&[500,1000,2500].includes(amount);
export function easternMonth(at){const d=new Date(at);if(!Number.isFinite(d.getTime()))throw Error('Budget time required');const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}
const used=(s,month,except)=>Object.entries(s.reservations).filter(([id,r])=>id!==except&&r.month===month&&r.state!=='released').reduce((sum,[,r])=>sum+(r.actualCents??r.reservedCents),s.legacy?.[month]?.spentCents??0);
function blocked(s,month,requireLegacy){
 if(Object.values(s.reservations).some(r=>r.settlementMonthUnverified===true))return 'settlement-month-reconciliation-required';
 if(requireLegacy&&!s.legacy?.[month])return 'legacy-reconciliation-required';
 if(Object.values(s.reservations).some(r=>r.feeOverrun))return 'fee-overrun-reconciliation-required';
 if(Object.values(s.reservations).some(r=>r.state==='uncertain'&&r.month!==month))return 'prior-month-outcome-unverified';
 return null;
}
export function rewardBudget({store,now=()=>Date.now(),requireLegacyReconciliation=false}){
 async function change(fn){for(let n=0;n<64;n++){
  const old=await store.getWithMetadata(KEY,{type:'json'}),state=old?structuredClone(old.data):{version:1,reservations:{}};
  if(state.version!==1||!state.reservations||typeof state.reservations!=='object'||Array.isArray(state.reservations))throw Error('Budget state invalid');
  for(const [id,r] of Object.entries(state.reservations))if(!r||!validIntent(id,r.amountCents)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||!cents(r.maxFeeCents)||r.reservedCents!==r.amountCents+r.maxFeeCents||!['reserved','uncertain','issued','released'].includes(r.state)||(r.actualCents!==undefined&&(!cents(r.actualCents)||r.actualCents<r.amountCents||r.state!=='issued')))throw Error('Budget reservation corrupt');
  if(state.legacy!==undefined){if(!state.legacy||typeof state.legacy!=='object'||Array.isArray(state.legacy))throw Error('Legacy budget state invalid');for(const [month,r] of Object.entries(state.legacy))if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!cents(r.spentCents)||r.writersDisabled!==true||typeof r.reference!=='string'||!r.reference.trim())throw Error('Legacy budget state invalid');}
  const result=fn(state);if(!result.write)return result.value;
  const saved=await store.setJSON(KEY,state,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(saved.modified)return result.value;
 }throw Error('Budget busy; no provider call permitted');}
 return {
 async status(externalId){return change(s=>({write:false,value:s.reservations[externalId]?{state:s.reservations[externalId].state,month:s.reservations[externalId].month}:null}));},
 // Private verified import: spent includes all legacy principal AND fees, with
 // in-flight legacy purchases resolved and legacy writers disabled externally.
 async reconcileLegacy({month,spentCents,writersDisabled,outstandingResolved,reference}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||!cents(spentCents)||writersDisabled!==true||outstandingResolved!==true||typeof reference!=='string'||!reference.trim())throw Error('Verified legacy reconciliation required');
  return change(s=>{s.legacy??={};const old=s.legacy[month];if(old){if(old.spentCents!==spentCents||old.reference!==reference)throw Error('Conflicting legacy reconciliation');return {write:false,value:{reconciled:true,replayed:true}};}s.legacy[month]={spentCents,writersDisabled:true,reference};return {write:true,value:{reconciled:true}};});
 },
 async reserve({externalId,amountCents=2500,maxFeeCents,feeEvidence}){
  if(!validIntent(externalId,amountCents)||!cents(maxFeeCents)||maxFeeCents>CAP||typeof feeEvidence!=='string'||!feeEvidence.trim())throw Error('Verified bounded fee and immutable reward intent required');
  return change(state=>{const old=state.reservations[externalId];if(old){if(old.amountCents!==amountCents||old.maxFeeCents!==maxFeeCents)throw Error('Budget intent changed');return {write:false,value:{reserved:old.state!=='released',state:old.state,month:old.month,replayed:true}};}
   const month=easternMonth(now()),reason=blocked(state,month,requireLegacyReconciliation);if(reason)return {write:false,value:{reserved:false,state:'budget-held',reason,month}};
   const total=used(state,month),reservedCents=amountCents+maxFeeCents;
   if(total+reservedCents>CAP)return {write:false,value:{reserved:false,state:'budget-held',month,remainingCents:Math.max(0,CAP-total)}};
   state.reservations[externalId]={month,amountCents,maxFeeCents,reservedCents,feeEvidence,state:'reserved',createdAt:now()};return {write:true,value:{reserved:true,state:'reserved',month}};
  });
 },
 async attempted(externalId){return change(s=>{const r=s.reservations[externalId];if(!r||r.state==='released')throw Error('Budget reservation required');if(r.state!=='reserved')return {write:false,value:{state:r.state,started:false}};const month=easternMonth(now()),reason=blocked(s,month,requireLegacyReconciliation);if(reason)return {write:false,value:{state:'budget-held',started:false,reason}};if(used(s,month,externalId)+r.reservedCents>CAP)return {write:false,value:{state:'budget-held',started:false,reason:'monthly-cap-exceeded'}};if(r.month!==month){r.previousMonth=r.month;r.month=month;}r.state='uncertain';r.attemptedAt=now();return {write:true,value:{state:r.state,started:true}};});},
 async issued({externalId,orderId,actualFeeCents}){if(typeof orderId!=='string'||!orderId.trim()||(actualFeeCents!==null&&!cents(actualFeeCents)))throw Error('Verified receipt and fees required');return change(s=>{const r=s.reservations[externalId];if(!r||!['uncertain','issued'].includes(r.state))throw Error('Attempted budget reservation required');const actual=actualFeeCents===null?r.reservedCents:r.amountCents+actualFeeCents;if(!cents(actual))throw Error('Receipt amount outside safe cents range');if(r.orderId){if(r.orderId!==orderId||r.actualCents!==actual)throw Error('Conflicting budget receipt');return {write:false,value:{state:r.state}};}r.orderId=orderId;r.actualCents=actual;r.state='issued';if(easternMonth(now())!==r.month){r.settlementMonthUnverified=true;r.receiptObservedMonth=easternMonth(now());}r.feeOverrun=actual>r.reservedCents;return {write:true,value:{state:r.state,feeOverrun:r.feeOverrun}};});},
 async retryVerified({externalId,reference}){if(typeof reference!=='string'||!reference.trim())throw Error('Verified non-submission reference required');return change(s=>{const r=s.reservations[externalId];if(r&&!r.orderId&&r.state==='reserved'&&r.recoveryEvidence===reference)return {write:false,value:{reserved:true,replayed:true}};if(!r||r.orderId||r.state!=='uncertain')throw Error('Budget retry not eligible');r.state='reserved';r.recoveryEvidence=reference;return {write:true,value:{reserved:true}};});},
 async release({externalId,providerNeverSubmitted,reference}){if(providerNeverSubmitted!==true||typeof reference!=='string'||!reference.trim())throw Error('Verified non-submission evidence required');return change(s=>{const r=s.reservations[externalId];if(!r||r.orderId)throw Error('Cannot release issued or unknown reservation');if(r.state==='released')return {write:false,value:{released:false}};r.state='released';r.releaseEvidence=reference;r.releasedAt=now();return {write:true,value:{released:true}};});}
 };
}
