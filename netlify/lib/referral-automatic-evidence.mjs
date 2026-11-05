import {createHash} from 'node:crypto';
import {inspectionFacts} from './referral-hive.mjs';
import {customerHistory} from './referral-customer-history.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from './referral-service-catalog.mjs';
const norm=x=>String(x||'').trim().toLowerCase();
const hash=x=>createHash('sha256').update(x).digest('hex');
// Server-only adapters. All policy/history inputs must come from reviewed private
// sources, never a claim request or an inferred absence in a bounded search.
export function automaticQualifiedCaseReader({readHive,ledger,reviewStore,readCoverage,legacyLookup,readPriorReward,now=()=>Date.now(),maxEventPages=20}){
 return async useId=>{
  if(!/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(useId))throw Error('Invalid case identifier');
  const inspectionId=useId.slice(5),inspection=await readHive('inspections/'+encodeURIComponent(inspectionId));
  if(inspection?.id!==inspectionId)throw Error('Inspection response mismatch');
  if(typeof inspection.refunded!=='boolean'||typeof inspection.disputed!=='boolean')throw Error('Refund and dispute source state unverified');
  const facts=inspectionFacts(inspection,{serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS,now:now()});
  const snapshot=await ledger('codeSnapshot',{});
  if(!Array.isArray(snapshot?.codes)||!Array.isArray(snapshot.shares)||!Array.isArray(snapshot.uses))throw Error('Ledger snapshot incomplete');
  const owners=snapshot.codes.filter(c=>facts.codes.includes(c.Code)&&c['Assignment State']==='ASSIGNED'&&c['Hive State']==='VERIFIED');
  if(facts.codes.length!==1||owners.length!==1||!facts.clientId||!facts.clientEmail)throw Error('Exact code and customer required');
  const owner=owners[0],prior=snapshot.uses.filter(u=>u['Hive Inspection ID']===inspectionId);
  if(prior.length>1||prior.some(u=>u.Code!==owner.Code||String(u['Client ID'])!==facts.clientId))throw Error('Attribution changed');
  const consent=snapshot.shares.some(s=>s.Code===owner.Code&&norm(s['Referrer Email'])===norm(owner['Referrer Email'])&&s['Terms Version']==='2026-10-04-personal-share'&&Number.isFinite(Date.parse(s['Consent At']))&&Date.parse(s['Consent At'])<=Date.parse(facts.bookedAt));
  const policy=await readCoverage();
  const fresh=policy?.verified===true&&typeof policy.reference==='string'&&!!policy.reference.trim()&&Number.isFinite(Date.parse(policy.validUntil))&&Date.parse(policy.validUntil)>now();
  if(!fresh)throw Error('Source coverage not verified');
  const history=await customerHistory({read:readHive,email:facts.clientEmail,sourceContactIds:[facts.clientId],currentInspectionId:inspectionId,before:facts.bookedAt,coverage:policy.historyCoverage,legacyLookup});
  let storedEvent=null,pages=0;
  for await(const page of reviewStore.list({prefix:'review-events/',paginate:true})){
   if(++pages>maxEventPages)throw Error('Completion event scan incomplete');
   for(const blob of page.blobs){const event=await reviewStore.get(blob.key,{type:'json'});if(event?.inspectionId===inspectionId&&blob.key==='review-events/'+hash(event.organizationId+':'+event.templateId+':'+event.instanceId)&&(!storedEvent||event.receivedAt>storedEvent.receivedAt))storedEvent=event;}
  }
  const reward=await readPriorReward({useId,inspectionId,email:norm(facts.clientEmail),sourceContactIds:history.sourceContactIds||[facts.clientId],snapshot});
  // The separate authoritative reservation operation still enforces uniqueness
  // atomically. This read cannot replace that operation or promise global identity.
  const noPriorReward=reward?.verified===true&&reward.useId===useId&&reward.email===norm(facts.clientEmail)&&reward.clear===true&&typeof reward.reference==='string'&&!!reward.reference.trim();
  return {useId,identityInput:{email:facts.clientEmail,sourceContactIds:history.sourceContactIds||[facts.clientId]},storedEvent,facts:{inspectionId,sourceContactId:facts.clientId,clientEmail:facts.clientEmail,referrerId:owner['Referrer ID'],code:owner.Code,bookingCreatedAt:facts.bookedAt,bookingProvenanceVerified:policy.bookingCreatedAtVerified===true&&Date.parse(owner['Assigned At'])<Date.parse(facts.bookedAt),newCustomerVerified:history.newClient===true,consumerReferrerVerified:consent&&policy.consentDefinesConsumerEligibility===true,codeAssociationVerified:true,distinctPeopleVerified:norm(owner['Referrer Email'])!==norm(facts.clientEmail),fullyPaid:facts.paid,active:facts.canceled===false,noPriorRewardVerified:noPriorReward,serviceIds:facts.serviceIds,refundOrDispute:inspection.refunded===true||inspection.disputed===true}};
 };
}
