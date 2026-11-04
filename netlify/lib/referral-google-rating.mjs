// Bounded read-only check of the exact already identity-confirmed Google review.
// Uses existing runtime credentials only. No names/emails are matched here.
export function createCurrentGoogleReviewReader({env=process.env,fetcher=fetch,now=()=>Date.now(),deadline=Infinity}={}){
 let accessToken=null;const results=new Map();
 const request=async(url,options={})=>{const remaining=Math.min(5000,deadline-now());if(remaining<500)throw Error('Google rating deadline');return fetcher(url,{...options,signal:AbortSignal.timeout(remaining)});};
 return async (reviewId,{forceFresh=false}={})=>{
  if(typeof reviewId!=='string'||!/^[A-Za-z0-9_-]{1,300}$/.test(reviewId))return null;
  const cached=results.get(reviewId);if(!forceFresh&&cached&&now()-cached.observedAt<=60000)return cached;
  try{
   if(!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/.test(env.GOOGLE_REVIEW_LOCATION||'')||!['GOOGLE_REVIEW_CLIENT_ID','GOOGLE_REVIEW_CLIENT_SECRET','GOOGLE_REVIEW_REFRESH_TOKEN'].every(k=>typeof env[k]==='string'&&env[k]))return null;
   if(!accessToken){const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_REVIEW_CLIENT_ID,client_secret:env.GOOGLE_REVIEW_CLIENT_SECRET,refresh_token:env.GOOGLE_REVIEW_REFRESH_TOKEN})});if(!r.ok)return null;const body=await r.json();if(typeof body.access_token!=='string'||!body.access_token)return null;accessToken=body.access_token;}
   const name=env.GOOGLE_REVIEW_LOCATION+'/reviews/'+reviewId,response=await request('https://mybusiness.googleapis.com/v4/'+name,{headers:{Authorization:'Bearer '+accessToken}});
   if(!response.ok)return null;const review=await response.json();if(review.reviewId!==reviewId||review.name!==undefined&&review.name!==name||!['ONE','TWO','THREE','FOUR','FIVE'].includes(review.starRating))return null;
   const result={verified:true,source:'google_reviews_get',observedAt:now(),review};results.set(reviewId,result);return result;
  }catch{return null;}
 };
}
