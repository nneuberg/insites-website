import {createHash} from 'node:crypto';
export const CLIENT_SCOPE=Object.freeze({
 email:'nneuberger92+insites-client-test@gmail.com',audience:'8f8749ba24',
 hiveId:'99f05197-8d2b-4868-8077-9a0c6208bed9',
 store:'insites-synthetic-client-e2e-20261022-r2',pending:'TEST:REVIEW:CLIENT:20261022',
 address:'123 Test Street (test only)'
});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const block=()=>{throw Error('Client test scope blocked');};
// This adapter has no default network transport. Deployment requires a fresh,
// audited contact/journey baseline and an explicitly supplied short permit.
export function clientProviderGuard({store,transport,dc,permit,now=Date.now}){
 if(!/^us\d+$/.test(dc)||typeof transport!=='function'||!store)block();
 const member='/3.0/lists/'+CLIENT_SCOPE.audience+'/members/'+createHash('md5').update(CLIENT_SCOPE.email).digest('hex');
 return async(raw,opt={})=>{
  if(permit?.enabled!==true||permit?.baselineVerified!==true||permit?.journeyRestricted!==true||permit?.subscriptionAuditPassed!==true||
   !Number.isFinite(permit.startsAt)||!Number.isFinite(permit.expiresAt)||
   permit.expiresAt<=permit.startsAt||permit.expiresAt-permit.startsAt>7200000||
   now()<permit.startsAt||now()>=permit.expiresAt||await store.get('safety/stopped',{type:'json'}))block();
  const u=new URL(raw),method=opt.method||'GET';
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port)block();
  let body=opt.body?JSON.parse(opt.body):null;
  if(u.hostname===dc+'.api.mailchimp.com'&&u.pathname===member){
   if(method==='GET')return transport(raw,{...opt,redirect:'error'});
   if(method!=='PATCH'||!same(Object.keys(body||{}),['merge_fields']))block();
   const fields=body.merge_fields;
   if(same(Object.keys(fields),['REVREF2','REVREF6'])){
    if(!Object.values(fields).every(v=>typeof v==='string'&&/^\d{2}\/\d{2}\/\d{4}$/.test(v)))block();
    await store.setJSON('evidence/referral-dates',{fields,at:now()});
    return Response.json({captured:true}); // Never forward referral triggers.
   }
   if(!same(Object.keys(fields),['REVLINK','REVADDR'])||fields.REVADDR!==CLIENT_SCOPE.address||
    !/^https:\/\/www\.insites\.services\/review-client-test\/[a-f0-9]{48}$/.test(fields.REVLINK))block();
  }else if(u.hostname===dc+'.api.mailchimp.com'&&u.pathname===member+'/tags'){
   if(method!=='POST'||!same(Object.keys(body||{}),['tags'])||!Array.isArray(body.tags)||body.tags.length<1||body.tags.length>3)block();
   for(const t of body.tags)if(!same(Object.keys(t),['name','status'])||!['REVIEW:PENDING','feedback received','google reviewed'].includes(t.name)||!['active','inactive'].includes(t.status))block();
   const activation=body.tags.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active');
   body={tags:body.tags.map(t=>({...t,name:t.name==='REVIEW:PENDING'?CLIENT_SCOPE.pending:t.name}))};
   if(activation){
    const held=await store.setJSON('safety/invitation',{attemptedAt:now()},{onlyIfNew:true});
    if(!held.modified)throw Error('Invitation already attempted; reconcile before continuing');
   }
  }else if(u.hostname==='api.hiveinspect.com'&&u.pathname==='/v1/contacts/'+CLIENT_SCOPE.hiveId){
   if(method==='GET')return transport(raw,{...opt,redirect:'error'});
   if(method!=='PATCH'||!same(body,{tags:['client','google reviewed']}))block();
  }else block(); // Blocks scans, subscription changes, other contacts, Google and Resend.
  return transport(raw,{...opt,body:JSON.stringify(body),redirect:'error'});
 };
}
