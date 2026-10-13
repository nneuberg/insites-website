import {randomBytes,createHash} from 'node:crypto';
import {DAY,ORIGIN,escapeHTML} from './review-policy.mjs';
export function googleSync({store,engine,env=process.env,fetcher=fetch,now=()=>Date.now()}){
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const ready=()=>['GOOGLE_REVIEW_CLIENT_ID','GOOGLE_REVIEW_CLIENT_SECRET','GOOGLE_REVIEW_REFRESH_TOKEN','GOOGLE_REVIEW_LOCATION'].every(k=>env[k]);
 const time=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' Eastern';
 async function run(){
  if(env.REVIEW_ENABLED!=='true'||!ready())return {googlePaused:true};
  if(!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/.test(env.GOOGLE_REVIEW_LOCATION))throw Error('Invalid Google location');
  const auth=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_REVIEW_CLIENT_ID,client_secret:env.GOOGLE_REVIEW_CLIENT_SECRET,refresh_token:env.GOOGLE_REVIEW_REFRESH_TOKEN}),signal:AbortSignal.timeout(12000)});
  if(!auth.ok)throw Error('Google authorization requires attention');const credentials=await auth.json();
  const query=new URLSearchParams({pageSize:'50',orderBy:'updateTime desc'});
  const response=await fetcher('https://mybusiness.googleapis.com/v4/'+env.GOOGLE_REVIEW_LOCATION+'/reviews?'+query,{headers:{Authorization:'Bearer '+credentials.access_token},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Google reviews unavailable');const data=await response.json();
  // Establish a baseline so existing reviews never generate a flood of match emails.
  const baseline=await store.get('google-baseline',{type:'json'});
  if(!baseline){await store.setJSON('google-baseline',{since:now()});return {baselineCreated:true};}
  const rows=[];
  for await(const page of store.list({prefix:'requests/',paginate:true}))for(const blob of page.blobs){const row=await store.get(blob.key,{type:'json'});if(!row.isTest&&!row.googleReviewedAt&&row.createdAt>=now()-30*DAY)rows.push(row);}
  let notified=0;
  for(const review of data.reviews||[]){
   const created=Date.parse(review.createTime);if(!review.reviewId||!Number.isFinite(created)||created<baseline.since)continue;
   const key='google-notices/'+hash(review.reviewId);
   await engine.locked(key,async()=>{
    let notice=await store.get(key,{type:'json'});if(notice?.sent)return;
    const candidates=rows.filter(r=>r.createdAt<=created&&created-r.createdAt<=30*DAY).sort((a,b)=>(b.ratedAt||b.createdAt)-(a.ratedAt||a.createdAt)).slice(0,10);
    if(!candidates.length)return;
    if(!notice){notice={review,options:candidates.map(r=>({token:randomBytes(24).toString('hex'),requestToken:r.token})),createdAt:now()};await store.setJSON(key,notice);}
    for(const option of notice.options)await store.setJSON('matches/'+option.token,{requestToken:option.requestToken,review:notice.review,expiresAt:notice.createdAt+14*DAY},{onlyIfNew:true});
    const html='<h2>New Google review — please verify the person</h2><p><strong>'+escapeHTML(review.reviewer?.displayName||'Anonymous')+'</strong> · '+escapeHTML(review.starRating)+' · '+escapeHTML(time(created))+'</p><blockquote>'+escapeHTML(review.comment||'(No written comment)')+'</blockquote><p>Possible contacts are shown below. A similar name or date does not prove a match.</p>'+notice.options.map(o=>{const row=rows.find(r=>r.token===o.requestToken);if(!row)return '';return '<p><strong>'+escapeHTML(row.name)+'</strong> ('+escapeHTML(row.role)+')<br>'+escapeHTML(row.address)+'<br>Feedback: '+(row.ratedAt?escapeHTML(row.rating+' stars · '+time(row.ratedAt)):'Not submitted')+'<br><a href="'+ORIGIN+'/review-match/?token='+o.token+'">Review this possible match</a></p>';}).join('');
    const sent=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'review-match-'+hash(review.reviewId)},body:JSON.stringify({from:'InSites Reviews <neal@insites.services>',to:['neal@insites.services'],subject:'Please verify a new InSites Google review',html}),signal:AbortSignal.timeout(12000)});
    if(!sent.ok)throw Error('Match email could not be sent');notice.sent=true;await store.setJSON(key,notice);notified++;
   });
  }
  return {notified};
 }
 return {run,ready};
}
