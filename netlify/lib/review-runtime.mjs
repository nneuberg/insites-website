import {MARKETING_ADMISSION} from './marketing-admission-config.mjs';
import {createAdmissionClient} from './marketing-admission-client.mjs';
import {createReviewAdmission} from './marketing-review-adapter.mjs';
import {HIVE_INCIDENT} from './hive-incident.mjs';
import {sourceTransport,sourceServices} from './hive-source-runtime.mjs';
import {SOURCE_PLAN} from './hive-source-sync.mjs';
import {reviewEnvironment} from './review-launch.mjs';
import {getStore} from '@netlify/blobs';
import {createEngine} from './review-engine.mjs';
import {createReferralRatingRuntime} from './referral-rating-runtime.mjs';
import {createMarketingMailchimp} from './marketing-mailchimp.mjs';
export function reviewStore(functionContext){
 const context=functionContext?.deploy?.context||process.env.CONTEXT||'local';
 // Preview and local runs never touch production feedback records.
 const name=context==='production'?'insites-review-campaign':'insites-review-campaign-'+(functionContext?.deploy?.id||process.env.DEPLOY_ID||'local');
 return getStore({name,consistency:'strong'});
}
export function runtime(functionContext,{work}={}){
 const store=reviewStore(functionContext),env=reviewEnvironment();let rating=null;
 const engine=createEngine({work,fetcher:work?work.wrapFetch():fetch,admission:MARKETING_ADMISSION.reviewOwnerEnabled?createReviewAdmission({config:MARKETING_ADMISSION,work,client:createAdmissionClient({deadline:work?.deadline})}):null,store,env,hivePaused:HIVE_INCIDENT.paused||!SOURCE_PLAN.reviewEnrollmentEnabled,hiveTransport:sourceTransport(functionContext),sourceContact:SOURCE_PLAN.enabled?sourceServices(functionContext).view.getContact:null,ratingInvalidation:row=>rating?.invalidate(row),ratingCleanup:()=>rating?.cleanup()});
 if(MARKETING_ADMISSION.referralRatingProjection?.enabled===true){const deadline=Date.now()+20000;rating=createReferralRatingRuntime({config:MARKETING_ADMISSION,store,locked:engine.locked,provider:createMarketingMailchimp({env,deadline,positiveRatingInterest:MARKETING_ADMISSION.referralRatingProjection.interestId}),env,deadline});}
 return engine;
}
export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
