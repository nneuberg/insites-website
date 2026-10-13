import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const fingerprint=x=>hash(JSON.stringify(canonical(x)));
// Deliberately conservative: punctuation, whitespace and case cannot evade exact detection.
export const normalize=t=>String(t).normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ').match(/[\p{L}\p{N}_]+/gu)?.join(' ')||'';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const authenticate=(header,expected)=>typeof header==='string'&&header.startsWith('Bearer ')&&header.length>=39&&/^[a-f0-9]{64}$/.test(expected||'')&&equal(hash(header.slice(7)),expected);
export function verifyHive(raw,header,secret,now=Date.now()){
 if(!secret||!Buffer.isBuffer(raw)||raw.length>262144||typeof header!=='string')return false;
 const m=/^t=(\d+),v1=([a-fA-F0-9]{64})$/.exec(header);if(!m||Math.abs(now/1000-Number(m[1]))>300)return false;
 const expected=createHmac('sha256',secret).update(m[1]+'.').update(raw).digest('hex');return equal(expected,m[2].toLowerCase());
}
const initial=()=>({schema:1,revision:0,events:{},jobs:{},history:{},historyReady:{},audit:[]});
// All related indexes live in ONE private CAS object; no multi-key pseudo-transactions.
// Bounded draft scale: hold at 1MB rather than silently dropping history/identity records.
export async function mutate(store,change){
 for(let i=0;i<8;i++){
  const previous=await store.getWithMetadata('state',{type:'json'});
  const state=previous?structuredClone(previous.data):initial();if(state.schema!==1)throw Error('invalid_state');
  const result=change(state);if(result?.unchanged)return result;
  state.revision++;if(Buffer.byteLength(JSON.stringify(state))>1000000)throw Error('capacity_hold');
  const saved=await store.setJSON('state',state,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(saved.modified)return result;
 }throw Error('concurrent_retry');
}
export async function receive({store,raw,signature,instance,env,now=Date.now()}){
 if(!env.HIVE_CARD_EVENT||!env.HIVE_CARD_ORGANIZATION_ID||!env.HIVE_CARD_WEBHOOK_SECRET)return {code:503,status:'configuration_required'};
 if(!verifyHive(raw,signature,env.HIVE_CARD_WEBHOOK_SECRET,now))return {code:401,status:'invalid_signature'};
 let event;try{event=JSON.parse(raw)}catch{return {code:400,status:'invalid_json'}};
 if(!event||typeof event.automation_instance_id!=='string'||!event.automation_instance_id||event.automation_instance_id!==instance||event.event!==env.HIVE_CARD_EVENT||event.organization?.id!==env.HIVE_CARD_ORGANIZATION_ID)return {code:400,status:'invalid_envelope'};
 const id=hash(instance),bodyHash=hash(raw);
 return mutate(store,s=>{
  const old=s.events[id];if(old)return {unchanged:true,code:old.bodyHash===bodyHash?200:409,status:old.bodyHash===bodyHash?'duplicate':'payload_conflict'};
  s.events[id]={id,instance,bodyHash,event,receivedAt:now,status:'QUEUED'};
  return {code:202,status:'queued',eventId:id};
 });
}
export function qualification(s,organization){
 if(s?.organizationId!==organization)return 'organization_mismatch';
 if(![s.inspectionId,s.agentId,s.agencyId,s.recipient?.firstName].every(v=>typeof v==='string'&&v.trim()))return 'missing_identity';
 if(s.completionVerified!==true)return 'completion_unverified';
 if(s.contactMatchCount!==1||s.agencyMatchCount!==1)return 'identity_ambiguous';
 if(s.usesAgencyAddress!==true)return 'office_link_unverified';
 if(s.addressVerified!==true||!s.addressEvidence)return 'address_unverified';
 if(s.doNotMail!==false||!s.suppressionEvidence)return 'suppression_unknown';
 if(!['address','city','region','postcode','country'].every(k=>typeof s.recipient[k]==='string'&&s.recipient[k].trim()))return 'address_incomplete';
 if(!/^[A-Z]{2}$/.test(s.recipient.country))return 'country_invalid';
 return null;
}
function officeQualification(s,snapshot,now){if(!snapshot.officeHash)return null;const a=s.offices?.[hash(snapshot.agentId)];return !a||a.officeHash!==snapshot.officeHash||a.doNotMail!==false||a.verifiedAt>now||now-a.verifiedAt>30*86400000?'office_review_required':null;}
const grams=t=>new Set(Array.from({length:Math.max(0,t.length-2)},(_,i)=>t.slice(i,i+3)));
export function similar(a,b){
 if(a===b)return true;const x=grams(a),y=grams(b);if(!x.size||!y.size)return false;
 return 2*[...x].filter(g=>y.has(g)).length/(x.size+y.size)>=.82;
}
const distinct=(s,agent,text,jobId)=>typeof text==='string'&&text.length<=1000&&normalize(text)&&!(s.history[hash(agent)]||[]).some(r=>r.jobId!==jobId&&similar(normalize(text),r.normalized));
function reserve(s,agent,text,jobId){const key=hash(agent);s.history[key]??=[];if(!s.history[key].some(r=>r.normalized===normalize(text)&&r.jobId===jobId))s.history[key].push({jobId,text,normalized:normalize(text),sha256:hash(normalize(text))});}
const audit=(s,id,action,now)=>s.audit.push({id,action,at:now,actor:'owner'});
export const changed=(job,now)=>{job.revision++;job.updatedAt=now;job.projectionPending=true;};
const revoke=job=>{job.approvedText=null;job.approval=null;};
export async function importHistory(store,{agentId,rows,complete,evidence},now=Date.now()){
 if(!agentId||!Array.isArray(rows)||rows.length>5000||!evidence)throw Error('invalid_history');
 return mutate(store,s=>{
  for(const row of rows){if(!row.id||typeof row.text!=='string'||!normalize(row.text)||row.text.length>1000)throw Error('invalid_history_row');
   const own=s.jobs[row.id];const self=own?.snapshot.agentId===agentId&&[own.draftText,own.approvedText,own.sentText].includes(row.text)?own.id:null;
   for(const j of Object.values(s.jobs))if(j.id!==self&&j.snapshot.agentId===agentId&&[j.draftText,j.approvedText].filter(Boolean).some(t=>similar(normalize(t),normalize(row.text)))){j.status='HOLD';j.error='late_history_collision';revoke(j);changed(j,now);}
   reserve(s,agentId,row.text,self||'history:'+row.id);
  }
  for(const j of Object.values(s.jobs))if(j.snapshot.agentId===agentId){j.historyReconciled=complete===true;if(!complete){j.status='HOLD';j.error='history_unreconciled';revoke(j);}changed(j,now);}
  s.historyReady[hash(agentId)]={complete:complete===true,evidence,at:now};audit(s,agentId,'history_import',now);return {status:'history_recorded'};
 });
}
export async function stage(store,{eventId,snapshot,candidates,organization},now=Date.now()){
 return mutate(store,s=>{
  const event=s.events[eventId];if(!event)throw Error('event_missing');
  if(!Array.isArray(candidates))throw Error('invalid_candidates');
  if(!snapshot?.inspectionId||!snapshot?.agentId)throw Error('stable_ids_required');
  const id=fingerprint([organization,snapshot.inspectionId,snapshot.agentId,'thank-you-v1']);
  if(s.jobs[id]){
   const j=s.jobs[id];event.status='DONE';event.jobId=id;if(j.status==='SUPERSEDED')return {status:'superseded',jobId:id};
   if(fingerprint(j.snapshot)!==fingerprint(snapshot)){
    j.priorSnapshots??=[];j.priorSnapshots.push({revision:j.revision,snapshot:j.snapshot,status:j.status,error:j.error,approval:j.approval,draftText:j.draftText});
    j.snapshot=structuredClone(snapshot);j.status='HOLD';j.error=qualification(snapshot,organization)||'snapshot_changed_review_required';revoke(j);changed(j,now);audit(s,id,'snapshot_changed_approval_revoked',now);
    return {status:'HOLD',jobId:id};
   }
   return {status:'duplicate',jobId:id};
  }
  let reason=qualification(snapshot,organization)||officeQualification(s,snapshot,now);
  if(!s.historyReady[hash(snapshot.agentId)]?.complete)reason='history_unreconciled';
  for(const j of Object.values(s.jobs))if(j.snapshot.organizationId===organization&&j.snapshot.inspectionId===snapshot.inspectionId&&j.snapshot.agentId!==snapshot.agentId){reason='changed_agent_manual_review';j.status='HOLD';j.error=reason;revoke(j);changed(j,now);audit(s,j.id,'agent_changed_approval_revoked',now);} 
  const draft=reason?null:candidates.slice(0,3).find(t=>distinct(s,snapshot.agentId,t,id))||null;
  if(draft)reserve(s,snapshot.agentId,draft,id);
  s.jobs[id]={id,eventId,automationInstanceId:event.instance,historyReconciled:s.historyReady[hash(snapshot.agentId)]?.complete===true,snapshot:structuredClone(snapshot),status:reason?'HOLD':draft?'AWAITING_APPROVAL':'MANUAL_REVIEW',error:reason||(!draft?'copy_exhausted':null),draftText:draft,approvedText:null,sentText:null,sentAt:null,approval:null,revision:1,createdAt:now,updatedAt:now,projectionPending:true,idempotencyKey:id,externalOrderNumber:'insites-'+id};
  event.status='DONE';event.jobId=id;audit(s,id,'staged',now);return {status:s.jobs[id].status,jobId:id};
 });
}
export const reviewFingerprint=(job,text,artwork)=>fingerprint({id:job.id,snapshot:job.snapshot,text,artwork});
export async function review(store,{jobId,revision,text,artwork,reviewedFingerprint,approve},now=Date.now()){
 return mutate(store,s=>{
  const j=s.jobs[jobId];if(!j||!['AWAITING_APPROVAL','APPROVED','MANUAL_REVIEW'].includes(j.status))throw Error('not_reviewable');
  if(j.revision!==revision)throw Error('stale_revision');
  if(qualification(j.snapshot,j.snapshot.organizationId)||officeQualification(s,j.snapshot,now)||!s.historyReady[hash(j.snapshot.agentId)]?.complete)throw Error('qualification_changed');
  if(!distinct(s,j.snapshot.agentId,text,jobId))throw Error('copy_collision');
  if(approve&&(!artwork?.id||!artwork?.revision||!artwork?.templateId||!Number.isInteger(artwork?.messagePage)||artwork.messagePage<1||!equal(reviewFingerprint(j,text,artwork),reviewedFingerprint)))throw Error('review_changed');
  reserve(s,j.snapshot.agentId,text,jobId);revoke(j);
  if(approve){j.approvedText=text;j.approval={by:'Neal',at:now,artwork:structuredClone(artwork),fingerprint:reviewedFingerprint};j.status='APPROVED';}
  else{j.draftText=text;j.status='AWAITING_APPROVAL';}
  changed(j,now);audit(s,jobId,approve?'approved':'edited_approval_revoked',now);return {status:j.status,deliveryEnabled:false};
 });
}
export async function readState(store){return (await store.getWithMetadata('state',{type:'json'}))?.data||initial();}
export async function acknowledge(store,{jobId,revision,projectionToken},now=Date.now()){
 return mutate(store,s=>{
  const lease=s.projectionLease;
  if(!lease||typeof projectionToken!=='string'||!projectionToken||lease.token!==projectionToken||lease.jobId!==jobId||lease.revision!==revision||!Number.isFinite(lease.until)||lease.until<=now)throw Error('projection_lease_mismatch');
  const j=s.jobs[jobId];if(!j||j.revision!==revision||!j.projectionPending)throw Error('stale_projection');
  j.projectionPending=false;s.projectionLease=null;return {status:'acknowledged'};
 });
}
export function dispatch(){throw Error('LIVE_CARD_DELIVERY_NOT_IMPLEMENTED_OR_AUTHORIZED');}
export async function reevaluate(store,{jobId,revision,snapshot,candidates,organization},now=Date.now()){
 return mutate(store,s=>{
  const j=s.jobs[jobId];
  if(!j||j.status!=='HOLD'||j.orderId||j.sentAt||j.sentText)throw Error('not_recoverable');
  if(j.revision!==revision)throw Error('stale_revision');
  if(!snapshot||!Array.isArray(candidates)||snapshot.agentId!==j.snapshot.agentId||snapshot.inspectionId!==j.snapshot.inspectionId||snapshot.organizationId!==j.snapshot.organizationId)throw Error('recovery_identity_changed');
  let reason=qualification(snapshot,organization)||officeQualification(s,snapshot,now);
  if(s.historyReady[hash(snapshot.agentId)]?.complete!==true)reason='history_unreconciled';
  if(Object.values(s.jobs).some(other=>other.id!==j.id&&other.status!=='SUPERSEDED'&&other.snapshot.inspectionId===snapshot.inspectionId&&other.snapshot.agentId!==snapshot.agentId))reason='changed_agent_manual_review';
  j.priorSnapshots??=[];j.priorSnapshots.push({revision:j.revision,snapshot:j.snapshot,status:j.status,error:j.error,approval:j.approval,draftText:j.draftText});
  j.snapshot=structuredClone(snapshot);j.historyReconciled=s.historyReady[hash(snapshot.agentId)]?.complete===true;revoke(j);
  const draft=reason?null:candidates.slice(0,3).find(t=>distinct(s,snapshot.agentId,t,j.id))||null;
  if(draft)reserve(s,snapshot.agentId,draft,j.id);
  j.draftText=draft;j.status=reason?'HOLD':draft?'AWAITING_APPROVAL':'MANUAL_REVIEW';j.error=reason||(!draft?'copy_exhausted':null);changed(j,now);audit(s,j.id,'hold_reevaluated_approval_revoked',now);
  return {status:j.status,jobId:j.id,deliveryEnabled:false};
 });
}

export async function resolveAgentConflict(store,{jobId,revisions,snapshot,organization,currentRecipientEvidence},now=Date.now()){
 return mutate(store,s=>{
  const selected=s.jobs[jobId];if(!selected||!currentRecipientEvidence||snapshot?.agentId!==selected.snapshot.agentId||snapshot?.inspectionId!==selected.snapshot.inspectionId||snapshot?.organizationId!==selected.snapshot.organizationId)throw Error('conflict_identity_unverified');
  const group=Object.values(s.jobs).filter(j=>j.snapshot.organizationId===organization&&j.snapshot.inspectionId===snapshot.inspectionId&&j.status!=='SUPERSEDED');
  if(group.length<2||group.some(j=>j.status!=='HOLD'||j.orderId||j.sentAt||j.sentText||revisions?.[j.id]!==j.revision))throw Error('conflict_not_resolvable');
  if(qualification(snapshot,organization)||officeQualification(s,snapshot,now)||s.historyReady[hash(snapshot.agentId)]?.complete!==true)throw Error('conflict_qualification_hold');
  for(const j of group){j.priorSnapshots??=[];j.priorSnapshots.push({revision:j.revision,snapshot:j.snapshot,status:j.status,error:j.error,approval:j.approval,draftText:j.draftText});revoke(j);j.conflictResolution={selectedJobId:jobId,evidence:currentRecipientEvidence,at:now};j.status=j.id===jobId?'HOLD':'SUPERSEDED';j.error=j.id===jobId?'resolved_recipient_requires_fresh_review':'superseded_recipient';if(j.id===jobId)j.snapshot=structuredClone(snapshot);changed(j,now);audit(s,j.id,'agent_conflict_resolved_approval_revoked',now);}
  return {status:'HOLD',jobId,deliveryEnabled:false};
 });
}

export async function claimProjection(store,now=Date.now()){
 return mutate(store,s=>{
  // No automatic lease expiry: an ambiguous Sheets write must be reconciled by
  // the same serialized run/owner before another record can claim a row.
  if(s.projectionLease)return {unchanged:true,status:'projection_busy_reconcile_required'};
  const j=Object.values(s.jobs).find(j=>j.projectionPending);if(!j)return {unchanged:true,status:'idle'};
  const token=randomUUID();s.projectionLease={token,jobId:j.id,revision:j.revision,at:now,until:now+300000,snapshot:structuredClone(j)};return {status:'claimed',token,job:structuredClone(j)};
 });
}
