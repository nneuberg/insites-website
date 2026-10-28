import {ownerHarness,TARGET} from './mailchimp-owner-9531.mjs';
export const RUN='mailchimp-owner-9531-20261028';
// Optional private readiness read, never an order or funding mutation.
export async function readProductionWallet({key,fetcher=fetch}){
 if(typeof key!=='string'||!key.startsWith('PROD_'))return {verified:false,reason:'configuration-unavailable'};
 try{const r=await fetcher('https://api.tremendous.com/api/v2/funding_sources/BALANCE',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(3000)});if(!r.ok)return {verified:false,httpStatus:r.status};const s=(await r.json()).funding_source;if(s?.method!=='balance'||s.status!=='active'||!s.usage_permissions?.includes('api_orders')||s.meta?.currency_code!=='USD'||!Number.isSafeInteger(s.meta.available_cents)||s.meta.available_cents<0)return {verified:false,reason:'unexpected-funding-source'};return {verified:true,availableCents:s.meta.available_cents,currency:'USD',automaticFundingConfiguredByThisTest:false};}catch{return {verified:false,reason:'read-unavailable'};}
}
// Entire batch is single use. Retry/timeout cannot advance to a previously unsent slot.
export async function runOwnerPair({store,transport,configuration,now=()=>Date.now()}){
 const summarize=d=>({flow:TARGET.flow,attempts:Object.values(d?.attempts||{}).map(a=>({invitationId:a.invitationId,state:a.state,httpStatus:a.httpStatus??null})),thirdHeld:true});
 const api=ownerHarness({store,transport,now});
 const previous=await api.inspect();
 if(previous)return {state:'existing-checkpoint-no-send',...summarize(previous)};
 const reserved=await store.setJSON('single-batch',{startedAt:now()},{onlyIfNew:true});
 if(!reserved.modified)return {state:'existing-batch-no-send',...summarize(await api.inspect())};
 try{
  await api.initialize(configuration);
  const first=await api.attempt(1);
  if(first.state!=='accepted')return {state:'held',...summarize(await api.inspect())};
  await api.attempt(2);
  return {state:'observations-required',...summarize(await api.inspect())};
 }catch{return {state:'held-no-retry',...summarize(await api.inspect())};}
}
// Separate third-only entry. It never initializes or reopens the original pair.
export async function runOwnerThird({store,transport,evidence,now=()=>Date.now()}){
 const api=ownerHarness({store,transport,now});
 const prior=await api.inspect();
 if(!prior)return {state:'missing-checkpoint-no-send'};
 if(prior.attempts?.[3])return {state:'existing-third-no-send',attempt:prior.attempts[3]};
 try{
  if(!prior.thirdWindow)await api.permitObservedThird(evidence);
  const attempt=await api.attempt(3);
  return {state:attempt.state==='accepted'?'third-observations-required':'third-held',attempt,earlierDeliveryUnproven:true};
 }catch{return {state:'third-held-no-send-or-retry'};}
}
