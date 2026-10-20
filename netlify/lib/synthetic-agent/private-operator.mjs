import {createHash} from 'node:crypto';
import {SCOPE} from './harness.mjs';
// Only called by Netlify Scheduled Functions; no public route or request-selected action.
export async function operate(action,{store,harness,env,transport=fetch,now=Date.now}){
 if(env.REVIEW_ENABLED==='true'||now()>=Date.parse('2026-10-27T00:00:00Z'))throw Error('Scope blocked');
 const key=env.MAILCHIMP_API_KEY,dc=key?.split('-').at(-1);
 if(!/^us\d+$/.test(dc||''))throw Error('Missing provider');
 const member='https://'+dc+'.api.mailchimp.com/3.0/lists/'+SCOPE.audience+'/members/'+createHash('md5').update(SCOPE.email).digest('hex');
 const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function request(url,options={}){const r=await transport(url,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Provider status '+r.status);return r.status===204?null:r.json();}
 const read=()=>request(member,{headers});
 const tags=m=>(m.tags||[]).map(t=>t.name).sort();
 const base=m=>m.email_address?.toLowerCase()===SCOPE.email&&JSON.stringify(tags(m))===JSON.stringify(['realtor'])&&!m.merge_fields.REVLINK&&!m.merge_fields.REVADDR;
 if(action==='begin'){
  if(await store.get('safety/stopped',{type:'json'}))throw Error('Revoked');
  const m=await read();if(m.status!=='unsubscribed'||!base(m))throw Error('Baseline changed');
  const lock=await store.setJSON('safety/operator-begin',{attemptedAt:now()},{onlyIfNew:true});if(!lock.modified)throw Error('Already attempted; reconcile first');
  await request(member,{method:'PATCH',headers,body:JSON.stringify({status:'subscribed'})});
  const result=await harness.begin();return {begun:!!result.token};
 }
 if(action==='notify'){
  const keys=[];for await(const p of store.list({prefix:'requests/',paginate:true}))keys.push(...p.blobs.map(b=>b.key));
  if(keys.length!==1)throw Error('Expected one request');const row=await store.get(keys[0],{type:'json'});
  const suppressed=await harness.checkSuppression(row.token);if(!suppressed.ended)throw Error('Suppression failed');
  const result=await harness.notify(row.token);return {suppressed:true,notified:result.notified};
 }
 if(action==='cleanup'){
  // Revocation remains possible even when the two-hour permit has expired.
  await store.setJSON('safety/stopped',{stoppedAt:now()});
  const m=await read();
  const allowed=['realtor',SCOPE.pending,'feedback received','google reviewed'];
  if(m.email_address?.toLowerCase()!==SCOPE.email||tags(m).some(t=>!allowed.includes(t)))throw Error('Unexpected member tags');
  if(m.merge_fields.REVADDR&&m.merge_fields.REVADDR!==SCOPE.address)throw Error('Unexpected address');
  if(m.merge_fields.REVLINK&&!/^https:\/\/www\.insites\.services\/review-synthetic\/[a-f0-9]{48}$/.test(m.merge_fields.REVLINK))throw Error('Unexpected review link');
  await request(member,{method:'PATCH',headers,body:JSON.stringify({status:'unsubscribed',merge_fields:{REVLINK:'',REVADDR:''}})});
  const removal=tags(m).filter(t=>t!=='realtor').map(name=>({name,status:'inactive'}));
  if(removal.length){const r=await transport(member+'/tags',{method:'POST',headers,body:JSON.stringify({tags:removal}),redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Tag cleanup failed');}
  const hu='https://api.hiveinspect.com/v1/contacts/'+SCOPE.contactId,hh={Authorization:'Bearer '+env.HIVE_API_KEY,'Content-Type':'application/json'};
  const hc=await request(hu,{headers:hh});const ht=(hc.tags||[]).map(t=>t.name);
  if(ht.some(t=>!['realtor','google reviewed'].includes(t))||!ht.includes('realtor'))throw Error('Unexpected Hive baseline');
  if(ht.includes('google reviewed'))await request(hu,{method:'PATCH',headers:hh,body:JSON.stringify({tags:['realtor']})});
  const final=await read();if(final.status!=='unsubscribed'||!base(final))throw Error('Cleanup verification failed');
  return {revoked:true,unsubscribed:true,fieldsRestored:true,tagsRestored:true};
 }
 throw Error('Unsupported action');
}
