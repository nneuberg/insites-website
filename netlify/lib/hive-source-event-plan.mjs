import {SOURCE_EVENTS} from './hive-source-webhook.mjs';
import {normalizeListRecord,sourceRevision} from './hive-source-sync.mjs';

const allowed=new Set(SOURCE_EVENTS);
const idOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

// Pure work plan from a private, signature-verified queued API event. The worker
// must apply revisions through cache CAS and durably queue ALL work before ack.
// This is not an eligibility adapter or an event-only inspection reconstruction.
export function planHiveSourceEvent(row){
 if(row?.schema!==1||row.state!=='pending'||!idOK(row.eventId)||!idOK(row.organizationId)||row.apiVersion!=='v1'||!allowed.has(row.event)||!object(row.data))throw Error('Invalid queued source event');
 const firedRevision=sourceRevision(row.firedAt);
 if(row.event.startsWith('contact.')){
  const contact=row.data.contact,deleted=row.event==='contact.deleted';
  if(!object(contact)||!idOK(contact.id)||!Array.isArray(contact.tag_list)||contact.tag_list.some(x=>typeof x!=='string'||!x.trim())||!Array.isArray(contact.roles)||contact.roles.some(x=>typeof x!=='string'||!x.trim()))throw Error('Incomplete contact event');
  // Deletion carries the last-known record; updated_at may predate the deletion.
  // fired_at is the documented deletion event boundary, not stale updated_at.
  const normalized=normalizeListRecord('contacts',{
   ...contact,tags:contact.tag_list.map(name=>({name})),deleted,
   ...(deleted?{updated_at:row.firedAt,deleted_at:row.firedAt}:{})
  });
  if(normalized.revision>firedRevision)throw Error('Source version is newer than event');
  return {eventId:row.eventId,contactUpdates:[normalized],pendingInspectionIds:[],refreshContactIds:[],invalidateContactRoleAuthority:false};
 }
 const data=row.data,inspection=data.inspection;
 if(!object(inspection)||!idOK(inspection.id)||!Array.isArray(data.buyers)||!Object.hasOwn(data,'buying_agent')||!Object.hasOwn(data,'selling_agent'))throw Error('Incomplete inspection event');
 const related=[...data.buyers,...[data.buying_agent,data.selling_agent].filter(x=>x!==null)];
 if(related.some(x=>!object(x)||!idOK(x.id)))throw Error('Incomplete related identities');
 if(sourceRevision(inspection.updated_at)>firedRevision)throw Error('Source version is newer than event');
 // Contact.roles is derived from inspection relationships. Those relationships
 // do not independently emit contact.updated; old removed identities may be
 // absent here, so the worker must invalidate global role authority too.
 return {eventId:row.eventId,contactUpdates:[],pendingInspectionIds:[inspection.id],
  refreshContactIds:[...new Set(related.map(x=>x.id))].sort(),invalidateContactRoleAuthority:true};
}
