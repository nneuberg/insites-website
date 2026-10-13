import {hash,fingerprint,readState,mutate,stage} from './cards-core.mjs';
import {resolveOffice} from './cards-adapters.mjs';
export function mappingFrom(env){
 let m;try{m=JSON.parse(env.HIVE_CARDS_MAPPING_JSON||'null');}catch{}
 if(!m?.verified||!m.evidence||!m.inspectionIdPath||!m.buyingAgentIdPath)throw Error('mapping_unverified');return m;
}
const at=(obj,path)=>typeof path==='string'&&/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(path)?path.split('.').reduce((v,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,obj):undefined;
export function eventIdentity(event,mapping,env){
 if(event.event!==env.HIVE_CARD_EVENT||event.organization?.id!==env.HIVE_CARD_ORGANIZATION_ID)throw Error('event_not_authorized');
 const inspectionId=at(event,mapping.inspectionIdPath),agentId=at(event,mapping.buyingAgentIdPath);
 if(![inspectionId,agentId].every(x=>typeof x==='string'&&x.trim()&&x.length<=128))throw Error('missing_stable_ids');return {inspectionId,agentId};
}
export const officeFingerprint=office=>fingerprint(office);
export async function verifyOffice(store,{office,reviewedOfficeHash,addressEvidence,suppressionEvidence,doNotMail},now=Date.now()){
 if(reviewedOfficeHash!==officeFingerprint(office)||!addressEvidence||!suppressionEvidence||typeof doNotMail!=='boolean')throw Error('office_review_changed');
 return mutate(store,s=>{s.offices??={};s.offices[hash(office.agentId)]={officeHash:reviewedOfficeHash,addressEvidence,suppressionEvidence,doNotMail,verifiedAt:now};
  for(const j of Object.values(s.jobs))if(j.snapshot.agentId===office.agentId&&(doNotMail||j.snapshot.officeHash!==reviewedOfficeHash)){j.status='HOLD';j.error='office_or_suppression_changed';j.approvedText=null;j.approval=null;j.revision++;j.updatedAt=now;j.projectionPending=true;}
  s.audit.push({id:office.agentId,action:'office_verified',actor:'owner',at:now});return {status:'office_recorded'};});
}
export async function retryEvent(store,id){return mutate(store,s=>{const e=s.events[id];if(!e||e.status!=='HOLD'||e.jobId)throw Error('event_not_retryable');e.status='QUEUED';delete e.error;return {status:'queued'};});}
export function draftCandidates(firstName){
 // Each statement is grounded only in this completed inspection. No referral,
 // meeting, attendance, repeat-business or client outcome claim is generated.
 const name=firstName.trim();return [
 `${name},\n\nThank you for including InSites in your client’s home-buying journey. I appreciate the opportunity to help them understand the home and make an informed decision.\n\nWarmly,\nNeal`,
 `${name},\n\nBuying a home brings plenty of questions. I’m glad InSites could provide a closer look, and I’m here if a report question comes up. Thank you for the opportunity.\n\nAll the best,\nNeal`,
 `${name},\n\nA quick note of appreciation as your clients take their next steps. Thank you for making InSites part of the process. Wishing you a good week ahead.\n\nWith thanks,\nNeal`
 ];
}
export async function workerStep({store,read,env,now=Date.now()}){
 const mapping=mappingFrom(env),state=await readState(store);
 const event=Object.values(state.events).find(e=>e.status==='QUEUED');if(!event)return {status:'idle'};
 const hold=reason=>mutate(store,s=>{const e=s.events[event.id];if(e.status!=='QUEUED')return {unchanged:true,status:'already_processed'};e.status='HOLD';e.error=reason;for(const j of Object.values(s.jobs))if(identity&&j.snapshot.organizationId===env.HIVE_CARD_ORGANIZATION_ID&&j.snapshot.inspectionId===identity.inspectionId){j.status='HOLD';j.error=reason;j.approvedText=null;j.approval=null;j.revision++;j.updatedAt=now;j.projectionPending=true;}return {status:'HOLD',reason};});
 let identity;try{identity=eventIdentity(event.event,mapping,env);}catch{return hold('event_mapping_hold');}
 let office;try{office=await resolveOffice({read,agentId:identity.agentId,mapping});}catch{return hold('hive_office_read_or_mapping_hold');}
 const latest=await readState(store),attestation=latest.offices?.[hash(identity.agentId)];
 if(!attestation||attestation.officeHash!==officeFingerprint(office)||now-attestation.verifiedAt>30*86400000||attestation.verifiedAt>now)return hold('office_review_required');
 if(attestation.doNotMail!==false)return hold('do_not_mail');
 if(latest.historyReady[hash(identity.agentId)]?.complete!==true)return hold('history_reconciliation_required');
 const snapshot={...office,organizationId:env.HIVE_CARD_ORGANIZATION_ID,inspectionId:identity.inspectionId,completionVerified:true,addressVerified:true,addressEvidence:attestation.addressEvidence,addressVerifiedAt:attestation.verifiedAt,suppressionEvidence:attestation.suppressionEvidence,doNotMail:false,officeHash:attestation.officeHash};
 return stage(store,{eventId:event.id,snapshot,candidates:[],organization:env.HIVE_CARD_ORGANIZATION_ID},now);
}
