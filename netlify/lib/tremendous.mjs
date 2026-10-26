// No defaults for funding/product: account-specific verification is mandatory.
export function tremendous({key,environment='sandbox',productId,fundingSourceId,catalogVerified=false,purchasing=false,fetcher=fetch}){
 const base=environment==='sandbox'?'https://testflight.tremendous.com/api/v2':environment==='production'?'https://api.tremendous.com/api/v2':null;
 const ready=()=>{if(!base||!key||!key.startsWith(environment==='sandbox'?'TEST_':'PROD_'))throw Error('Provider configuration unavailable');};
 async function call(path,body){ready();const response=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok){const error=Error('Provider request requires reconciliation');error.status=response.status;throw error;}return response.json();}
 return {
  async lookup(externalId){try{return (await call('/orders/'+encodeURIComponent(externalId))).order;}catch(e){if(e.status===404)return null;throw e;}},
  async create({externalId,name,email}){if(!purchasing||!catalogVerified||!productId||!fundingSourceId)throw Error('Purchasing disabled');return (await call('/orders',{external_id:externalId,payment:{funding_source_id:fundingSourceId},reward:{value:{denomination:25,currency_code:'USD'},products:[productId],recipient:{name,email},delivery:{method:'LINK'}}})).order;},
  async link(rewardId){const value=(await call('/rewards/'+encodeURIComponent(rewardId)+'/generate_link',{})).reward;if(value?.id!==rewardId)throw Error('Unexpected reward');const url=new URL(value.link);if(url.protocol!=='https:'||!(url.hostname==='tremendous.com'||url.hostname.endsWith('.tremendous.com')))throw Error('Unexpected reward URL');return url.href;}
 };
}
