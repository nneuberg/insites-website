import {createHash} from 'node:crypto';
import {verifyHive} from './referral-hive.mjs';
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
// The Automation envelope adapter must be verified against an actual signed
// delivery before wiring this receiver into production. No API-envelope guess.
export function createReviewWebhook({secret,organizationId,decode,enqueue,enabled=false,now=()=>Date.now()}){
 return async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  if(!enabled||!secret||!idOK(organizationId)||typeof decode!=='function')return new Response(null,{status:503});
  if(Number(request.headers.get('content-length'))>262144)return new Response(null,{status:413});
  const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
  const parts=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
   if(length>262144){await reader.cancel();return new Response(null,{status:413});}parts.push(value);}
  const raw=Buffer.concat(parts);
  try{verifyHive(raw,request.headers,secret,now());}catch{return new Response(null,{status:401});}
  let event;try{event=decode(JSON.parse(raw.toString('utf8')),request.headers);}catch{return new Response(null,{status:400});}
  if(!event||event.kind!=='inspection-complete'||!idOK(event.inspectionId)||!idOK(event.organizationId)||!idOK(event.instanceId)||!idOK(event.templateId)||typeof event.test!=='boolean')return new Response(null,{status:400});
  if(event.organizationId!==organizationId)return new Response(null,{status:403});
  if(event.test)return new Response(null,{status:204});
  // Persist only identifiers, not customer data, payment details or raw payload.
  const key=createHash('sha256').update(event.organizationId+':'+event.templateId+':'+event.instanceId).digest('hex');
  try{await enqueue('review-events/'+key,{inspectionId:event.inspectionId,organizationId:event.organizationId,templateId:event.templateId,instanceId:event.instanceId,state:'pending',receivedAt:now(),attempts:0,nextAttemptAt:0},{onlyIfNew:true});}
  catch{return new Response(null,{status:503});}
  return new Response(null,{status:202});
 };
}
export async function drainReviewEvents({store,engine,organizationId,now=()=>Date.now(),limit=10}){
 let processed=0,failed=0;
 if(!organizationId)return {processed,failed};
 for await(const page of store.list({prefix:'review-events/',paginate:true}))for(const blob of page.blobs){
  if(processed+failed>=limit)return {processed,failed};
  const first=await store.get(blob.key,{type:'json'});
  if(first?.state!=='pending'||first.nextAttemptAt>now()||first.organizationId!==organizationId)continue;
  try{await engine.locked(blob.key,async()=>{
   const row=await store.get(blob.key,{type:'json'});
   if(row?.state!=='pending'||row.nextAttemptAt>now())return;
   try{
    const inspection=await engine.hive('inspections/'+encodeURIComponent(row.inspectionId));
    if(String(inspection?.id)!==row.inspectionId)throw Error('Inspection mismatch');
    const result=await engine.enroll(inspection);
    if(result.paused)return; // Keep queued while sending is disabled.
    await store.setJSON(blob.key,{...row,state:'done',completedAt:now()});processed++;
   }catch{
    const attempts=row.attempts+1;
    await store.setJSON(blob.key,{...row,attempts,nextAttemptAt:now()+Math.min(3600000,60000*2**Math.min(attempts-1,6))});failed++;
   }
  });}catch{failed++;}
 }
 return {processed,failed};
}
