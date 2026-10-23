import {createAutomationCapture} from '../lib/review-automation.mjs';
// Stage one intentionally cannot enroll: no runtime/engine dependency.
export default async(request,context)=>{
 const {getStore}=await import('@netlify/blobs');
 const production=context?.deploy?.context==='production'||process.env.CONTEXT==='production';
 const name=production?'insites-review-automation-captures':'insites-review-automation-captures-'+(context?.deploy?.id||process.env.DEPLOY_ID||'local');
 const store=getStore({name,consistency:'strong'});
 return createAutomationCapture({secret:process.env.REVIEW_HIVE_AUTOMATION_SECRET,organizationId:process.env.REVIEW_HIVE_AUTOMATION_ORGANIZATION_ID,templateId:process.env.REVIEW_HIVE_AUTOMATION_TEMPLATE_ID,save:store.setJSON.bind(store)})(request);
};
