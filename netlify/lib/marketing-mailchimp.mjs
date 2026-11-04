import {createHash} from 'node:crypto';
const email=x=>String(x||'').trim().toLowerCase();
export function createMarketingMailchimp({env=process.env,fetcher=fetch,now=()=>Date.now(),deadline=Infinity,positiveRatingInterest=null}={}){
 const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);if(!/^us\d+$/.test(dc||''))throw Error('Mailchimp unavailable');
 const base=`https://${dc}.api.mailchimp.com/3.0`,headers={Authorization:'Basic '+Buffer.from('insites:'+env.MAILCHIMP_API_KEY).toString('base64'),'Content-Type':'application/json'};
 const hash=x=>createHash('md5').update(email(x)).digest('hex');
 async function api(path,method='GET',body){const remaining=Math.min(12000,deadline-now());if(remaining<1000)throw Error('Provider deadline');const r=await fetcher(base+path,{method,headers,signal:AbortSignal.timeout(remaining),...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Object.assign(Error('Mailchimp request failed'),{status:r.status});if(r.status===204)return null;return r.json();}
 const path=(aud,address)=>`/lists/${encodeURIComponent(aud)}/members/${hash(address)}`;
 async function member(aud,address){let m;try{m=await api(path(aud,address));}catch(e){if(e.status===404)return null;throw e;}if(m.id!==hash(address)||m.list_id!==aud||email(m.email_address)!==email(address))throw Error('Mailchimp identity mismatch');return m;}
 async function activity(aud,address){const items=[];let complete=false;for(let page=0;page<2;page++){const r=await api(path(aud,address)+`/activity-feed?count=100&offset=${page*100}`);if(r.email_id!==hash(address)||r.list_id!==aud||!Array.isArray(r.activity))throw Error('Activity identity/schema mismatch');items.push(...r.activity);if(r.activity.length<100){complete=true;break;}}if(!complete)throw Error('Bounded activity history incomplete');if(items.some(x=>!Number.isFinite(Date.parse(x.created_at_timestamp))||Date.parse(x.created_at_timestamp)>now()||x.activity_type==='sent'&&!x.campaign_id))throw Error('Uncertain activity timestamp/campaign');return items.map(x=>({type:x.activity_type,at:Date.parse(x.created_at_timestamp),campaignId:x.campaign_id||null,threadId:x.activity_type==='inbox_thread'?x.id:null,direction:x.thread_direction||null}));}
 async function trigger(executor,address){if(executor.verified!==true||executor.reentry!==false||![0,1].includes(executor.emailCount)||executor.noAutonomousTails!==true)throw Error('Unverified bounded executor');return api(`/customer-journeys/journeys/${encodeURIComponent(executor.journeyId)}/steps/${encodeURIComponent(executor.triggerStepId)}/actions/trigger`,'POST',{email_address:email(address)});}
 async function reviewFields(aud,address,fields){if(Object.keys(fields).some(k=>!['REVLINK','REVADDR'].includes(k)))throw Error('No stage triggers through shared owner');let r;try{r=await api(path(aud,address),'PATCH',{merge_fields:fields});}catch(e){if(e.status)throw e;r=null;}const matches=x=>x?.merge_fields&&Object.entries(fields).every(([k,v])=>Object.hasOwn(x.merge_fields,k)&&x.merge_fields[k]===v);if(!matches(r))r=await member(aud,address);if(!matches(r))throw Error('Review fields unverified; persistent hold required');return true;}
 async function ratingMember(binding,interestId){
  if(binding?.audienceId!=='8f8749ba24'||typeof binding.email!=='string'||binding.email!==email(binding.email)||!/^\S+@\S+\.\S+$/.test(binding.email)||typeof positiveRatingInterest!=='string'||!positiveRatingInterest||interestId!==positiveRatingInterest)throw Error('Unconfigured positive rating binding');
  const m=await member(binding.audienceId,binding.email);if(!m||typeof m.interests?.[interestId]!=='boolean')throw Error('Existing exact marker member required');return m;
 }
 async function setMarker(binding,interestId,value){
  if(typeof value!=='boolean')throw Error('Boolean marker required');
  const m=await ratingMember(binding,interestId);if(value&&m.status!=='subscribed')throw Error('Cannot grant to non-subscriber');
  // PATCH only the configured marker on an existing, identity-checked member.
  // No PUT/upsert, merge fields, subscription changes, or journey triggers.
  await api(path(binding.audienceId,binding.email),'PATCH',{interests:{[interestId]:value}});
 }
 async function readMarker(binding,interestId){const m=await ratingMember(binding,interestId);return {binding:{...binding},interestId,value:m.interests[interestId]};}
 return{member,activity,trigger,reviewFields,setMarker,readMarker,now};
}
