import {MARKETING_ADMISSION} from '../lib/marketing-admission-config.mjs';
import {ownerProxy} from '../lib/marketing-owner-proxy.mjs';
export default async(request,context)=>{
 if(context?.deploy?.context!=='production')return Response.json({off:true},{headers:{'Cache-Control':'no-store'}});
 return ownerProxy(request,{config:MARKETING_ADMISSION,secret:process.env.REFERRAL_LEDGER_SECRET,production:true,loadServices:async()=>{
 const [{getStore},{createMarketingMailchimp},{createMarketingHiveEligibility},{sourceServices},{createMarketingEligibility},{reviewStore},{createOwnerIO},{createManualExclusion}]=await Promise.all([import('@netlify/blobs'),import('../lib/marketing-mailchimp.mjs'),import('../lib/marketing-hive-eligibility.mjs'),import('../lib/hive-source-runtime.mjs'),import('../lib/marketing-eligibility.mjs'),import('../lib/review-runtime.mjs'),import('../lib/marketing-owner-io.mjs'),import('../lib/marketing-manual-exclusions.mjs')]);
 const provider=createMarketingMailchimp({deadline:Date.now()+20000}),sourceNoBusiness=createMarketingHiveEligibility({services:()=>sourceServices(context)}),manualExclusion=createManualExclusion();
 const eligibility=createMarketingEligibility({sourceNoBusiness,reviewRow:token=>reviewStore(context).get('requests/'+token,{type:'json'}),provider});
 const io=createOwnerIO({config:MARKETING_ADMISSION,provider,eligibility,sourceNoBusiness,cache:sourceServices(context).cache,manualExclusion});
 return {io,provider,claims:getStore({name:'insites-marketing-owner-trigger-receipts-v1',consistency:'strong'})};
 }});
};
