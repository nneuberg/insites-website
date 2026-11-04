// Production adapters are wired but inert until the independent OFF policy is verified.
import {createHash} from 'node:crypto';
import {createReferralRatingProjection} from './referral-rating-projection.mjs';
import {createMarketingEligibility} from './marketing-eligibility.mjs';
import {AUDIENCES,validToken} from './review-policy.mjs';
import {inReviewScope} from './review-scope.mjs';
const normalized=x=>typeof x==='string'&&x===x.trim().toLowerCase()&&x.length<=254&&/^\S+@\S+\.\S+$/.test(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function validReferralContext(c,email){return c&&Object.keys(c).length===4&&typeof c.personId==='string'&&c.personId.length>0&&c.personId.length<=200&&validToken(c.token)&&typeof c.reviewed==='boolean'&&Array.isArray(c.aliases)&&c.aliases.length>0&&c.aliases.length<=4&&c.aliases.every(normalized)&&new Set(c.aliases).size===c.aliases.length&&c.aliases.includes(email);}
export function createReferralRatingRuntime({config,store,locked,provider,sourceReferral,manualExclusion,currentGoogleReview,env={},now=()=>Date.now(),deadline=Infinity}={}){
 const policy=config.referralRatingProjection||{},enabled=()=>policy.enabled===true&&policy.nativeGuardVerified===true&&policy.exclusiveWriterVerified===true&&typeof policy.interestId==='string'&&!!policy.interestId&&config.referralOwnerEnabled===true;
 const enough=()=>now()<deadline-1000;
 const cursorKey='referral-rating-expiry-cursor',BUCKET=3600000;
 async function writeVerified(key,value,options){
  const result=await store.setJSON(key,value,options);
  if(result?.modified!==true)throw Error('Rating persistence unacknowledged');
  const saved=await store.get(key,{type:'json'});
  if(digest(saved)!==digest(value))throw Error('Rating persistence readback mismatch');
  return result;
 }
 const adapter={get:key=>store.get(key,{type:'json'}),set:async(key,state)=>{
  if(state.status==='granted'){
   // Write cleanup work before publishing a successful grant. Durable state stays
   // granting (and blocks sends) if either write fails or is unacknowledged.
   const initial={bucket:Math.floor(now()/BUCKET)},created=await store.setJSON(cursorKey,initial,{onlyIfNew:true});
   if(created?.modified!==true&&created?.modified!==false)throw Error('Expiry cursor unacknowledged');
   const cursor=await store.get(cursorKey,{type:'json'});
   if(!Number.isSafeInteger(cursor?.bucket)||cursor.bucket<0||cursor.bucket>Math.floor(state.expiresAt/BUCKET)||created.modified===true&&cursor.bucket!==initial.bucket)throw Error('Expiry cursor unverified');
   await writeVerified('referral-rating-expiry/'+Math.floor(state.expiresAt/BUCKET)+'/'+digest(state.binding),{binding:state.binding,expiresAt:state.expiresAt});
  }
  return writeVerified(key,state);
 }};
 async function holdExpiry(itemKey,work,reason){
  // Called under the same identity lock as grants. Retain the work and reason
  // for operator reconciliation without letting it block unrelated expirations.
  await writeVerified('referral-rating-expiry-held/'+digest(itemKey),{sourceKey:itemKey,work,reason,heldAt:now()});
  await store.delete(itemKey);
  if(await store.get(itemKey,{type:'json'})!==null)throw Error('Expiry quarantine removal unverified');
 }

 function service(binding,context,executor,alreadyLocked=false){
  const readCurrent=async()=>{if(!enough())throw Error('Rating deadline');const row=await store.get('requests/'+binding.token,{type:'json'});return {row,observedAt:now(),generation:digest(row||null)};};
  const grantAllowed=async(b,row)=>{
   if(!enough()||!validReferralContext(context,b.email)||!inReviewScope(row,env)||row.isTest||executor.positiveRatingInterest!==policy.interestId||executor.nativePositiveRatingGuardVerified!==true)return {eligible:false};
   for(const email of context.aliases){const excluded=await manualExclusion(email);if(excluded?.verified!==true||excluded.excluded)return {eligible:false};}
   const person={id:b.personId,email:b.email,reviewSequence:{token:b.token,...(context.reviewed?{googleReview:{confirmedAt:row.googleReviewedAt}}:{})}},state={people:Object.fromEntries(context.aliases.map((email,n)=>[String(n),{email}]))},intent={program:'referral-customer-v1',stage:context.reviewed?'initial-reviewed':'initial-unreviewed',context:{token:b.token}};
   const eligibility=createMarketingEligibility({reviewRow:async()=>row,sourceReferral,currentGoogleReview:(id)=>currentGoogleReview(id,{forceFresh:true}),now});
   const check=await eligibility({person,state,intent,executor});if(check.eligible!==true)return {eligible:false};
   let subscribed=0;
   for(const email of context.aliases)for(const audienceId of config.audiences){
    if(!enough())return {eligible:false};const m=await provider.member(audienceId,email);if(!m)continue;
    if(['unsubscribed','cleaned'].includes(m.status))return {eligible:false};
    if(m.status==='subscribed'){subscribed++;if(email!==b.email||audienceId!==b.audienceId)return {eligible:false};
     // Grant policy checks the other native conditions; the actual marker is
     // independently read after projection and again at the final trigger.
     if(!check.nativeGuard({...m,interests:{...m.interests,[policy.interestId]:true}}))return {eligible:false};
    }
   }
   return {eligible:subscribed===1,observedAt:Math.min(check.observedAt,check.ratingProof.observedAt)};
  };
  return createReferralRatingProjection({config:policy,store:adapter,locked:(_key,fn)=>alreadyLocked?fn():locked('Customer:'+binding.email,fn),readCurrent,currentGoogleReview,grantAllowed,provider,now});
 }
 async function bound(context,email,executor){
  if(!validReferralContext(context,email)||!executor||executor.audienceId!==AUDIENCES.Customer)return null;
  const row=await store.get('requests/'+context.token,{type:'json'});
  if(!row||row.isTest||row.token!==context.token||row.email!==email||row.role!=='Customer'||typeof row.contactId!=='string'||!row.contactId)return null;
  return {binding:{audienceId:AUDIENCES.Customer,email,token:context.token,personId:context.personId,contactId:row.contactId},row};
 }
 async function reconcile({person,state,intent,executor}){
  if(!enabled())return {off:true};if(!enough())return {held:true};
  const context={personId:person.id,token:intent.context?.token,reviewed:!!person.reviewSequence?.googleReview,aliases:[...new Set(Object.values(state.people||{}).map(p=>p.email).filter(Boolean))]};
  const b=await bound(context,person.email,executor);if(!b)return {held:true};
  return service(b.binding,context,executor).reconcile(b.binding);
 }
 async function lastMile(d,consume){
  if(!enabled()||!enough()||!validReferralContext(d.referralContext,d.email))return;
  const executor=config.executors[d.executorKey];
  if(!executor||JSON.stringify(executor)!==d.binding||d.executorKey!=='referral-customer-v1:'+(d.referralContext.reviewed?'initial-reviewed':'initial-unreviewed'))return;
  return locked('Customer:'+d.email,async()=>{
   const b=await bound(d.referralContext,d.email,executor);if(!b)return;
   const valid=await service(b.binding,d.referralContext,executor,true).validateForDispatch(b.binding);
   if(!valid.valid||!enough())return;
   // Full native guard is re-evaluated on the real marker immediately before
   // consuming the proxy's one-shot continuation, while the feedback lock is held.
   const eligibility=createMarketingEligibility({reviewRow:token=>store.get('requests/'+token,{type:'json'}),sourceReferral,currentGoogleReview:id=>currentGoogleReview(id,{forceFresh:true}),now});
   const person={email:d.email,reviewSequence:{token:b.binding.token,...(d.referralContext.reviewed?{googleReview:{confirmedAt:b.row.googleReviewedAt}}:{})}},state={people:Object.fromEntries(d.referralContext.aliases.map((email,n)=>[n,{email}]))},intent={program:'referral-customer-v1',stage:d.referralContext.reviewed?'initial-reviewed':'initial-unreviewed',context:{token:b.binding.token}};
   const check=await eligibility({person,state,intent,executor}),member=await provider.member(executor.audienceId,d.email);
   if(check.eligible!==true||!member||member.status!=='subscribed'||!check.nativeGuard(member)||!enough()||now()>=valid.expiresAt)return;
   return consume({verified:true,attemptId:d.attemptId,email:d.email,executorBinding:d.binding,observedAt:Math.min(check.observedAt,check.ratingProof.observedAt),expiresAt:valid.expiresAt});
  });
 }
 async function invalidate(row){
  if(!enabled()||row?.isTest||row?.role!=='Customer')return {off:true};
  if(!enough())return {held:true,uncertain:true,reason:'rating_invalidation_deadline'};
  const key='referral-rating/'+digest([AUDIENCES.Customer,row.email]),old=await adapter.get(key);
  if(!enough())return {held:true,uncertain:true,reason:'rating_invalidation_deadline'};
  if(!old?.binding||old.binding.token!==row.token||old.binding.contactId!==row.contactId)return {absent:true};
  // Called inside feedback's existing Customer/email lock. Invalidate every edit,
  // even 5→4, so a new generation must qualify independently at next preflight.
  return service(old.binding,null,null,true).invalidate(old.binding,'rating_changed');
 }
 async function cleanup(){
  if(!enabled()||!enough())return {off:true};
  return locked('referral-rating-expiry-cleanup',async()=>{
   const saved=await adapter.get(cursorKey);if(!Number.isSafeInteger(saved?.bucket))return {examined:0,revoked:0};
   let bucket=saved.bucket,examined=0,revoked=0;
   // Actual installed Blobs SDK has no public cursor/limit option. Read at most
   // one page per hour bucket and two buckets/records per invocation. Deleting
   // completed internal queue work prevents first-page starvation without a scan.
   for(let buckets=0;buckets<2&&bucket<=Math.floor(now()/BUCKET)&&enough();buckets++){
    const iterator=store.list({prefix:'referral-rating-expiry/'+bucket+'/',paginate:true})[Symbol.asyncIterator](),first=await iterator.next();
    const entries=first.value?.blobs||[];
    if(!entries.length){if(bucket===Math.floor(now()/BUCKET))return {examined,revoked};bucket++;await adapter.set(cursorKey,{bucket});continue;}
    for(const item of entries){
     if(examined>=2||!enough())return {examined,revoked};examined++;
     const firstWork=await adapter.get(item.key);if(!firstWork?.binding)return {examined,revoked,held:true};
     const result=await locked('Customer:'+firstWork.binding.email,async()=>{
      const work=await adapter.get(item.key);if(!work)return {done:true};
      if(!Number.isSafeInteger(work.expiresAt)||work.binding?.email!==firstWork.binding.email)return {held:true};
      if(work.expiresAt>now())return {future:true};
      const key='referral-rating/'+digest([work.binding.audienceId,work.binding.email]),record=await adapter.get(key);
      let didRevoke=false;
      if(record?.status==='granted'){
       if(record.expiresAt>now())return {future:true};
       const row=await store.get('requests/'+record.binding.token,{type:'json'});if(row?.isTest){await holdExpiry(item.key,work,'test_identity_changed');return {held:true,quarantined:true};}
       const r=await service(record.binding,null,null,true).invalidate(record.binding,'projection_expired');if(!r.revoked){await holdExpiry(item.key,work,'revocation_unresolved');return {held:true,quarantined:true};}didRevoke=true;
      }else if(record&&['granting','revoking','uncertain'].includes(record.status)){await holdExpiry(item.key,work,'provider_write_unresolved');return {held:true,quarantined:true};}
      await store.delete(item.key); // Internal work only; under the grant lock.
      return {done:true,revoked:didRevoke};
     });
     if(result.revoked)revoked++;
     if(result.held&&!result.quarantined)return {examined,revoked,held:true};

    }
    // Revisit this bucket next run; the SDK's next page cursor is private.
    return {examined,revoked};
   }
   return {examined,revoked};
  });
 }
 return {reconcile,lastMile,invalidate,cleanup,enabled};
}
