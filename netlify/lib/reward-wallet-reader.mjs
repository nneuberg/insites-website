// Read-only production prepaid balance. No orders or funding mutations.
export async function readProductionWallet({key,fetcher=fetch}){
 if(typeof key!=='string'||!key.startsWith('PROD_'))return {verified:false,reason:'configuration-unavailable'};
 try{const r=await fetcher('https://api.tremendous.com/api/v2/funding_sources/BALANCE',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(3000)});if(!r.ok)return {verified:false,httpStatus:r.status};const s=(await r.json()).funding_source;if(s?.method!=='balance'||s.status!=='active'||!s.usage_permissions?.includes('api_orders')||s.meta?.currency_code!=='USD'||!Number.isSafeInteger(s.meta.available_cents)||s.meta.available_cents<0)return {verified:false,reason:'unexpected-funding-source'};return {verified:true,availableCents:s.meta.available_cents,currency:'USD',automaticFundingConfiguredByThisTest:false};}catch{return {verified:false,reason:'read-unavailable'};}
}
