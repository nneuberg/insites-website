import {createHash} from 'node:crypto';
import {ledger} from './referral-transport.mjs';
export const REFERRAL_TAG='REF:CODE-OWNER';
const normalize=value=>String(value||'').trim().toLowerCase();
export function referralDates(assignedAt){
 const date=new Date(assignedAt);if(!Number.isFinite(date.getTime()))throw Error('Invalid assignment date');
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const n=type=>Number(parts.find(p=>p.type===type).value),year=n('year'),month=n('month')-1,day=n('day');
 const two=new Date(Date.UTC(year,month,day+2)),six=new Date(Date.UTC(year,month+6,1));
 six.setUTCDate(Math.min(day,new Date(Date.UTC(six.getUTCFullYear(),six.getUTCMonth()+1,0)).getUTCDate()));
 const fmt=d=>`${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;
 return {REF2DAY:fmt(two),REFSIX:fmt(six)};
}
export function referralOwners(snapshot){
 const rows=snapshot.codes||[],suppressed=new Set(rows.filter(c=>c['Email Unsubscribed At']).map(c=>normalize(c['Referrer Email']))),seen=new Set();
 return rows.filter(c=>c['Assignment State']==='ASSIGNED'&&Number.isFinite(Date.parse(c['Assigned At'])))
 .sort((a,b)=>Date.parse(a['Assigned At'])-Date.parse(b['Assigned At']))
 .filter(c=>{const email=normalize(c['Referrer Email']);if(seen.has(email))return false;seen.add(email);return !suppressed.has(email)&&c['Hive State']==='VERIFIED'&&/^INS25[A-Z2-9]{7}$/.test(c.Code)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);});
}
export function mailchimpClient(env=process.env,fetcher=fetch){
 const key=env.MAILCHIMP_API_KEY,dc=key?.split('-').at(-1),list=env.MAILCHIMP_REFERRAL_AUDIENCE_ID;
 if(!key||!/^us[0-9]+$/.test(dc)||!/^[-a-zA-Z0-9]+$/.test(list||''))throw Error('Mailchimp connection incomplete');
 return async(method,path,body)=>{
  const response=await fetcher(`https://${dc}.api.mailchimp.com/3.0/lists/${list}${path}`,{method,headers:{Authorization:`Basic ${Buffer.from('insites:'+key).toString('base64')}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
  if(method==='GET'&&response.status===404)return null;
  if(!response.ok)throw Error(`Mailchimp request failed (${response.status})`);
  return response.status===204?{}:response.json();
 };
}
export async function syncOwner(owner,{request,now=new Date(),member}={}){
 const email=normalize(owner['Referrer Email']),path='/members/'+createHash('md5').update(email).digest('hex');
 const existing=member===undefined?await request('GET',path):member;
 // Never resubscribe an opted-out, cleaned, pending or archived contact.
 if(existing&&existing.status!=='subscribed')return {status:'suppressed'};
 const fields=existing?.merge_fields||{};
 // Existing referral fields are immutable: a repeat request cannot restart either flow.
 if(fields.REFCODE&&fields.REFCODE!==owner.Code)return {status:'review'};
 const dates=referralDates(owner['Assigned At']);
 const merged={REFCODE:owner.Code,REFNAME:String(owner['Referrer Name']||'').trim().split(/\s+/)[0]||'there'};
 for(const field of ['REF2DAY','REFSIX']){
  // Do not backfill a past due date or a stage previously handled by the old sender.
  const stage=field==='REF2DAY'?'2-Day':'6-Month';
  const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const [month,day,year]=dates[field].split('/');
  if(!fields[field]&&!owner[stage+' Email State']&&`${year}-${month}-${day}`>=localToday)merged[field]=dates[field];
 }
 const changed=Object.entries(merged).some(([key,value])=>fields[key]!==value);
 if(!existing||changed){
  // status_if_new only applies to new contacts; omitting status preserves any concurrent opt-out.
  const result=await request('PUT',path,{email_address:email,status_if_new:'subscribed',merge_fields:merged});
  if(result.status&&result.status!=='subscribed')return {status:'suppressed'};
 }
 if(!existing?.tags?.some(t=>t.name===REFERRAL_TAG))await request('POST',path+'/tags',{tags:[{name:REFERRAL_TAG,status:'active'}]});
 return {status:changed?'synced':'unchanged'};
}
export async function syncReferrals({env=process.env,callLedger=()=>ledger('codeSnapshot',{},env,7000),request,now=new Date()}={}){
 if(env.REFERRAL_MAILCHIMP_ENABLED!=='true'||(!request&&!env.MAILCHIMP_API_KEY))return {enabled:false};
 const api=request||mailchimpClient(env),owners=referralOwners(await callLedger());
 const result={enabled:true,synced:0,unchanged:0,suppressed:0,review:0,capacity:0,failed:0};
 if(!owners.length)return result;
 // Read current subscription states in pages; avoid hundreds of per-contact GETs.
 const members=new Map();let total=0,offset=0;
 do {
  const page=await api('GET',`/members?count=1000&offset=${offset}&fields=total_items,members.email_address,members.status,members.merge_fields,members.tags`);
  if(!page||!Array.isArray(page.members))throw Error('Mailchimp member list unavailable');
  page.members.forEach(m=>members.set(normalize(m.email_address),m));total=page.total_items;offset+=page.members.length;
  if(!page.members.length&&offset<total)throw Error('Incomplete Mailchimp member list');
 }while(offset<total);
 let writes=0,contactCount=total;const limit=Number(env.MAILCHIMP_CONTACT_LIMIT||1500);
 for(const owner of owners){
  if(writes>=3)break;
  const member=members.get(normalize(owner['Referrer Email']))||null;
  if(!member&&contactCount>=limit){result.capacity++;continue;}
  try {const status=(await syncOwner(owner,{request:api,now,member})).status;result[status]++;if(status==='synced'){writes++;if(!member)contactCount++;}}
  catch{result.failed++;writes++;}
 }
 if(result.capacity)throw Error('Mailchimp contact capacity reached; new referral contacts are held');
 if(result.failed)throw Error(`Mailchimp referral sync: ${result.failed} contact(s) need retry`);
 return result;
}
