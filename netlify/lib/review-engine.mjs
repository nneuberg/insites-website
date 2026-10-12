import {createHash,randomBytes} from 'node:crypto';
import {AUDIENCES,DAY,ORIGIN,eligibleRecipients,referralDates,dueStage,validToken} from './review-policy.mjs';
export function createEngine({store,env=process.env,fetcher=fetch,now=()=>Date.now()}){
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const rowKey=t=>'requests/'+t;
 async function api(url,options={}){
  const r=await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=new Error('API request failed');e.status=r.status;throw e;}
  return r.status===204?null:r.json();
 }
 async function hive(path,body){if(!env.HIVE_API_KEY)throw Error('Hive not configured');return api('https://api.hiveinspect.com/v1/'+path,{method:body?'PATCH':'GET',headers:{Authorization:'Bearer '+env.HIVE_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
 async function mc(row,body,method='PATCH',suffix=''){
  const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);if(!/^us\d+$/.test(dc||''))throw Error('Mailchimp not configured');
  const id=createHash('md5').update(row.email).digest('hex');
  return api(`https://${dc}.api.mailchimp.com/3.0/lists/${AUDIENCES[row.role]}/members/${id}${suffix}`,{method,headers:{Authorization:'Basic '+Buffer.from('insites:'+env.MAILCHIMP_API_KEY).toString('base64'),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 }
 const get=t=>store.get(rowKey(t),{type:'json'});
 const save=row=>store.setJSON(rowKey(row.token),row);
 async function locked(key,fn){
  const owner=randomBytes(16).toString('hex'),lockKey='locks/'+hash(key),old=await store.getWithMetadata(lockKey,{type:'json'});
  if(old?.data.until>now())throw Error('Request busy; retry later');
  const lock=await store.setJSON(lockKey,{owner,until:now()+120000},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
  if(!lock.modified)throw Error('Request busy; retry later');
  try{return await fn();}finally{
   const held=await store.getWithMetadata(lockKey,{type:'json'});
   if(held?.data.owner===owner)await store.setJSON(lockKey,{owner,until:0},{onlyIfMatch:held.etag});
  }
 }
 async function finish(row){
  await mc(row,{tags:[{name:'REVIEW:PENDING',status:'inactive'},...(row.ratedAt?[{name:'feedback received',status:'active'}]:[]),...(row.googleReviewedAt?[{name:'google reviewed',status:'active'}]:[])]},'POST','/tags');
  if(row.role==='Customer')await mc(row,{merge_fields:referralDates(row.endedAt)});
  row.finishSynced=true;await save(row);
 }
 async function syncHiveTag(row){
  const contact=await hive('contacts/'+encodeURIComponent(row.contactId));
  const tags=[...new Set([...(contact.tags||[]).map(t=>t.name),'Google Reviewed'])];
  await hive('contacts/'+encodeURIComponent(row.contactId),{tags});
  row.hiveTagSynced=true;await save(row);
 }
 async function confirmGoogle(token,review){
  if(!validToken(token)||!review?.reviewId)throw Error('Invalid match');
  const first=await get(token);if(!first)throw Error('Review request not found');
  return locked('google:'+review.reviewId,()=>locked(first.role+':'+first.email,async()=>{
   const row=await get(token),claimKey='confirmed/'+hash(review.reviewId),claim=await store.get(claimKey,{type:'json'});
   if(claim&&claim.token!==token)throw Error('This Google review is already assigned to another person');
   if(row.googleReviewId&&row.googleReviewId!==review.reviewId)throw Error('This contact already has a confirmed review');
   await store.setJSON(claimKey,{token},{onlyIfNew:true});
   row.googleReviewId=review.reviewId;row.googleReviewedAt=row.googleReviewedAt||now();row.googleReview=review;
   // Confirmation may replace an earlier feedback-end date, as agreed for verified reviews.
   if(!row.googleConfirmationEndedAt)row.endedAt=now();row.googleConfirmationEndedAt=row.endedAt;
   row.finishSynced=false;await save(row);await finish(row);await syncHiveTag(row);
   return {confirmed:true};
  }));
 }
 async function send(row,stage){
  const member=await mc(row,undefined,'GET');
  if(member.tags?.some(t=>t.name==='google reviewed')){row.googleReviewedAt=now();row.endedAt=now();await save(row);await finish(row);return;}
  if(member.status!=='subscribed'){row.endedAt=now();row.suppressed=true;row.finishSynced=true;await save(row);return;}
  const pending=member.tags?.some(t=>t.name==='REVIEW:PENDING');
  // Reconcile ambiguous tag-add responses without re-triggering the same send.
  if(row.preparingStage===stage&&row.stagePrepared&&pending){row.sentStages=[...new Set([...row.sentStages,...Array.from({length:stage+1},(_,n)=>n)])];delete row.preparingStage;delete row.stagePrepared;await save(row);return;}
  row.preparingStage=stage;row.stagePrepared=false;await save(row);
  await mc(row,{tags:[{name:'REVIEW:PENDING',status:'inactive'}]},'POST','/tags');
  // Existing Mailchimp star links append ?rating=N, so keep REVLINK query-free.
  await mc(row,{merge_fields:{REVLINK:ORIGIN+'/review/r/'+row.token,REVADDR:row.address}});
  row.stagePrepared=true;await save(row);
  await mc(row,{tags:[{name:'REVIEW:PENDING',status:'active'}]},'POST','/tags');
  row.sentStages=[...new Set([...row.sentStages,...Array.from({length:stage+1},(_,n)=>n)])];delete row.preparingStage;delete row.stagePrepared;await save(row);
 }
 async function enroll(inspection){
  const cutoff=Date.parse(env.REVIEW_START_AFTER||'');
  if(!Number.isFinite(cutoff)||env.REVIEW_ENABLED!=='true')return {paused:true};
  let added=0;
  for(const original of eligibleRecipients(inspection,now())){
   if(original.endedAt<cutoff)continue;
   const contact=await hive('contacts/'+encodeURIComponent(original.contactId));
   if(contact.tags?.some(t=>t.name.toLowerCase()==='google reviewed'))continue;
   // A person linked as an agent elsewhere must never receive a client reward invitation.
   const person={...original,role:contact.roles?.some(r=>['Buyer Agent','Seller Agent','Listing Agent','Agent'].includes(r))?'Agent':original.role};
   const identity=person.role+':'+person.email;
   await locked(identity,async()=>{
    const indexKey='people/'+hash(identity),index=await store.get(indexKey,{type:'json'});
    const prior=index?await get(index.token):null;
    // One review sequence per person, including repeat inspections.
    if(prior)return;
    const token=index?.token||randomBytes(24).toString('hex');
    const row={...person,inspectionEndedAt:person.endedAt,endedAt:null,token,createdAt:now(),expiresAt:now()+14*DAY,sentStages:[]};
    delete row.endedAt;
    try{const member=await mc(row,undefined,'GET');if(member.status!=='subscribed'||member.tags?.some(t=>t.name==='google reviewed'))return;}catch(e){if(e.status===404)return;throw e;}
    // Index and row creation happen under a per-person lock; indexes recover from a crash between writes.
    await store.setJSON(indexKey,{token},{onlyIfNew:true});await save(row);added++;
   });
  }
  return {added};
 }
 async function process(token){
  const initial=await get(token);if(!initial)return;
  return locked(initial.role+':'+initial.email,async()=>{
   const row=await get(token);
   if(row.endedAt){if(!row.finishSynced&&!row.suppressed)await finish(row);if(row.googleReviewedAt&&!row.hiveTagSynced)await syncHiveTag(row);return;}
   if(now()>=row.expiresAt){row.endedAt=row.expiresAt;await save(row);await finish(row);return;}
   const stage=dueStage(row,now());if(stage!==null&&stage>=0)await send(row,stage);
  });
 }
 async function feedback(token,input){
  if(!validToken(token))throw Error('Invalid review link');
  const first=await get(token);if(!first)throw Error('Review not found');
  return locked(first.role+':'+first.email,async()=>{
   const row=await get(token);if(now()>=row.expiresAt)throw Error('Review link expired');
   if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5||typeof input.feedback!=='string'||input.feedback.length>4000)throw Error('Invalid feedback');
   if(row.ratedAt){if(row.rating!==input.rating)throw Error('Feedback already recorded');return {saved:true};}
   row.rating=input.rating;row.feedback=input.feedback.trim();row.ratedAt=now();row.endedAt=now();await save(row);
   try{await finish(row);}catch{/* Stored feedback is retried by the worker. */}
   return {saved:true};
  });
 }
 async function run(){
  if(env.REVIEW_ENABLED!=='true'||!Number.isFinite(Date.parse(env.REVIEW_START_AFTER||'')))return {paused:true};
  let cursor=(await store.get('scan',{type:'json'}))?.cursor,read=0;
  // Bound each run below provider limits; cursor resumes on the following run.
  const filters=new URLSearchParams({limit:'5',status:'confirmed',paid:'true',agreements_signed:'true',published:'true',scheduled_after:new Date(Date.parse(env.REVIEW_START_AFTER)-DAY).toISOString(),scheduled_before:new Date(now()).toISOString()});
  if(cursor)filters.set('cursor',cursor);
  const list=await hive('inspections?'+filters);
  for(const item of list.data||[]){const detail=await hive('inspections/'+encodeURIComponent(item.id));await enroll(detail);read++;}
  await store.setJSON('scan',{cursor:list.next_cursor||null});
  let processed=0;
  for await(const page of store.list({prefix:'requests/',paginate:true})){
   for(const blob of page.blobs){
    const token=blob.key.slice('requests/'.length),row=await get(token);
    if(row.finishSynced&&(!row.googleReviewedAt||row.hiveTagSynced)||!row.endedAt&&now()<row.expiresAt&&dueStage(row,now())===null)continue;
    if(processed>=20)return {read,processed};await process(token);processed++;
   }
  }
  return {read,processed};
 }
 return {get,save,hive,mc,locked,enroll,process,feedback,confirmGoogle,run};
}
