import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {referralSourceBarrier} from '../netlify/lib/referral-source-barrier.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../netlify/lib/referral-service-catalog.mjs';
const WORK='hive-source-work/v1',PREFIX='hive-source-events/pending/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
export function fixture(){
 const now=Date.now(),iso=delta=>new Date(now+delta).toISOString(),day=86400000;
 const work={schema:1,pendingInspectionIds:[],refreshContactIds:[],invalidatedContactIds:[],invalidatedInspectionIds:[],globalRoleDirty:false,roleMappingUnknown:false};
 const f={now,work,workEtag:'work1',cacheEtag:'cache1',events:new Map(),workReads:0,writes:0,reads:[],onWorkRead:null,afterList:null};
 const customer={id:'client1',email:'synthetic@example.com',first_name:'Synthetic',last_name:'Fixture',roles:['Customer'],tags:[]};
 const inspection={id:'current1',contacts:[{...customer,role:'Customer'}],status:'confirmed',confirmed:true,canceled_at:null,deleted:false,scheduled_for:iso(-2*day-3600000),ends_at:iso(-2*day),created_at:iso(-3*day),reports:{status:'published'},services:[{id:APPROVED_REFERRAL_FULL_SERVICE_IDS[0]}],discount_codes:[{code:'CODE1'}],price:{paid:true,payment_status:'paid',amount_due:0,amount_paid:350},refunded:false,disputed:false};
 const state={schema:1,contacts:{client1:{id:'client1',deleted:false,data:customer,emails:[customer.email],revision:1}},inspections:{current1:{id:'current1',deleted:false,data:inspection,revision:1}},conflicts:{},coverage:{contacts:{complete:true,scope:'all',watermark:now,historyComplete:true},inspections:{complete:true,scope:'all',watermark:now,historyComplete:true}}};
 const store={
  async getWithMetadata(key){f.reads.push(key);if(key===WORK){f.workReads++;await f.onWorkRead?.(f.workReads);return f.work===null?null:{data:clone(f.work),etag:f.workEtag};}return clone(f.events.get(key)??null);},
  async *list(){yield {blobs:[...f.events.keys()].map(key=>({key}))};await f.afterList?.();},
  async setJSON(){f.writes++;throw Error('No write permitted');},async delete(){f.writes++;throw Error('No delete permitted');}
 };
 f.services={store,cache:{read:async()=>({etag:f.cacheEtag,state:clone(state)})},view:{getInspection:async id=>{assert.equal(id,inspection.id);return clone(inspection);},listAllContacts:async()=>[clone(customer)]}};
 f.barrier=options=>referralSourceBarrier({store,inspectionId:'current1',...options});
 f.pending=(id='event1')=>f.events.set(PREFIX+id,{etag:id+'-v1',data:{state:'pending',event:'inspection.canceled',data:{inspection:{id:'current1'}}}});
 f.done=(id='event1')=>f.events.set(PREFIX+id,{etag:id+'-done',data:{state:'done'}});
 const policy={verified:true,reference:'synthetic-policy',validUntil:iso(60000),bookingCreatedAtVerified:true,consentDefinesConsumerEligibility:true,historyCoverage:{sourceMode:'hive-migrated',exactEmailLookupVerified:true,currentHistoryComplete:true,scope:'exact-email-index',through:iso(0),deletedBehaviorVerified:true,reference:'synthetic-index',historicalMigrationVerified:true,migrationReference:'synthetic-migration'}};
 const snapshot={version:'2026-10-22-reconcile',codes:[{Code:'CODE1','Assignment State':'ASSIGNED','Hive State':'VERIFIED','Referrer Email':'referrer@example.com','Referrer ID':'referrer1','Assigned At':iso(-5*day)}],shares:[{Code:'CODE1','Referrer Email':'referrer@example.com','Terms Version':'2026-10-04-personal-share','Consent At':iso(-4*day)}],uses:[]};
 const event={inspectionId:'current1',organizationId:'7149a5c8-d349-40c6-ad3e-b0584646a6b4',templateId:'66b1c688-3157-4a23-b646-487426af8e6c',instanceId:'synthetic-completion1',receivedAt:now-day};
 const eventKey='review-events/'+hash(event.organizationId+':'+event.templateId+':'+event.instanceId);
 f.readerOptions={services:f.services,store:{get:async()=>clone(policy)},reviewStore:{async *list(){yield {blobs:[{key:eventKey}]};},get:async()=>clone(event)},ledger:async action=>{assert.equal(action,'codeSnapshot');return clone(snapshot);},readPriorReward:async()=>({verified:true,useId:'HIVE-current1',email:customer.email,clear:true,reference:'synthetic-prior-reward'}),now:()=>f.now};
 return f;
}

