import {HiveUnavailable,hiveUnavailable} from './hive-incident.mjs';
import {queueLowRating,deliverLowRating} from './review-low-rating.mjs';
import {inReviewScope,excludedRequest,roleCutoff} from './review-scope.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {AUDIENCES,DAY,ORIGIN,eligibleRecipients,referralDates,dueStage,validToken} from './review-policy.mjs';
export function createEngine({store,env=process.env,fetcher=fetch,now=()=>Date.now(),hivePaused=false,hiveTransport=null,sourceContact=null}){
 const inLaunchScope=row=>inReviewScope(row,env);
 const projectionPaused=env.REVIEW_PROJECTION_PAUSED==='true';
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const rowKey=t=>'requests/'+t;
 async function api(url,options={}){
  const r=await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=new Error('API request failed');e.status=r.status;throw e;}
  return r.status===204?null:r.json();
 }
 async function hive(path,body){
  if(hivePaused)throw new HiveUnavailable();
  if(!env.HIVE_API_KEY)throw new HiveUnavailable();
  try{if(hiveTransport){const response=await hiveTransport.request(path,{method:body?'PATCH':'GET',...(body?{body}:{})});return response.status===204?null:response.json();}
   return await api('https://api.hiveinspect.com/v1/'+path,{method:body?'PATCH':'GET',headers:{Authorization:'Bearer '+env.HIVE_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
  catch(error){throw new HiveUnavailable(error.status||503);}
 }
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
  // Test feedback is stored locally but must never change real audience tags.
  if(row.isTest){row.finishSynced=true;await save(row);return;}
  if(projectionPaused||env.REVIEW_ENABLED!=='true')return;
  await mc(row,{merge_fields:{RVPEND:'ENDED',...(row.ratedAt?{RVFEED:'YES'}:{}),...(row.googleReviewedAt?{RVGDONE:'YES'}:{})}});
  // Review launch must not enroll clients into unrelated referral journeys.
  if(env.REVIEW_REFERRALS_ENABLED==='true'&&row.role==='Customer'&&!row.isTest)await mc(row,{merge_fields:referralDates(row.endedAt)});
  row.finishSynced=true;await save(row);
 }
 async function syncHiveTag(row){
  if(row.isTest||projectionPaused||env.REVIEW_ENABLED!=='true')return;
  const contact=await hive('contacts/'+encodeURIComponent(row.contactId));
  if(!Array.isArray(contact.tags)||contact.tags.some(t=>typeof t?.name!=='string'||!t.name.trim()))throw new HiveUnavailable();
  const tags=contact.tags.map(t=>t.name);
  // Reuse the verified Hive taxonomy spelling; never add a case-only duplicate.
  if(!tags.some(name=>name.toLowerCase()==='google reviewed')){
   await hive('contacts/'+encodeURIComponent(row.contactId),{tags:[...tags,'google reviewed']});
  }
  row.hiveTagSynced=true;await save(row);
 }
 async function confirmGoogle(token,review){
  if(env.REVIEW_ENABLED!=='true')throw Error('Review processing is paused');
  if(excludedRequest(token)||!validToken(token)||!review?.reviewId)throw Error('Invalid match');
  const first=await get(token);if(!first||first.isTest||!inLaunchScope(first))throw Error('Review request not found');
  return locked('google:'+review.reviewId,()=>locked(first.role+':'+first.email,async()=>{
   const row=await get(token),claimKey='confirmed/'+hash(review.reviewId),claim=await store.get(claimKey,{type:'json'});
   if(claim&&claim.token!==token)throw Error('This Google review is already assigned to another person');
   if(row.googleReviewId&&row.googleReviewId!==review.reviewId)throw Error('This contact already has a confirmed review');
   await store.setJSON(claimKey,{token},{onlyIfNew:true});
   if(!row.googleReviewId){
    row.googleReviewId=review.reviewId;row.googleReviewedAt=row.googleReviewedAt||now();row.googleReview=review;
    // Confirmation may replace an earlier feedback-end date once.
    if(!row.googleConfirmationEndedAt)row.endedAt=now();row.googleConfirmationEndedAt=row.endedAt;
    row.finishSynced=false;await save(row);
   }
   // Resume incomplete work without replaying already acknowledged provider writes.
   if(!row.finishSynced)await finish(row);
   if(!row.hiveTagSynced)await syncHiveTag(row);
   return {confirmed:true};
  }));
 }
 async function send(row,stage){
  if(projectionPaused)return;
  const member=await mc(row,undefined,'GET');
  if(member.merge_fields?.RVGDONE==='YES'||member.tags?.some(t=>t.name==='google reviewed')){row.googleReviewedAt=now();row.endedAt=now();await save(row);await finish(row);return;}
  if(member.status!=='subscribed'){row.endedAt=now();row.suppressed=true;row.finishSynced=true;await save(row);return;}
  if(!member.merge_fields||!['RVPEND','RVFEED','RVGDONE'].every(k=>Object.hasOwn(member.merge_fields,k)))throw Error('Review field schema unavailable');
  if(!['','YES'].includes(member.merge_fields.RVFEED)||!['','YES'].includes(member.merge_fields.RVGDONE))throw Error('Unknown review terminal state');
  if(member.merge_fields.RVFEED==='YES'){row.endedAt=now();await save(row);await finish(row);return;}
  if(member.merge_fields.RVPEND==='ENDED'){row.endedAt=now();row.finishSynced=true;await save(row);return;}
  const stageValue='STAGE'+stage,pending=member.merge_fields.RVPEND===stageValue;
  // Existing policy is ONE sequence per person. Monotonic stage values replace
  // remove/re-add tag toggles. This acknowledges projection, not email delivery.
  if(row.preparingStage===stage&&row.stagePrepared&&pending){row.sentStages=[...new Set([...row.sentStages,...Array.from({length:stage+1},(_,n)=>n)])];delete row.preparingStage;delete row.stagePrepared;await save(row);return;}
  if(pending||member.merge_fields.RVPEND==='ENDED'||/^STAGE[0-2]$/.test(member.merge_fields.RVPEND)&&Number(member.merge_fields.RVPEND.slice(-1))>=stage)throw Error('Review stage requires reconciliation');
  if(member.merge_fields.RVPEND!==''&&!/^STAGE[0-2]$/.test(member.merge_fields.RVPEND))throw Error('Unknown review stage');
  row.preparingStage=stage;row.stagePrepared=false;await save(row);
  // Existing Mailchimp star links append ?rating=N, so keep REVLINK query-free.
  await mc(row,{merge_fields:{REVLINK:ORIGIN+'/review/r/'+row.token,REVADDR:row.address}});
  row.stagePrepared=true;await save(row);
  await mc(row,{merge_fields:{RVPEND:stageValue}});
  row.sentStages=[...new Set([...row.sentStages,...Array.from({length:stage+1},(_,n)=>n)])];delete row.preparingStage;delete row.stagePrepared;await save(row);
 }
 async function enroll(inspection){
  const cutoff=Date.parse(env.REVIEW_START_AFTER||'');
  if(projectionPaused||!Number.isFinite(cutoff)||env.REVIEW_ENABLED!=='true')return {paused:true};
  let added=0;
  for(const original of eligibleRecipients(inspection,now())){
   if(original.endedAt<cutoff)continue;
   // Already-enrolled people require no new source lookup. Recheck under the
   // existing lock below still handles concurrent enrollment safely.
   const priorIndexes=await Promise.all(['person:'+original.email,'Customer:'+original.email,'Agent:'+original.email].map(k=>store.get('people/'+hash(k),{type:'json'})));
   if((await Promise.all(priorIndexes.filter(Boolean).map(index=>get(index.token)))).some(Boolean))continue;
   if(hivePaused)throw new HiveUnavailable();
   let contact;
   try{contact=sourceContact?await sourceContact(original.contactId):await hive('contacts/'+encodeURIComponent(original.contactId));}
   catch(error){if(error?.code==='HIVE_SOURCE_DEFERRED')throw new HiveUnavailable();throw error;}
   if(contact.tags?.some(t=>t.name.toLowerCase()==='google reviewed'))continue;
   // A person linked as an agent elsewhere must never receive a client reward invitation.
   const person={...original,role:contact.roles?.some(r=>['Buyer Agent','Seller Agent','Listing Agent','Agent'].includes(r))?'Agent':original.role};
   if(env.REVIEW_CLIENT_ONLY==='true'&&person.role!=='Customer')continue;
   if(env.REVIEW_BUYER_ONLY==='true'&&person.role==='Agent'){
    const buyer=inspection.contacts.some(c=>c.role==='Buyer Agent'&&String(c.email||'').trim().toLowerCase()===person.email);
    if(!buyer)continue;
    person.buyerAgentVerified=true;
   }
   const personCutoff=roleCutoff(person.role,env);
   if(!Number.isFinite(personCutoff)||person.endedAt<personCutoff)continue;
   const identity='person:'+person.email;
   await locked(identity,async()=>{
    // Respect both legacy role indexes as well as the shared person index.
    const indexes=await Promise.all(['person:'+person.email,'Customer:'+person.email,'Agent:'+person.email].map(k=>store.get('people/'+hash(k),{type:'json'})));
    for(const existing of indexes)if(existing&&await get(existing.token))return;
    const indexKey='people/'+hash(identity),index=indexes[0];
    const prior=index?await get(index.token):null;
    // One review sequence per person, including repeat inspections.
    if(prior)return;
    const token=index?.token||randomBytes(24).toString('hex');
    const row={...person,inspectionEndedAt:person.endedAt,endedAt:null,token,createdAt:now(),expiresAt:now()+14*DAY,sentStages:[]};
    delete row.endedAt;
    try{const member=await mc(row,undefined,'GET');if(member.status!=='subscribed'||member.merge_fields?.RVGDONE==='YES'||member.tags?.some(t=>t.name==='google reviewed'))return;}catch(e){if(e.status===404)return;throw e;}
    // Index and row creation happen under a per-person lock; indexes recover from a crash between writes.
    await store.setJSON(indexKey,{token},{onlyIfNew:true});await save(row);added++;
   });
  }
  return {added};
 }
 async function process(token){
  if(projectionPaused||env.REVIEW_ENABLED!=='true'||excludedRequest(token))return;
  const initial=await get(token);if(!initial)return;
  return locked(initial.role+':'+initial.email,async()=>{
   const row=await get(token);
   if(row.isTest||!inLaunchScope(row))return;
   await deliverLowRating(row,{env,fetcher,save,now});
   if(row.endedAt){if(!row.finishSynced&&!row.suppressed)await finish(row);if(row.googleReviewedAt&&!row.hiveTagSynced)await syncHiveTag(row);return;}
   if(now()>=row.expiresAt){row.endedAt=row.expiresAt;await save(row);await finish(row);return;}
   const stage=dueStage(row,now());if(stage!==null&&stage>=0)await send(row,stage);
  });
 }
 async function feedback(token,input){
  if(excludedRequest(token)||!validToken(token))throw Error('Invalid review link');
  const first=await get(token);if(!first)throw Error('Review not found');
  return locked(first.role+':'+first.email,async()=>{
   const row=await get(token);
   if(!row.isTest&&(env.REVIEW_ENABLED!=='true'||!inLaunchScope(row)))throw Error('Review processing is paused');
   if(now()>=row.expiresAt)throw Error('Review link expired');
   if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5||typeof input.feedback!=='string'||input.feedback.length>4000)throw Error('Invalid feedback');
   if(row.ratedAt){
    const feedback=input.feedback.trim(),revision=row.feedbackRevision||1;
    if(row.rating===input.rating&&row.feedback===feedback)return {saved:true};
    if(input.revision!==revision)throw Object.assign(Error('Feedback changed. Reload this page before editing.'),{status:409});
    row.rating=input.rating;row.feedback=feedback;row.feedbackRevision=revision+1;row.feedbackUpdatedAt=now();
    queueLowRating(row,now());await save(row);return {saved:true};
   }
   if(input.revision!==undefined&&input.revision!==0)throw Object.assign(Error('Feedback changed. Reload this page before editing.'),{status:409});
   row.rating=input.rating;row.feedback=input.feedback.trim();row.ratedAt=now();row.endedAt=now();queueLowRating(row,now());await save(row);
   try{await finish(row);}catch{/* Stored feedback is retried by the worker. */}
   return {saved:true};
  });
 }
 async function run({discover=true}={}){
  if(projectionPaused||env.REVIEW_ENABLED!=='true'||!Number.isFinite(Date.parse(env.REVIEW_START_AFTER||'')))return {paused:true};
  let read=0,discoveryDeferred=false;
  if(discover){
  try{
  let cursor=(await store.get('scan',{type:'json'}))?.cursor;
  // Bound each run below provider limits; cursor resumes on the following run.
  const filters=new URLSearchParams({limit:'5',status:'confirmed',paid:'true',agreements_signed:'true',published:'true',scheduled_after:new Date(Date.parse(env.REVIEW_START_AFTER)-DAY).toISOString(),scheduled_before:new Date(now()).toISOString()});
  if(cursor)filters.set('cursor',cursor);
  const list=await hive('inspections?'+filters);
  for(const item of list.data||[]){const detail=await hive('inspections/'+encodeURIComponent(item.id));await enroll(detail);read++;}
  await store.setJSON('scan',{cursor:list.next_cursor||null});
  }catch(error){if(!hiveUnavailable(error))throw error;discoveryDeferred=true;}
  }
  let processed=0,hiveDeferred=0;
  for await(const page of store.list({prefix:'requests/',paginate:true})){
   for(const blob of page.blobs){
    if(excludedRequest(blob.key))continue;
    const token=blob.key.slice('requests/'.length),row=await get(token);
    if(!inLaunchScope(row))continue;
    if(row.lowRatingAlert?.state!=='pending'&&(row.finishSynced&&(!row.googleReviewedAt||row.hiveTagSynced)||!row.endedAt&&now()<row.expiresAt&&dueStage(row,now())===null))continue;
    // Already-finished rows waiting only on Hive must not consume the send budget.
    if(hivePaused&&row.endedAt&&row.finishSynced&&row.googleReviewedAt&&!row.hiveTagSynced&&row.lowRatingAlert?.state!=='pending'){hiveDeferred++;continue;}
    if(processed>=20)return {read,processed,discoveryDeferred,hiveDeferred};
    try{await process(token);}catch(error){if(!hiveUnavailable(error))throw error;hiveDeferred++;}
    processed++;
   }
  }
  return {read,processed,discoveryDeferred,hiveDeferred};
 }
 return {get,save,hive,mc,locked,enroll,process,feedback,confirmGoogle,run};
}

