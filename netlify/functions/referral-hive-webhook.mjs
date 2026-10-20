import {createHash} from 'node:crypto';
import {verifyHive,INSPECTION_EVENTS} from '../lib/referral-hive.mjs';
export function createHiveWebhook({env=process.env,enqueue,now=()=>Date.now()}={}){
 return async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  if(env.REFERRAL_HIVE_WEBHOOK_ENABLED!=='true'||!env.REFERRAL_HIVE_WEBHOOK_SECRET)return new Response(null,{status:503});
  if(Number(request.headers.get('content-length'))>262144)return new Response(null,{status:413});
  const raw=await request.text();if(Buffer.byteLength(raw)>262144)return new Response(null,{status:413});
  try{verifyHive(raw,request.headers,env.REFERRAL_HIVE_WEBHOOK_SECRET,now());}catch{return new Response(null,{status:401});}
  let e;try{e=JSON.parse(raw);}catch{return new Response(null,{status:400});}
  if(e.test===true)return new Response(null,{status:204});
  if(!INSPECTION_EVENTS.has(e.event))return new Response(null,{status:204});
  if(!env.HIVE_ORGANIZATION_ID||e.organization?.id!==env.HIVE_ORGANIZATION_ID)return new Response(null,{status:403});
  if(e.api_version!=='v1'||!/^evt_[a-zA-Z0-9_-]+$/.test(e.id||'')||!/^[-a-zA-Z0-9]{1,100}$/.test(e.data?.inspection?.id||''))return new Response(null,{status:400});
  if(request.headers.get('x-hiveinspect-event-id')&&request.headers.get('x-hiveinspect-event-id')!==e.id)return new Response(null,{status:400});
  // Only IDs are queued. Never trust event money/status; worker must read fresh Hive data.
  try{await enqueue(createHash('sha256').update(e.id).digest('hex'),{eventId:e.id,event:e.event,inspectionId:e.data.inspection.id,receivedAt:new Date(now()).toISOString()});}
  catch{return new Response(null,{status:503});}
  return new Response(null,{status:202});
 };
}
export default async request=>{
 const {getStore}=await import('@netlify/blobs');
 const store=getStore({name:'insites-referral-hive-events',consistency:'strong'});
 return createHiveWebhook({enqueue:(key,value)=>store.setJSON('pending/'+key,value,{onlyIfNew:true})})(request);
};
