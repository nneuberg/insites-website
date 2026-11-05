import {auditPhotoSource,summarizePhotoAudit} from './photo-source-audit.mjs';

// Read-only main-service catalogue observed in Hive's actual Services & Fees UI
// on 2026-11-05. Add-on IDs and exhaustive imported history are NOT verified.
// This is not an activation configuration or authority for absence-based sends.
export const PHOTO_AUDIT_CATALOG=Object.freeze({verified:true,complete:false,version:'hive-ui-photo-main-20261105',serviceIds:Object.freeze([
 'd7790451-3469-4c5c-9c2b-8719a00e0dad',
 'a9ed3579-60fe-4d4d-84b1-6d013aa1c919',
 '7052c3ec-7e91-4fea-a9b4-0fb8a2905f19',
 'e3539d41-b38c-428b-b0d6-a85e160812b2',
 'a02d2ad0-7668-4ebb-aa49-709d806d438e',
 'ed9582b7-6b04-4c31-b9f3-51fdf2acb640'
]),addOnIds:Object.freeze([])});

const AUDIENCE='3ebb3017d4',CATEGORY='InSites internal marketing state',OPTION='Photography customer';
const id=x=>typeof x==='string'&&/^[a-f0-9]{10}$/.test(x);
export function createPhotoGroupMetadata({env=process.env,fetcher=fetch,now=()=>Date.now()}={}){
 return async()=>{
  const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);if(!/^us\d+$/.test(dc||''))throw Error('Metadata unavailable');
  const deadline=now()+8000,headers={Authorization:'Basic '+Buffer.from('insites:'+env.MAILCHIMP_API_KEY).toString('base64')};
  const get=async path=>{const remaining=Math.min(4000,deadline-now());if(remaining<500)throw Error('Metadata deadline');const r=await fetcher('https://'+dc+'.api.mailchimp.com/3.0/lists/'+AUDIENCE+path,{method:'GET',headers,signal:AbortSignal.timeout(remaining)});if(!r.ok)throw Error('Metadata unavailable');return r.json();};
  const categories=await get('/interest-categories?type=hidden&count=100&fields=list_id,total_items,categories.id,categories.list_id,categories.title,categories.type');
  if(categories.list_id!==AUDIENCE||!Array.isArray(categories.categories)||!Number.isSafeInteger(categories.total_items)||categories.total_items!==categories.categories.length||categories.total_items>100)throw Error('Incomplete category metadata');
  const found=categories.categories.filter(c=>c.title===CATEGORY);
  if(found.length!==1||found[0].list_id!==AUDIENCE||found[0].type!=='hidden'||!id(found[0].id))throw Error('Exact hidden category unavailable');
  const category=found[0],r=await get('/interest-categories/'+category.id+'/interests?count=100&fields=list_id,category_id,total_items,interests.id,interests.category_id,interests.list_id,interests.name,interests.subscriber_count');
  if(r.list_id!==AUDIENCE||r.category_id!==category.id||!Array.isArray(r.interests)||!Number.isSafeInteger(r.total_items)||r.total_items!==r.interests.length||r.total_items>100)throw Error('Incomplete interest metadata');
  const matches=r.interests.filter(i=>i.name===OPTION);
  if(matches.length===0)return {status:'not_created',audienceId:AUDIENCE,categoryId:category.id,category:CATEGORY,option:OPTION,hidden:true,observedAt:now()};
  if(matches.length!==1||matches[0].list_id!==AUDIENCE||matches[0].category_id!==category.id||!id(matches[0].id))throw Error('Exact interest unavailable');
  const count=matches[0].subscriber_count;if(!/^(0|[1-9]\d*)$/.test(String(count))||!Number.isSafeInteger(Number(count)))throw Error('Unknown membership count');
  return {status:'found',audienceId:AUDIENCE,categoryId:category.id,interestId:matches[0].id,category:CATEGORY,option:OPTION,hidden:true,memberCount:Number(count),observedAt:now()};
 };
}

export async function photoReadiness({services,metadata,now=()=>Date.now()}={}){
 const source=summarizePhotoAudit(await auditPhotoSource({services,catalog:PHOTO_AUDIT_CATALOG,attributionPolicy:'unique-listing-agent',now}));
 let group;try{group=await metadata();}catch{group={status:'unavailable'};}
 return {mode:'read_only',writerEnabled:false,schedulerEnabled:false,source,group,productionReady:false};
}
