// Cardly v2.2 official contract: https://api.card.ly/openapi/en-AU/2.2.0/json
// Only this injected adapter knows the provider credential. Never log headers,
// full provider responses, recipients, preview URLs or card wording.
import {fingerprint,reviewFingerprint,qualification} from './cards-core.mjs';
import {CARDLY_ASSETS} from './cardly-zap-mapping.mjs';
const BASE='https://api.card.ly/v2';
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const positive=v=>Number.isFinite(v)&&v>0;
export class CardlyError extends Error {
 constructor(code,{outcome='unknown',status=null}={}){super(code);this.code=code;this.outcome=outcome;this.status=status;}
}
export function buildOrderBody(job){
 if(job?.status!=='APPROVED'||!job.approvedText||!job.approval||job.historyReconciled!==true)throw Error('owner_approval_required');
 if(qualification(job.snapshot,job.snapshot.organizationId))throw Error('qualification_required');
 if(job.approval.fingerprint!==reviewFingerprint(job,job.approvedText,job.approval.artwork))throw Error('approval_changed');
 const a=job.approval.artwork;
 if(a.id!==CARDLY_ASSETS.artworkId||a.templateId!==CARDLY_ASSETS.templateId||a.messagePage!==3||a.revision!=='1')throw Error('artwork_changed');
 if(!/^[a-f0-9]{64}$/.test(job.idempotencyKey)||job.externalOrderNumber!=='insites-'+job.idempotencyKey)throw Error('order_identity_required');
 const r=job.snapshot.recipient;
 // Explicit allowlist excludes personal/internal metadata and unrelated options.
 const recipient=Object.fromEntries(['firstName','lastName','company','address','address2','city','region','postcode','country'].filter(k=>r[k]!=null&&r[k]!=='').map(k=>[k,String(r[k])]));
 if(recipient.country!=='US')throw Error('shipping_region_requires_review');
 return {purchaseOrderNumber:job.externalOrderNumber,lines:[{artwork:a.id,template:a.templateId,quantity:1,messages:{pages:[{page:3,text:job.approvedText}]},recipient,shippingMethod:'standard',shipToMe:false}]};
}
export function createCardlyClient({apiKey,mode='test',fetchImpl=fetch,timeoutMs=7000}={}){
 if(!['test','live'].includes(mode)||typeof apiKey!=='string'||!apiKey.startsWith(mode+'_')||apiKey.length<20||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw new CardlyError('cardly_configuration_required',{outcome:'not_attempted'});
 async function request(path,{method='GET',body,idempotencyKey}={}){
  if(!path.startsWith('/')||path.includes('://'))throw Error('invalid_provider_path');
  if(method==='POST'&&(!/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey||'')))throw Error('idempotency_key_required');
  let response,parsed;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   response=await fetchImpl(BASE+path,{method,headers:{'API-Key':apiKey,Accept:'application/json',...(body?{'Content-Type':'text/json','Idempotency-Key':idempotencyKey}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:controller.signal});
   const text=await response.text();if(text.length>2_000_000)throw new CardlyError('provider_response_too_large');
   try{parsed=JSON.parse(text);}catch{throw new CardlyError('provider_response_invalid');}
  }catch(error){if(error instanceof CardlyError)throw error;throw new CardlyError('provider_transport_unknown');}
  finally{clearTimeout(timer);}
  if(!response.ok){
   // Documented validation/auth/credit failures do not create an order. Conflict,
   // throttle and server failures remain unknown, and never trigger a blind retry.
   const rejected=[400,401,402,403,404,422].includes(response.status);
   throw new CardlyError(response.status===402?'provider_credit_required':'provider_request_failed',{status:response.status,outcome:rejected?'not_applied':'unknown'});
  }
  if(!parsed||parsed.state?.status!=='OK'||!parsed.data)throw new CardlyError('provider_response_unverified');
  if(mode==='live'&&(parsed.testMode===true||parsed.data.testMode===true||parsed.data.order?.testMode===true))throw new CardlyError('provider_test_response');
  return {data:parsed.data,requestId:response.headers.get('request-id')||null,testMode:mode==='test'};
 }
 // The published v2 contract does not expose a maximum credit debit or a bound
 // preview quote. Do not represent receipt validation after charging as a spend
 // guard. Actual API ordering stays blocked until a provider guarantee is proven.
 return Object.freeze({mode,orderPriceBindingVerified:false,
  balance:()=>request('/account/balance'),
  preview:(line,reference)=>request('/orders/preview',{method:'POST',body:{...line,purchaseOrderNumber:reference},idempotencyKey:fingerprint(['preview',line,reference])}),
  place:({body,idempotencyKey})=>request('/orders/place',{method:'POST',body,idempotencyKey}),
  getOrder:id=>{if(!idPattern.test(id))throw Error('invalid_order_id');return request('/orders/'+encodeURIComponent(id));},
  async listOrders({maxPages=100,limit=100}={}){
   if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid_page_limit');
   const orders=[],seen=new Set();let expected=null;
   for(let page=0;page<maxPages;page++){
    const offset=orders.length,result=await request('/orders?limit='+limit+'&offset='+offset),m=result.data.meta,rows=result.data.results;
    if(!Array.isArray(rows)||!m||!Number.isSafeInteger(m.totalRecords)||m.totalRecords<0||m.offset!==offset||rows.length>limit||new Set(rows.map(r=>r?.id)).size!==rows.length||rows.some(r=>typeof r?.id!=='string'||!idPattern.test(r.id)||seen.has(r.id)||(mode==='live'&&r.testMode===true)))throw new CardlyError('provider_history_incomplete');
    if(expected!==null&&expected!==m.totalRecords)throw new CardlyError('provider_history_changed');expected=m.totalRecords;
    for(const row of rows){seen.add(row.id);orders.push(row);}
    if(orders.length===expected)return {complete:true,orders,evidence:fingerprint(orders),testMode:mode==='test'};
    if(!rows.length||orders.length>expected)throw new CardlyError('provider_history_incomplete');
   }throw new CardlyError('provider_history_page_limit');
  }
 });
}
const milliseconds=v=>typeof v==='string'&&/Z$|[+-]\d\d:\d\d$/.test(v)?Date.parse(v):NaN;
const address=r=>({name:[r.firstName,r.lastName].filter(Boolean).join(' '),...Object.fromEntries(['company','address','address2','city','region','postcode','country'].map(k=>[k,String(r[k]||'')]))});
export function verifyCardlyOrder({job,attempt,order,requestId=null,now=Date.now()}){
 // Cardly's order object does NOT return message text. Text provenance is the
 // immutable request journal, tied to the successful order response/lookup.
 // Never describe this as provider-returned wording or invent receipt fields.
 if(!positive(attempt?.submittedAt)||attempt.submittedAt>now||!positive(attempt?.maxCredits)||attempt.maxCredits>1||!attempt.requestBody||attempt.bodyHash!==fingerprint(attempt.requestBody)||attempt.approvalFingerprint!==job.approval?.fingerprint||attempt.idempotencyKey!==job.idempotencyKey||attempt.externalOrderNumber!==job.externalOrderNumber||job.approval?.fingerprint!==reviewFingerprint(job,job.approvedText,job.approval.artwork))throw Error('order_attempt_unverified');
 // Historical lookup verifies the frozen attempt even if today's source/history
 // readiness has since expired. That expiry blocks a new order, not its receipt.
 const expected=buildOrderBody({...job,status:'APPROVED',historyReconciled:true});
 if(fingerprint(expected)!==attempt.bodyHash||attempt.testMode!==false||order?.testMode===true||!order?.id||!idPattern.test(order.id)||order.customer?.purchaseOrderNo!==job.externalOrderNumber||order.status!=='paid'||!Array.isArray(order.items)||order.items.length!==1)throw Error('provider_order_mismatch');
 const item=order.items[0],line=expected.lines[0];
 if(typeof item.id!=='string'||!idPattern.test(item.id)||item.type!=='card'||item.quantity!==1||item.artwork!==line.artwork||item.template!==line.template||item.shipTo!=='D'||item.shipMethod!=='standard'||(item.related!=null&&(!Array.isArray(item.related)||item.related.length>0))||!item.recipient||fingerprint(Object.fromEntries(Object.keys(address(line.recipient)).map(k=>[k,String(item.recipient[k]||'')])))!==fingerprint(address(line.recipient)))throw Error('provider_item_mismatch');
 const orderedAt=milliseconds(order.timings?.paid),sentAt=milliseconds(item.timings?.shipped);
 if(!positive(orderedAt)||orderedAt>now||orderedAt<attempt.submittedAt-300000||item.timings?.held)throw Error('provider_timing_unverified');
 if(item.timings?.shipped&&(!positive(sentAt)||sentAt<orderedAt||sentAt>now))throw Error('provider_timing_unverified');
 const costs=order.costs;if(!positive(costs?.credits)||costs.credits>attempt.maxCredits||Number(costs.giftCredit||0)!==0||['gross','discount','tax','shipping','shippingTax','total','currency'].some(k=>costs[k]!=null))throw Error('provider_cost_mismatch');
 const status=positive(sentAt)?'SENT':'ORDERED';
 const proof={orderId:order.id,itemId:item.id,requestId,bodyHash:attempt.bodyHash,approvalFingerprint:attempt.approvalFingerprint,externalOrderNumber:job.externalOrderNumber,orderedAt,sentAt:positive(sentAt)?sentAt:null,credits:costs.credits};
 return {verified:true,evidence:'cardly-request-receipt:'+fingerprint(proof),orderId:order.id,externalOrderNumber:job.externalOrderNumber,idempotencyKey:job.idempotencyKey,exactText:job.approvedText,textProvenance:'immutable_submitted_request',recipientFingerprint:fingerprint(job.snapshot.recipient),approvalFingerprint:job.approval.fingerprint,status,orderedAt,...(status==='SENT'?{sentAt}:{}),credits:costs.credits,proof};
}
