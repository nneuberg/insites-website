import {createHash} from 'node:crypto';
import {verifyHive} from './referral-hive.mjs';
export const BOOTSTRAP_TEMPLATE='66b1c688-3157-4a23-b646-487426af8e6c';
const identifier=value=>{
 const text=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 if(typeof text!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(text))throw Error('Invalid identifier');
 return text;
};
export function automationEnvelope(body,headers,{organizationId,templateId,bootstrap=false}){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid envelope');
 const organization=identifier(body.organization?.id),template=identifier(body.automation_template_id),instance=identifier(body.automation_instance_id);
 if(template!==identifier(templateId))throw Error('Unexpected template');
 if(organizationId){if(organization!==identifier(organizationId))throw Error('Unexpected organization');}
 else if(!bootstrap||template!==BOOTSTRAP_TEMPLATE)throw Error('Organization required');
 if(headers.get('x-automation-instance-id')!==instance)throw Error('Instance mismatch');
 if(typeof body.event!=='string'||!/^[a-zA-Z0-9_. -]{1,100}$/.test(body.event)||!Number.isFinite(Date.parse(body.fired_at)))throw Error('Invalid event');
 if(!Array.isArray(body.payload_sections)||body.payload_sections.length>20||!body.payload_sections.every(s=>typeof s==='string'&&/^[a-zA-Z_ -]{1,50}$/.test(s)))throw Error('Invalid sections');
 if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw Error('Invalid data');
 return {organizationId:organization,templateId:template,instanceId:instance,event:body.event};
}
// Values are never retained: a signed test may contain real inspection/customer
// data. Collect only bounded structural types for the concrete adapter contract.
export function payloadShape(value,depth=0){
 if(value===null)return 'null';if(depth>=6)return Array.isArray(value)?'array':typeof value;
 if(Array.isArray(value))return {type:'array',sample:value.length?payloadShape(value[0],depth+1):null};
 if(typeof value==='object')return Object.fromEntries(Object.keys(value).slice(0,60).map(key=>[/^[a-zA-Z_][a-zA-Z0-9_]{0,59}$/.test(key)?key:'[redacted-key]',payloadShape(value[key],depth+1)]));
 return typeof value;
}
export function createAutomationCapture({secret,organizationId,templateId,bootstrap=false,save,now=()=>Date.now()}){
 return async request=>{
  const reply=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(!secret||!templateId||(!organizationId&&!(bootstrap&&templateId===BOOTSTRAP_TEMPLATE)))return reply({error:'Capture not configured'},503);
  if(Number(request.headers.get('content-length'))>262144)return reply({error:'Too large'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'Missing body'},400);
  const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return reply({error:'Too large'},413);}parts.push(value);}
  const raw=Buffer.concat(parts);
  try{verifyHive(raw,request.headers,secret,now());}catch{return reply({error:'Invalid signature'},401);}
  let body,envelope;
  try{body=JSON.parse(raw.toString('utf8'));envelope=automationEnvelope(body,request.headers,{organizationId,templateId,bootstrap});}catch{return reply({error:'Unexpected Automation envelope'},400);}
  const record={...envelope,receivedAt:now(),mode:'capture-only',payloadSections:body.payload_sections,shape:payloadShape(body.data)};
  const key='automation-captures/'+createHash('sha256').update(envelope.organizationId+':'+envelope.templateId+':'+envelope.instanceId).digest('hex');
  try{await save(key,record,{onlyIfNew:true});}catch{return reply({error:'Capture unavailable'},503);}
  // No engine import, no enrollment, no request queue, no external API calls.
  return reply({captured:true,mode:'capture-only',enrollment:false,organizationId:record.organizationId,event:record.event,payloadSections:record.payloadSections,shape:record.shape},202);
 };
}
