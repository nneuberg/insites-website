import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../lib/referral-service-catalog.mjs';
import {hiveReader,auditReferrals} from '../lib/referral-hive.mjs';
import {ledger} from '../lib/referral-transport.mjs';
// Bounded daily diagnostic, also runnable from Netlify Run now. No customer writes, emails, or gift-card calls.
export default async()=>{
 const {getStore}=await import('@netlify/blobs');
 const snapshot=await ledger('codeSnapshot',{},process.env,10000);
 const audit=await auditReferrals({read:hiveReader(),snapshot,maxPages:1,pageSize:5,serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS});
 const report={checkedAt:new Date().toISOString(),read:audit.read,complete:audit.complete,matched:audit.results.filter(r=>r.matched).length,assignedCodes:snapshot.codes.filter(c=>c['Assignment State']==='ASSIGNED').length,availableCodes:snapshot.codes.filter(c=>c['Assignment State']==='AVAILABLE'&&c['Hive State']==='VERIFIED'&&!c['Referrer Email']&&Number(c['Discount Amount'])===25).length,observedServices:audit.observedServices,results:audit.results.map(({facts,...r})=>r),mode:'READ ONLY; no rewards or messages'};
 await getStore({name:'insites-referral-audit',consistency:'strong'}).setJSON('latest',report);
 console.log(JSON.stringify(report));return new Response(null,{status:204});
};
export const config={schedule:'0 8 * * *'};
