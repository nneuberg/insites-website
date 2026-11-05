// Trusted, cache-only staging. Dependencies are application services, never HTTP
// request fields. No Hive transport, credentials, order submission or auto-approval.
import {fingerprint,hash,mutate,readState,stage,changed,qualification} from './cards-core.mjs';
import {prepareDraftContext} from './cards-history.mjs';
import {assertSourceAuthority} from './hive-source-cache.mjs';

const text=v=>typeof v==='string'&&v.trim().length>0;
const fail=reason=>{throw Error(reason);};
const DAY=86400000;
export const cardSourceEventId=(organization,inspectionId)=>fingerprint(['cards-source-v1',organization,inspectionId]);
export const cardOfficeHash=({agentId,agencyId,recipient})=>fingerprint({agentId,agencyId,recipient});

const officeSourceFields=['agency_id','agency_name','uses_agency_address','address','address_line2','city','state','zip','country'];
function assertMailSource(contact){
 if(!text(contact?.id)||!text(contact.first_name)||contact.deleted===true||!Array.isArray(contact.roles)||contact.roles.some(r=>!text(r))||!contact.roles.includes('Buyer Agent')||!Array.isArray(contact.tags)||contact.tags.some(t=>!text(t?.name)))fail('office_contact_authority_required');
 if(contact.do_not_mail===true||contact.tags.some(t=>/^(do[ -]?not[ -]?mail|no[ -]?mail|mail[ -]?suppressed)$/i.test(t.name.trim())))fail('recipient_suppressed');
}
// Pure conversion, never a source lookup or an address guess. These exact contact
// fields are the verified Hive association/address contract, not property data.
export function deriveCardOffice({contact,now=Date.now()}){
 assertMailSource(contact);
 if(!Number.isSafeInteger(now)||now<0||contact.uses_agency_address!==true||!['agency_id','agency_name','address','city','state','zip','country'].every(k=>text(contact[k]))||contact.country!=='US'||!/^\d{5}(?:-\d{4})?$/.test(contact.zip)||!(/^[A-Z]{2}$/).test(contact.state))fail('office_source_incomplete');
 if(contact.address_line2!=null&&typeof contact.address_line2!=='string'||contact.last_name!=null&&typeof contact.last_name!=='string')fail('office_source_incomplete');
 const recipient={firstName:contact.first_name,lastName:contact.last_name||'',company:contact.agency_name,address:contact.address,address2:contact.address_line2||'',city:contact.city,region:contact.state,postcode:contact.zip,country:contact.country};
 const sourceContactFingerprint=fingerprint(contact),office={agentId:contact.id,agencyId:contact.agency_id,recipient,verifiedAt:now,doNotMail:false,evidence:'hive-contact-office:'+sourceContactFingerprint,suppressionEvidence:'hive-contact-mail-status:'+sourceContactFingerprint,sourceKind:'hive-contact-office-v1',sourceContactFingerprint};
 return {...office,officeHash:cardOfficeHash(office)};
}
async function persistContactOffice(store,contact,now){
 assertMailSource(contact);
 return mutate(store,s=>{
  const previous=s.offices?.[hash(contact.id)];
  // Existing independently reviewed attestations remain usable when older cache
  // generations omit all office fields. Any supplied office field requires full
  // current proof and cannot silently contradict that explicit attestation.
  if(previous&&previous.sourceKind!=='hive-contact-office-v1'&&!officeSourceFields.some(k=>Object.hasOwn(contact,k)))return {unchanged:true,office:structuredClone(previous)};
  const office=deriveCardOffice({contact,now});
  if(previous){
   if(previous.agentId!==office.agentId||previous.agencyId!==office.agencyId||previous.doNotMail!==false||previous.officeHash!==office.officeHash||previous.officeHash!==cardOfficeHash(previous))fail('office_source_changed_review_required');
   // Never overwrite an explicit owner attestation, including its evidence/date.
   if(previous.sourceKind!=='hive-contact-office-v1'||now-previous.verifiedAt<=30*DAY)return {unchanged:true,office:structuredClone(previous)};
  }
  s.offices??={};s.offices[hash(contact.id)]=office;
  return {status:'office_source_attested',office:structuredClone(office)};
 });
}
// Trusted dependency boundary: persistence can only use the actual fresh source
// view response, not an event body, request-supplied address or caller attestation.
export async function attestCachedCardOffice({store,view,agentId,now=Date.now()}){
 if(!text(agentId))fail('office_contact_authority_required');
 const contact=await view.getContact(agentId);if(contact?.id!==agentId)fail('office_contact_identity_changed');
 return persistContactOffice(store,contact,now);
}
function buyer(inspection){
 if(!Array.isArray(inspection?.contacts))fail('inspection_contacts_missing');
 const matches=inspection.contacts.filter(c=>c?.role==='Buyer Agent');
 if(matches.length!==1||!text(matches[0]?.id))fail('buyer_agent_ambiguous');
 // The same ID assigned another role on this inspection is not a safe recipient.
 if(inspection.contacts.filter(c=>c?.id===matches[0].id).length!==1)fail('buyer_agent_ambiguous');
 return matches[0];
}
function completed(i,now){
 const end=Date.parse(i?.ends_at||'');
 return i?.deleted===false&&i.canceled_at===null&&i.confirmed===true&&['confirmed','completed'].includes(i.status)&&
  Number.isFinite(end)&&end<=now&&i.price?.paid===true&&i.price.amount_due===0&&
  i.agreements?.all_signed===true&&i.reports?.status==='published'&&
  (!Array.isArray(i.reports.items)||i.reports.items.length>0&&i.reports.items.every(r=>r?.status==='published'));
}
export function buildCardSnapshot({organization,inspection,contact,office,now=Date.now()}){
 if(!text(organization)||!text(inspection?.id)||!Number.isSafeInteger(now))fail('source_identity_required');
 // Organization is the trusted source service's configured scope. Any explicit
 // record organization must agree; callers cannot select a tenant from an event.
 for(const id of [inspection.organization?.id,inspection.organization_id,contact?.organization?.id,contact?.organization_id])if(id!=null&&id!==organization)fail('organization_mismatch');
 const link=buyer(inspection);
 if(contact?.id!==link.id||!text(contact.first_name)||contact.deleted===true||!Array.isArray(contact.roles)||!contact.roles.includes('Buyer Agent')||!Array.isArray(contact.tags))fail('contact_identity_unverified');
 if(!completed(inspection,now))fail('completion_unverified');
 if(!office||office.agentId!==contact.id||!text(office.agencyId)||!text(office.evidence)||!text(office.suppressionEvidence)||office.doNotMail!==false||!Number.isSafeInteger(office.verifiedAt)||office.verifiedAt>now||now-office.verifiedAt>30*DAY)fail('office_review_required');
 if(office.officeHash!==cardOfficeHash(office))fail('office_fingerprint_mismatch');
 if(office.recipient?.firstName!==contact.first_name||(office.recipient?.lastName||'')!==(contact.last_name||''))fail('office_identity_changed');
 // Full contact suppression is authoritative; unknown/malformed tags fail closed.
 if(contact.tags.some(t=>!text(t?.name)))fail('suppression_unknown');
 if(contact.do_not_mail===true||contact.tags.some(t=>/^(do[ -]?not[ -]?mail|no[ -]?mail|mail[ -]?suppressed)$/i.test(t.name.trim())))fail('recipient_suppressed');
 const sourceRecords=fingerprint({inspection,contact});
 // Use explicit structured fields only. Never guess a street from a full address,
 // infer a client's first name from an email, or copy event-supplied anecdotes.
 const streetName=text(inspection.address?.street)?inspection.address.street.trim():null;
 const clients=inspection.contacts.filter(c=>c?.role==='Customer');
 const client=clients.length===1?clients[0]:null;
 const clientName=client&&text(client.id)&&text(client.first_name)&&client.id!==contact.id&&inspection.contacts.filter(c=>c?.id===client.id).length===1?client.first_name.trim():null;
 if(!streetName&&!clientName)fail('personalization_source_required');
 const snapshot={organizationId:organization,inspectionId:inspection.id,agentId:contact.id,agencyId:office.agencyId,
  recipient:structuredClone(office.recipient),completionVerified:true,contactMatchCount:1,agencyMatchCount:1,
  usesAgencyAddress:true,addressVerified:true,addressEvidence:office.evidence,addressVerifiedAt:office.verifiedAt,
  doNotMail:false,suppressionEvidence:office.suppressionEvidence,officeHash:office.officeHash,sourceRecords,
  personalization:{verified:true,inspectionId:inspection.id,agentId:contact.id,streetName,clientName,evidence:sourceRecords}};
 const issue=qualification(snapshot,organization);if(issue)fail(issue);
 return snapshot;
}
function completeHistory(history,agentId,inspectionId){
 return {async readComplete(){
  const snapshot=await history.readComplete();
  const r=snapshot?.reconciliation?.[agentId];
  // A complete worksheet, including a headers-only worksheet, cannot establish
  // provider or pre-sheet history completeness. Both need independent evidence.
  if(!['provider','legacy'].every(k=>r?.[k]?.complete===true&&text(r[k].evidence)))fail('provider_legacy_history_unreconciled');
  // Same inspection is a global uniqueness boundary, even if a prior card was
  // assigned to another agent. Never turn a changed agent into another card.
  if(Array.isArray(snapshot.headers)&&Array.isArray(snapshot.rows)){
   const inspectionColumn=snapshot.headers.indexOf('hive_inspection_id'),agentColumn=snapshot.headers.indexOf('hive_contact_id');
   if(inspectionColumn>=0&&agentColumn>=0&&snapshot.rows.some(row=>Array.isArray(row)&&row[inspectionColumn]===inspectionId&&row[agentColumn]!==agentId))fail('changed_agent_history_requires_reconciliation');
  }
  return snapshot;
 }};
}
async function holdInspection(store,organization,inspectionId,reason,now){
 return mutate(store,s=>{
  let held=0;
  for(const j of Object.values(s.jobs))if(j.snapshot.organizationId===organization&&j.snapshot.inspectionId===inspectionId&&j.status!=='SUPERSEDED'&&!j.orderAttempt&&!j.orderId&&!j.sentAt){
   if(j.status==='HOLD'&&j.error===reason)continue;
   j.status='HOLD';j.error=reason;j.approvedText=null;j.approval=null;changed(j,now);held++;
  }
  return {unchanged:held===0,status:'HOLD',reason,held,deliveryEnabled:false};
 });
}
export async function stageCachedInspection({store,view,history,organization,inspectionId,generateCandidates,now=Date.now()}){
 if(!text(organization)||!text(inspectionId)||typeof generateCandidates!=='function')fail('source_configuration_required');
 try{
  const inspection=await view.getInspection(inspectionId);
  if(inspection?.id!==inspectionId)fail('inspection_identity_changed');
  const agentId=buyer(inspection).id,contact=await view.getContact(agentId);
  if(!completed(inspection,now))fail('completion_unverified');
  await persistContactOffice(store,contact,now);
  const state=await readState(store),office=state.offices?.[hash(agentId)];
  const snapshot=buildCardSnapshot({organization,inspection,contact,office,now});
  if(Object.values(state.jobs).some(j=>j.snapshot.organizationId===organization&&j.snapshot.inspectionId===inspectionId&&j.snapshot.agentId!==agentId&&(j.orderAttempt||j.orderId||j.sentAt)))fail('inspection_order_requires_reconciliation');
  if(history.ensureAgent!==undefined){if(typeof history.ensureAgent!=='function')fail('history_audit_configuration_required');await history.ensureAgent(agentId,structuredClone(snapshot.recipient));}
  const context=await prepareDraftContext({store,history:completeHistory(history,agentId,inspectionId),snapshot,now});
  const prior=Object.values((await readState(store)).jobs).find(j=>j.snapshot.organizationId===organization&&j.snapshot.inspectionId===inspectionId&&j.snapshot.agentId===agentId);
  // Do not regenerate existing wording or consume a model call on replay/change.
  const candidates=prior?[]:await generateCandidates(structuredClone(context));
  if(!Array.isArray(candidates)||candidates.length>3||candidates.some(t=>typeof t!=='string'||t.length>1000))fail('invalid_candidates');
  // Generation/history reads may take time. Re-read authoritative sources and
  // office attestation before persisting anything reviewable.
  const freshInspection=await view.getInspection(inspectionId),freshContact=await view.getContact(agentId);
  if(fingerprint({inspection:freshInspection,contact:freshContact})!==snapshot.sourceRecords)fail('source_changed_during_staging');
  const freshOffice=(await readState(store)).offices?.[hash(agentId)];
  if(fingerprint(freshOffice??null)!==fingerprint(office))fail('office_changed_during_staging');
  const eventId=cardSourceEventId(organization,inspectionId);
  await mutate(store,s=>{
   if(s.events[eventId])return {unchanged:true};
   s.events[eventId]={id:eventId,instance:'cache:'+eventId,bodyHash:fingerprint([organization,inspectionId]),receivedAt:now,status:'QUEUED',source:'trusted-cache-v1'};
   return {status:'queued'};
  });
  return {...await stage(store,{eventId,snapshot,candidates,organization},now),deliveryEnabled:false};
 }catch(error){
  const reason=error?.message||'source_unavailable';
  return holdInspection(store,organization,inspectionId,reason,now);
 }
}
export async function runCachedCardWorker({cache,view,store,history,organization,generateCandidates,enabled=false,startAfter,limit=20,now=()=>Date.now()}){
 if(enabled!==true)return {status:'disabled',deliveryEnabled:false};
 if(!Number.isSafeInteger(startAfter)||startAfter<0)fail('source_launch_boundary_required');
 if(!Number.isInteger(limit)||limit<1||limit>100||!text(organization))fail('source_configuration_required');
 const at=now();let state;
 try{
  ({state}=await cache.read());
  for(const kind of ['contacts','inspections'])assertSourceAuthority(state,kind,{now:at,maxAgeMs:DAY});
 }catch{return {status:'source_deferred',considered:0,deliveryEnabled:false};}
 // Bounded consideration (including deleted/ineligible rows), deterministic
 // ordering, and a CAS cursor. Replays remain safe through deterministic job IDs.
 const jobs=Object.values((await readState(store)).jobs).filter(j=>j.snapshot.organizationId===organization);
 const existing=new Set(jobs.map(j=>j.snapshot.inspectionId));
 const submitted=new Set(jobs.filter(j=>j.orderAttempt||j.orderId||j.sentAt).map(j=>j.snapshot.inspectionId));
 const allRows=Object.values(state.inspections);
 // Filter before the bounded cursor: historical prelaunch rows must not consume
 // one scheduled slot each and delay new candidates for days. Future bookings
 // wait until their actual end. Existing unsubmitted jobs stay in the pool so
 // source changes revoke review; submitted jobs belong to receipt reconciliation.
 const rows=allRows.filter(row=>!submitted.has(row.id)&&(existing.has(row.id)||Date.parse(row.data?.ends_at||'')>startAfter&&Date.parse(row.data?.ends_at||'')<=at)).sort((a,b)=>a.id.localeCompare(b.id));
 const start=await mutate(store,s=>{
  const offset=rows.length?(s.cardSourceCursor?.offset||0)%rows.length:0;
  s.cardSourceCursor={offset:rows.length?(offset+Math.min(limit,rows.length))%rows.length:0};
  return {offset};
 });
 const results=[];let skipped=0;
 for(let n=0;n<Math.min(limit,rows.length);n++){
  const row=rows[(start.offset+n)%rows.length];
  // The reviewed launch boundary applies only to new discovery. Existing jobs
  // must still observe cancellations, identity changes and other source holds.
  const endedAt=Date.parse(row.data?.ends_at||'');
  if(!existing.has(row.id)&&(!Number.isFinite(endedAt)||endedAt<=startAfter)){skipped++;continue;}
  results.push({inspectionId:row.id,...await stageCachedInspection({store,view,history,organization,inspectionId:row.id,generateCandidates,now:now()})});
 }
 return {status:'checked',considered:results.length,scanned:results.length+skipped,skipped,filtered:allRows.length-rows.length,results,deliveryEnabled:false};
}
