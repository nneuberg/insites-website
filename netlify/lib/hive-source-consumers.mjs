import {createHash} from 'node:crypto';
import {tagChanges} from './hive-tag-sync.mjs';
import {reconcileInspection} from './referral-reconcile.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized=value=>String(value||'').trim().toLowerCase();
const validId=id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id);
const emailOK=email=>/^\S+@\S+\.\S+$/.test(email);
const roles=['Agent','Customer'];
const saved=async(store,key,value)=>{if((await store.setJSON(key,value))?.modified!==true)throw Error('Consumer checkpoint not confirmed');};
const jobs=items=>items.map(item=>{const job=typeof item==='string'?{id:item}:item;if(!validId(job?.id))throw Error('Invalid changed source ID');return job;});
// Caller owns dirty-job CAS acknowledgments. Never blindly delete a queue item:
// acknowledge only the exact input version returned here, preserving newer arrivals.
export async function reconcileChangedTags({contactIds,view,catalog,engine,checkpointStore,apply=false,now=()=>Date.now(),maxItems=1,maxAgeMs=86400000,maxAudiences=1,budgetMs=2000}){
 if(!catalog?.complete||!Array.isArray(catalog.names)||catalog.names.some(n=>typeof n!=='string'||!n.trim())||!Number.isSafeInteger(catalog.verifiedAt)||now()<catalog.verifiedAt||now()-catalog.verifiedAt>maxAgeMs)throw Error('Fresh complete cached tag catalog required');
 if(typeof engine.locked!=='function')throw Error('Tag consumer lock required');
 return engine.locked('hive-tag-reconciliation',async()=>{
  const started=now();let audiences=0;
  const report={completed:[],held:[],deferred:[],checked:0,missingMembers:0,added:0,removed:0};
  const seen=new Map();
  for(const job of jobs(contactIds).slice(0,maxItems)){
   try{
    const contact=await view.getContact(job.id),email=normalized(contact.email);
    if(!emailOK(email)||!Array.isArray(contact.tags)||contact.tags.some(t=>typeof t?.name!=='string'||!t.name.trim()))throw Error('Incomplete cached contact');
    const names=[...new Set(contact.tags.map(t=>t.name))],sourceKey=digest(names.map(normalized).sort()),key='source-consumers/tags/'+(apply?'live/':'audit/')+digest(email);
    if(seen.get(email)===sourceKey){if(apply)report.completed.push(job);continue;}
    let progress=await checkpointStore.get(key,{type:'json'});
    if(progress&&(progress.schema!==1||!Array.isArray(progress.completedRoles)||progress.completedRoles.some(r=>!roles.includes(r))||new Set(progress.completedRoles).size!==progress.completedRoles.length))throw Error('Invalid audience checkpoint');
    if(!progress||progress.sourceKey!==sourceKey){progress={schema:1,sourceKey,completedRoles:[]};await saved(checkpointStore,key,progress);}
    for(const role of roles){
     if(progress.completedRoles.includes(role))continue;
     if(audiences>=maxAudiences||now()-started>=budgetMs)break;
     audiences++;
     let member;try{member=await engine.mc({email,role},undefined,'GET');}catch(error){if(error.status!==404)throw error;member=null;report.missingMembers++;}
     const changes=member?tagChanges(names,member.tags?.map(t=>t?.name),catalog.names):[];
     if(apply&&changes.length&&now()-started>=budgetMs)throw Error('Tag consumer time budget; retain audience');
     if(apply&&changes.length)await engine.mc({email,role},{tags:changes},'POST','/tags');
     report.added+=changes.filter(t=>t.status==='active').length;report.removed+=changes.filter(t=>t.status==='inactive').length;
     // A failed/uncertain write never reaches this checkpoint. Next attempt rereads
     // member tags before an idempotent status update; it never creates a member.
     progress={...progress,completedRoles:[...progress.completedRoles,role]};await saved(checkpointStore,key,progress);
    }
    report.checked++;if(progress.completedRoles.length===roles.length){seen.set(email,sourceKey);if(apply)report.completed.push(job);}else report.deferred.push(job);
   }catch(error){report.held.push({job,reason:error.code||error.message});}
  }
  return report;
 });
}
export async function reconcileChangedReferrals({inspectionIds,view,callLedger,checkpointStore,locked,serviceIds=[],now=()=>Date.now(),maxItems=1}){
 if(typeof locked!=='function')throw Error('Referral consumer lock required');
 return locked('hive-referral-changed',async lease=>{
  if(typeof lease?.assertHeld!=='function'||!lease.signal||!Number.isSafeInteger(lease.fence))throw Error('Fenced source lease required');
  const options={signal:lease.signal,deadline:lease.deadline,sourceLease:{scope:'hive-referral-changed',owner:lease.owner,fence:lease.fence,deadline:lease.deadline}};
  const invoke=async(action,data)=>{await lease.assertHeld();const result=await callLedger(action,data,options);await lease.assertHeld();return result;};
  const checkpoint=async(key,value)=>{
   await lease.assertHeld();const prior=await checkpointStore.getWithMetadata(key,{type:'json'});
   if(prior?.data?.fence>lease.fence)throw Error('Stale consumer fence');
   await lease.assertHeld();
   if((await checkpointStore.setJSON(key,{...value,fence:lease.fence},prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true}))?.modified!==true)throw Error('Consumer checkpoint conflict');
   await lease.assertHeld();
  };
  const snapshot=await invoke('codeSnapshot',{});
  if(snapshot?.sourceFencing!=='v1'||snapshot?.version!=='2026-10-22-reconcile'||!Array.isArray(snapshot.codes)||!Array.isArray(snapshot.uses))throw Error('Verified referral ledger snapshot required');
  const report={completed:[],held:[],matched:0,qualificationHeld:0};
  const verifiedLedger=async(action,data)=>{const result=await invoke(action,data);if(action==='holdCodeUse'?typeof result?.held!=='boolean':action==='recordCodeUse'&&typeof result?.matched!=='boolean'&&typeof result?.held!=='boolean')throw Error('Ledger write receipt uncertain');return result;};
  for(const job of jobs(inspectionIds).slice(0,maxItems)){
   try{
    let inspection;try{inspection=await view.getInspection(job.id);await lease.assertHeld();if(inspection?.id!==job.id)throw Error('Cached inspection mismatch');}catch(error){await verifiedLedger('holdCodeUse',{inspectionId:job.id,reason:'Hive verification unavailable; retry required'});throw error;}
    const sourceKey=digest({inspection,eventId:job.eventId||'',version:job.revision??job.version??null,codes:snapshot.codes});
    const key='source-consumers/referrals/'+digest(job.id);let progress=await checkpointStore.get(key,{type:'json'});
    await lease.assertHeld();
    if(progress&&(progress.schema!==1||typeof progress.completed!=='boolean'||!Number.isSafeInteger(progress.observedAt)||progress.observedAt<0||progress.completed&&(!progress.result||typeof progress.result.matched!=='boolean'||typeof progress.result.held!=='boolean')))throw Error('Invalid referral checkpoint');
    if(progress?.sourceKey!==sourceKey){progress={schema:1,sourceKey,observedAt:now(),completed:false};await checkpoint(key,progress);}
    if(!progress.completed){
     const result=await reconcileInspection({id:job.id,eventId:job.eventId||sourceKey,read:async path=>{if(path!=='inspections/'+encodeURIComponent(job.id))throw Error('Unsupported cached referral read');return inspection;},callLedger:verifiedLedger,snapshot,serviceIds,now:()=>progress.observedAt});
     progress={...progress,completed:true,result};await checkpoint(key,progress);
    }
    if(progress.result?.matched)report.matched++;if(progress.result?.held)report.qualificationHeld++;
    await lease.assertHeld();report.completed.push(job);
   }catch(error){report.held.push({job,reason:error.code||error.message});}
  }
  return report;
 });
}
