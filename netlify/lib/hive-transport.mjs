import {randomUUID} from 'node:crypto';
// All consumers MUST use the same strong-consistency company-scoped store.
// This module is not wired into production until the cache migration is verified.
export const HIVE_TRANSPORT_KEY='hive-source/transport-v1';
export class HiveTransportDeferred extends Error {
 constructor(reason,status=503){super('Hive request deferred: '+reason);this.name='HiveTransportDeferred';this.code='HIVE_TRANSPORT_DEFERRED';this.reason=reason;this.status=status;}
}
const fail=(reason,status)=>{throw new HiveTransportDeferred(reason,status);};
const DAY=86400000;
const dayOf=t=>new Date(t).toISOString().slice(0,10);
const countHeader=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
const quotaNames=['Limit','Used','Remaining','Next-Reset-Date','Warning'];
function quota(headers){const out={};for(const suffix of quotaNames){const value=headers.get('Hive-Quota-'+suffix);if(value!==null)out[suffix]=value.slice(0,256);}return out;}
function delay(headers,now,failures){
 const value=headers.get('Retry-After'),seconds=value&&/^\d+$/.test(value)?Number(value):NaN;
 const date=value?Date.parse(value):NaN;
 const server=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:0;
 return Math.max(Math.min(3600000,60000*2**Math.min(failures-1,6)),Number.isSafeInteger(server)&&server>0?server:0);
}
function validate(s){
 if(!s||s.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||![s.attempts,s.successes,s.failures,s.notBefore].every(n=>Number.isSafeInteger(n)&&n>=0)||s.successes>s.attempts||s.blocked!==null&&typeof s.blocked!=='string'||s.inFlight!==null&&(typeof s.inFlight?.id!=='string'||!s.inFlight.id||!Number.isSafeInteger(s.inFlight.until)||s.inFlight.until<0))fail('invalid-checkpoint');
 if(!s.reservedByDay||Array.isArray(s.reservedByDay)||typeof s.reservedByDay!=='object'||Object.entries(s.reservedByDay).some(([day,n])=>!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isSafeInteger(n)||n<0)||!Number.isSafeInteger(s.lastReservationAt)||s.lastReservationAt<0)fail('invalid-checkpoint');
 return s;
}
export function createHiveTransport({store,fetcher=fetch,now=()=>Date.now(),paused=true,apiKey,dailyBudget=100,rollingBudget=3000,providerReserve=1000,timeoutMs=10000,readOnly=false,requireQuota=false,verifiedProviderLimit=10000}={}){
 if(![10000,25000].includes(verifiedProviderLimit)||!Number.isSafeInteger(rollingBudget)||rollingBudget<1||rollingBudget>3000||!Number.isSafeInteger(providerReserve)||providerReserve<100||providerReserve>10000||!Number.isSafeInteger(dailyBudget)||dailyBudget<1||dailyBudget>200||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>12000)throw Error('Unsafe Hive transport budget');
 const fresh=t=>({version:1,day:new Date(t).toISOString().slice(0,10),attempts:0,successes:0,failures:0,notBefore:0,blocked:null,inFlight:null,quota:{},reservedByDay:{},lastReservationAt:0});
 async function mutate(fn){
  for(let attempt=0;attempt<5;attempt++){
   const prior=await store.getWithMetadata(HIVE_TRANSPORT_KEY,{type:'json'});
   if(prior&&!prior.etag)fail('missing-etag');
   const state=prior?validate(structuredClone(prior.data)):fresh(now());
   const next=fn(state);
   const written=await store.setJSON(HIVE_TRANSPORT_KEY,next,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
   if(written?.modified===true)return next;
  }
  fail('checkpoint-contention');
 }
 async function request(path,{method='GET',body}={}){
  if(paused!==false)fail('incident-paused');
  if(readOnly&&method!=='GET')fail('seed-read-only');
  if(typeof apiKey!=='string'||!apiKey.trim())fail('credentials-missing');
  if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('://')||path.includes('#')||!['GET','PATCH'].includes(method)||method==='GET'&&body!==undefined)throw Error('Invalid Hive request');
  const url=new URL(path,'https://api.hiveinspect.com/v1/');
  if(url.origin!=='https://api.hiveinspect.com'||!url.pathname.startsWith('/v1/'))throw Error('Invalid Hive path');
  const id=randomUUID(),started=now();
  await mutate(s=>{
   if(s.blocked)fail(s.blocked);
   // Never silently reclaim a crashed/uncertain network attempt. Reconciliation
   // is a separate reviewed operation; no timer can restore a monthly circuit.
   if(s.inFlight)fail(s.inFlight.until>started?'request-busy':'uncertain-prior-request');
   if(s.notBefore>started)fail('backoff');
   if(started<s.lastReservationAt)fail('clock-regressed');
   const day=dayOf(started);
   // Include the ENTIRE boundary date: conservative rolling31days, never a
   // calendar-month reset. This can retain up to32 calendar-date buckets.
   const oldest=dayOf(started-31*DAY);
   s.reservedByDay=Object.fromEntries(Object.entries(s.reservedByDay).filter(([date])=>date>=oldest));
   if(Object.values(s.reservedByDay).reduce((sum,n)=>sum+n,0)>=rollingBudget)fail('rolling-budget');
   if(s.day!==day){s.day=day;s.attempts=0;s.successes=0;}
   if(s.attempts>=dailyBudget)fail('daily-budget');
   s.attempts++;s.reservedByDay[day]=(s.reservedByDay[day]||0)+1;s.lastReservationAt=started;s.inFlight={id,until:started+timeoutMs+5000};return s;
  });
  let response,error;
  try{response=await fetcher(url.href,{method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch(e){error=e;}
  // A failed checkpoint after network I/O leaves inFlight intact, intentionally
  // stopping further requests rather than guessing that an unrecorded send failed.
  const final=await mutate(s=>{
   if(s.inFlight?.id!==id)fail('reservation-lost');
   s.inFlight=null;
   if(error){if(method!=='GET')s.blocked='uncertain-write';s.failures++;s.notBefore=now()+Math.min(3600000,60000*2**Math.min(s.failures-1,6));return s;}
   const q=quota(response.headers),hasQuota=Object.keys(q).length>0;
   if(hasQuota)s.quota=q;
   if(response.status>=200&&response.status<400)s.successes++;
   if(response.status===429&&hasQuota)s.blocked='monthly-quota';
   else if(response.status===401||response.status===403)s.blocked='credentials-or-access';
   else if(response.status===429||response.status>=500){if(method!=='GET'&&response.status>=500)s.blocked='uncertain-write';s.failures++;s.notBefore=now()+delay(response.headers,now(),s.failures);}
   else {s.failures=0;s.notBefore=0;}
   // Seed recovery requires coherent provider counters, never the grace band.
   const limit=countHeader(q.Limit),used=countHeader(q.Used),remaining=countHeader(q.Remaining);
   const validQuota=limit!==null&&limit>0&&used!==null&&remaining!==null&&used+remaining===limit;
   if(!s.blocked&&requireQuota&&response.ok&&!validQuota)s.blocked='quota-headers-unverified';
   const effectiveLimit=limit!==null&&limit>0?Math.min(limit,verifiedProviderLimit):10000;
   if(!s.blocked&&(countHeader(q.Used)!==null&&countHeader(q.Used)>=effectiveLimit-providerReserve||countHeader(q.Remaining)!==null&&countHeader(q.Remaining)<=providerReserve))s.blocked='provider-quota-reserve';
   if(!s.blocked&&(q.Warning!==undefined||q.Remaining!==undefined&&/^\d+$/.test(q.Remaining)&&Number(q.Remaining)===0))s.blocked='included-quota-exhausted';
   return s;
  });
  if(error)fail('network-uncertain');
  if(requireQuota&&final.blocked)fail(final.blocked,response.status);
  if(response.status<200||response.status>=300)fail(final.blocked||'http-'+response.status,response.status);
  return response;
 }
 return {request};
}
