import {hash,normalize} from './cards-core.mjs';
// Provider credentials stay in existing runtime; this adapter is GET-only.
export function createHiveReader({env=process.env,fetcher=fetch}={}){
 return async(resource,id)=>{
  if(!['contacts','agencies'].includes(resource)||typeof id!=='string'||!id||id.length>128)throw Error('invalid_resource');
  if(!env.HIVE_API_KEY)throw Error('hive_access_unavailable');
  const response=await fetcher('https://api.hiveinspect.com/v1/'+resource+'/'+encodeURIComponent(id),{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+env.HIVE_API_KEY},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('hive_read_failed');return response.json();
 };
}
// Exact address/name paths need approved real response verification; no guessing.
const at=(obj,path)=>path==='$'?obj:typeof path==='string'&&/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(path)?path.split('.').reduce((v,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,obj):undefined;
export async function resolveOffice({read,agentId,mapping}){
 if(!mapping?.verified||!mapping?.evidence)throw Error('mapping_unverified');
 const contactResponse=await read('contacts',agentId),contact=at(contactResponse,mapping.contactRoot);
 if(contact?.id!==agentId||contact.uses_agency_address!==true||typeof contact.agency_id!=='string'||!contact.agency_id)throw Error('agency_link_unverified');
 const agencyResponse=await read('agencies',contact.agency_id),agency=at(agencyResponse,mapping.agencyRoot);
 if(agency?.id!==contact.agency_id)throw Error('agency_mismatch');
 const recipient={};for(const [key,path] of Object.entries(mapping.recipient||{}))recipient[key]=at(key==='firstName'||key==='lastName'?contact:agency,path);
 for(const key of ['firstName','address','city','region','postcode','country'])if(typeof recipient[key]!=='string'||!recipient[key].trim())throw Error('recipient_incomplete');
 return {agentId,agencyId:agency.id,usesAgencyAddress:true,contactMatchCount:1,agencyMatchCount:1,recipient};
}
// Pure Cardly contract builder. No fetch, key, live order action or test call.
// Reference: https://api.card.ly/v2/docs#endpoint-post-order-place
export function cardlyRequest(job){
 const a=job.approval?.artwork;
 if(job.status!=='APPROVED'||!job.approvedText||!a?.id||!a?.templateId||!Number.isInteger(a.messagePage)||a.messagePage<1)throw Error('cardly_mapping_unapproved');
 if(!/^[a-f0-9]{64}$/.test(job.idempotencyKey))throw Error('invalid_idempotency');
 return {url:'https://api.card.ly/v2/orders/place',method:'POST',headers:{'Content-Type':'text/json','Idempotency-Key':job.idempotencyKey},body:{purchaseOrderNumber:job.externalOrderNumber,lines:[{artwork:a.id,template:a.templateId,quantity:1,messages:{pages:[{page:a.messagePage,text:job.approvedText,style:{}}]},recipient:structuredClone(job.snapshot.recipient),shippingMethod:'standard',shipToMe:false}]},blocked:true};
}
// A preview/order success never establishes delivery. Provider test responses
// are ignored for delivery, regardless of example timestamps in their objects.
export function cardlyEvidence(response,expectedOrderId,expectedExternalNumber){
 if(response?.testMode===true)return {status:'TEST_ONLY',sentAt:null};
 const order=response?.data?.order||response?.data;
 if(response?.state?.status!=='OK'||order?.id!==expectedOrderId||order.customer?.purchaseOrderNo!==expectedExternalNumber||order.items?.length!==1||order.items[0].quantity!==1)throw Error('order_evidence_mismatch');
 const shipped=order.items[0].timings?.shipped;
 if(shipped&&!Number.isNaN(Date.parse(shipped)))return {status:'SENT',sentAt:shipped,orderId:order.id};
 return {status:'ORDERED',sentAt:null,orderId:order.id};
}
export function sheetProjection(j){
 return {record_id:j.id,hive_contact_id:j.snapshot.agentId,hive_inspection_id:j.snapshot.inspectionId,agency_id:j.snapshot.agencyId,recipient_name:[j.snapshot.recipient?.firstName,j.snapshot.recipient?.lastName].filter(Boolean).join(' '),brokerage_name:j.snapshot.recipient?.company||'',address_line1:j.snapshot.recipient?.address||'',address_line2:j.snapshot.recipient?.address2||'',city:j.snapshot.recipient?.city||'',region:j.snapshot.recipient?.region||'',postal_code:j.snapshot.recipient?.postcode||'',country:j.snapshot.recipient?.country||'',address_verified_at:j.snapshot.addressVerifiedAt||'',exact_draft_wording:j.draftText||'',exact_approved_wording:j.approvedText||'',exact_sent_wording:'',normalized_text_sha256:j.approvedText||j.draftText?hash(normalize(j.approvedText||j.draftText)):'',similarity_result:j.status==='HOLD'?'held_requires_recheck':j.status==='MANUAL_REVIEW'?'candidates_exhausted':j.draftText||j.approvedText?'trigram_dice_below_0.82':'not_tested',history_reconciled:j.historyReconciled===true,status:j.status,approval_by:j.approval?.by||'',approval_at:j.approval?.at||'',approval_fingerprint:j.approval?.fingerprint||'',artwork_version:j.approval?.artwork?.revision||'',idempotency_key:j.idempotencyKey,automation_instance_id:j.automationInstanceId||'',cardly_external_order_number:j.externalOrderNumber,cardly_order_id:'',cost:'',currency:'',created_at:j.createdAt,updated_at:j.updatedAt,ordered_at:'',sent_at:'',delivered_at:'',last_error:j.error||'',evidence_reference:'cards:'+j.id+':revision:'+j.revision,revision:j.revision};
}
export const SHEET_HEADERS='record_id,hive_contact_id,hive_inspection_id,agency_id,recipient_name,brokerage_name,address_line1,address_line2,city,region,postal_code,country,address_verified_at,exact_draft_wording,exact_approved_wording,exact_sent_wording,normalized_text_sha256,similarity_result,status,approval_by,approval_at,approval_fingerprint,artwork_version,idempotency_key,automation_instance_id,cardly_external_order_number,cardly_order_id,cost,currency,created_at,updated_at,ordered_at,sent_at,delivered_at,last_error,evidence_reference,history_reconciled'.split(',');
// Use Sheets API valueInputOption=RAW, never USER_ENTERED; exact wording can begin '='.
export function sheetRow(job){const p=sheetProjection(job);return SHEET_HEADERS.map(k=>String(p[k]??''));}
export function verifySheetReadback(job,headers,row){return Array.isArray(headers)&&Array.isArray(row)&&headers.length===37&&row.length===37&&headers.every((v,i)=>v===SHEET_HEADERS[i])&&row.every((v,i)=>String(v??'')===sheetRow(job)[i]);}
