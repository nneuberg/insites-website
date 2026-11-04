// Fixed metadata-only lookup for the already created empty native rating group.
// No member, campaign, subscription, token provisioning, or arbitrary URL access.
const AUDIENCE='8f8749ba24',CATEGORY='Referral rating eligibility v1',OPTION='Verified 4 or 5 star rating';
const id=x=>typeof x==='string'&&/^[a-f0-9]{10}$/.test(x);
export function createReferralRatingMetadata({env=process.env,fetcher=fetch,now=()=>Date.now()}={}){
 return async()=>{
  const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);if(!/^us\d+$/.test(dc||''))throw Error('Metadata unavailable');
  const deadline=now()+8000,headers={Authorization:'Basic '+Buffer.from('insites:'+env.MAILCHIMP_API_KEY).toString('base64')};
  const get=async path=>{const remaining=Math.min(4000,deadline-now());if(remaining<500)throw Error('Metadata deadline');const r=await fetcher('https://'+dc+'.api.mailchimp.com/3.0/lists/'+AUDIENCE+path,{method:'GET',headers,signal:AbortSignal.timeout(remaining)});if(!r.ok)throw Error('Metadata unavailable');return r.json();};
  const categories=await get('/interest-categories?type=hidden&count=100&fields=list_id,total_items,categories.id,categories.list_id,categories.title,categories.type');
  if(categories.list_id!==AUDIENCE||!Array.isArray(categories.categories)||!Number.isSafeInteger(categories.total_items)||categories.total_items!==categories.categories.length||categories.total_items>100)throw Error('Incomplete category metadata');
  const found=categories.categories.filter(c=>c.title===CATEGORY);if(found.length!==1||found[0].list_id!==AUDIENCE||found[0].type!=='hidden'||!id(found[0].id))throw Error('Exact hidden category unavailable');
  const category=found[0],interests=await get('/interest-categories/'+category.id+'/interests?count=100&fields=list_id,category_id,total_items,interests.id,interests.category_id,interests.list_id,interests.name,interests.subscriber_count');
  if(interests.list_id!==AUDIENCE||interests.category_id!==category.id||!Array.isArray(interests.interests)||!Number.isSafeInteger(interests.total_items)||interests.total_items!==interests.interests.length||interests.total_items>100)throw Error('Incomplete interest metadata');
  const matches=interests.interests.filter(i=>i.name===OPTION);if(matches.length!==1||matches[0].list_id!==AUDIENCE||matches[0].category_id!==category.id||!id(matches[0].id))throw Error('Exact interest unavailable');
  const count=matches[0].subscriber_count;if(!/^(0|[1-9]\d*)$/.test(String(count))||!Number.isSafeInteger(Number(count)))throw Error('Unknown membership count');
  return{audienceId:AUDIENCE,categoryId:category.id,interestId:matches[0].id,category:CATEGORY,option:OPTION,hidden:true,memberCount:Number(count),observedAt:now()};
 };
}
