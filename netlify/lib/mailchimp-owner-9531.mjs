// Isolated proposal only: no entrypoint, schedule, credentials, or production imports.
import {createHash} from 'node:crypto';
export const TARGET=Object.freeze({owner:'neal@insites.services',audience:'8f8749ba24',flow:'9531',event:'insites_claim_test_20261028'});
const KEY='owner-mailchimp-test/9531-20261028';
const id=n=>`owner9531-20261028-${n}`;
const payload=n=>({name:TARGET.event,is_syncing:false,properties:{invitation_id:id(n),reward_id:`inert-${id(n)}`,claim_url:`https://example.com/#${id(n)}`,amount:'0',currency:'USD',test_only:'true'}});
export function ownerTransport({env,fetcher=fetch}){
 const api=env?.MAILCHIMP_API_KEY;
 const base=`https://us5.api.mailchimp.com/3.0/lists/${TARGET.audience}/members/${createHash('md5').update(TARGET.owner).digest('hex')}`;
 const opts=method=>{if(typeof api!=='string'||!api.endsWith('-us5'))throw Error('Existing server connection unavailable');return {method,headers:{Authorization:'Basic '+Buffer.from('insites:'+api).toString('base64'),'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)}};
 return {
  async subscribed(){const r=await fetcher(base,opts('GET'));if(!r.ok)throw Error('Owner membership unverified');const d=await r.json();return d.status==='subscribed'&&d.email_address?.trim().toLowerCase()===TARGET.owner;},
  async submit(n,event){if(![1,2,3].includes(n)||JSON.stringify(event)!==JSON.stringify(payload(n)))throw Error('Test payload rejected');const r=await fetcher(base+'/events',{...opts('POST'),body:JSON.stringify(event)});return {accepted:r.status===204,httpStatus:r.status};}
 };
}
// Store must provide durable, strongly consistent CAS, shared across all invocations.
// No reset/delete/alternate namespace or retry operation is provided.
export function ownerHarness({store,transport,now=()=>Date.now()}){
 const read=()=>store.getWithMetadata(KEY,{type:'json'});
 async function write(entry,data){const result=await store.setJSON(KEY,data,entry?{onlyIfMatch:entry.etag}:{onlyIfNew:true});if(!result.modified)throw Error('Concurrent change; inspect checkpoint');}
 function windowOK(d){if(d.closed||now()<d.start||now()>=d.end)throw Error('Test closed or outside window');}
 return {
  async initialize(config){if(await read())throw Error('Existing checkpoint; no reset');if(config.flow!==TARGET.flow||config.owner!==TARGET.owner||config.event!==TARGET.event||config.audience!==TARGET.audience||config.exactFilterVerified!==true||config.singleEmailVerified!==true||config.inertTemplateVerified!==true||config.trackingReviewed!==true||config.reentryReviewed!==true||!Number.isSafeInteger(config.start)||!Number.isSafeInteger(config.end)||config.end<=config.start||config.end-config.start>3600000||config.end<=now())throw Error('Unverified test configuration');await write(null,{...config,attempts:{},closed:false});return {initialized:true};},
  async inspect(){const e=await read();return e?e.data:null;},
  async attempt(n){if(![1,2,3].includes(n))throw Error('Three fixed slots only');let e=await read();if(!e)throw Error('Not initialized');windowOK(n===3&&e.data.thirdWindow?{...e.data,...e.data.thirdWindow}:e.data);if(e.data.attempts[n])return e.data.attempts[n];if(Object.values(e.data.attempts).some(a=>a.state==='uncertain'))throw Error('Uncertain prior event; stop');if(n>1&&!e.data.attempts[n-1])throw Error('Slots must be sequential');if(n===3&&(!e.data.completion||now()<e.data.completion.notBefore))throw Error('Completion/reentry evidence needed');if(!await transport.subscribed())throw Error('Owner is not subscribed');
   const record={invitationId:id(n),state:'uncertain',attemptedAt:now()};await write(e,{...e.data,attempts:{...e.data.attempts,[n]:record}});
   let result;try{result=await transport.submit(n,payload(n));}catch{return record;}
   e=await read();const updated={...record,state:result?.accepted===true?'accepted':'uncertain',httpStatus:Number.isInteger(result?.httpStatus)?result.httpStatus:null};await write(e,{...e.data,attempts:{...e.data.attempts,[n]:updated}});return updated;
  },
  async observe(n,evidence){const e=await read();if(![1,2,3].includes(n)||!e?.data.attempts[n]||evidence?.flow!==TARGET.flow||evidence.owner!==TARGET.owner||evidence.invitationId!==id(n)||typeof evidence.reference!=='string'||!evidence.reference.trim()||!['event-observed','sent','delivered','flow-completed'].includes(evidence.kind))throw Error('Exact evidence required');await write(e,{...e.data,observations:[...(e.data.observations||[]),{...evidence,recordedAt:now()}]});return {recorded:true};},
  async permitThird({references,notBefore}){const e=await read();if(!e||!Number.isSafeInteger(notBefore)||notBefore<now()||!Array.isArray(references)||references.length!==2)throw Error('Completion evidence required');for(const n of [1,2])if(!e.data.observations?.some(o=>o.invitationId===id(n)&&o.kind==='flow-completed'&&references.includes(o.reference)))throw Error('Both exact completions required');await write(e,{...e.data,completion:{references,notBefore}});},
  // Aggregate UI evidence permits only this owner-only third-slot experiment.
  // It does NOT reconcile either earlier invitation or establish production delivery.
  async permitObservedThird({flow,owner,reference,observedAt,inProgress,completed,start,end}){
   const e=await read();
   if(!e||e.data.closed||e.data.thirdWindow||e.data.attempts[3]||[1,2].some(n=>e.data.attempts[n]?.state!=='accepted')||flow!==TARGET.flow||owner!==TARGET.owner||typeof reference!=='string'||!reference.trim()||inProgress!==0||!Number.isSafeInteger(completed)||completed<1||!Number.isSafeInteger(observedAt)||observedAt>now()||now()-observedAt>3600000||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<observedAt+300000||end<=start||end-start>3600000||end<=now())throw Error('Fresh observed exit and bounded third window required');
   await write(e,{...e.data,thirdWindow:{start,end},completion:{kind:'owner-test-observed-exit-only',reference,observedAt,inProgress,completed,notBefore:start}});
   return {thirdOnly:true,notBefore:start,end,earlierDeliveryUnproven:true};
  },
  async close(){const e=await read();if(e)await write(e,{...e.data,closed:true});return {closed:true};}
 };
}
