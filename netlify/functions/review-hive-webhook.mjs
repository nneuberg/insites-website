import {REVIEW_EVENTS} from '../lib/review-event-launch.mjs';
import {createAutomationCapture,REVIEW_AUTOMATION_TEMPLATE,REVIEW_AUTOMATION_ORGANIZATION} from '../lib/review-automation.mjs';
// Receiver stores verified IDs only; scheduled worker performs fresh eligibility checks.
export default async(request,context)=>{
 const {getStore}=await import('@netlify/blobs');
 const production=context?.deploy?.context==='production'||process.env.CONTEXT==='production';
 const name=production?'insites-review-automation-captures':'insites-review-automation-captures-'+(context?.deploy?.id||process.env.DEPLOY_ID||'local');
 const store=getStore({name,consistency:'strong'});
 return createAutomationCapture({secret:process.env.REVIEW_HIVE_AUTOMATION_SECRET,organizationId:REVIEW_AUTOMATION_ORGANIZATION,templateId:REVIEW_AUTOMATION_TEMPLATE,processing:REVIEW_EVENTS.receive,completionEvent:REVIEW_EVENTS.completionEvent,enqueue:async(key,value,options)=>{const {reviewStore}=await import('../lib/review-runtime.mjs');return reviewStore(context).setJSON(key,value,options);},save:store.setJSON.bind(store)})(request);
};
