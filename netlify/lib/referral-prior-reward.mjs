import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const norm=v=>String(v||'').trim().toLowerCase();
const key=v=>'referral-customer:'+hash(v);
// Full HMAC-authenticated codeSnapshot read; reservation still occurs under the
// existing Apps Script lock. No API mutation or absence inference from a sample.
export function ledgerPriorRewardReader({readHive}){
 return async({useId,inspectionId,email,sourceContactIds,snapshot})=>{
  const unknown=reason=>({verified:false,clear:false,reason});
  if(snapshot?.version!=='2026-10-22-reconcile'||!Array.isArray(snapshot.uses)||!Array.isArray(sourceContactIds)||!sourceContactIds.length)return unknown('Full reward ledger unavailable');
  const ids=new Set(sourceContactIds),keys=new Set([key('email:'+norm(email)),...sourceContactIds.map(id=>key('hive-contact:'+id))]);
  const useIds=new Set();
  for(const row of snapshot.uses){
   if(!row||typeof row['Use ID']!=='string'||useIds.has(row['Use ID']))return unknown('Reward ledger identity ambiguous');useIds.add(row['Use ID']);
   if(!row['Reward State']&&!row['Reward ID']&&!row['Claim Order ID'])continue;
   // Own unissued reservation is replayable, never another customer's reward.
   if(row['Use ID']===useId&&row['Hive Inspection ID']===inspectionId&&ids.has(row['Client ID'])&&row['Reward State']==='RESERVED'&&!row['Reward ID']&&row['Claim Order ID']==='insites-referral-'+hash(useId))continue;
   let overlap=row['Hive Inspection ID']===inspectionId||ids.has(row['Client ID']);
   if(row['Qualification Evidence']){
    let q;try{q=JSON.parse(row['Qualification Evidence']);}catch{return unknown('Reward identity evidence malformed');}
    if(!Array.isArray(q?.customerKeys)||!q.customerKeys.length||q.customerKeys.some(k=>!/^referral-customer:[a-f0-9]{64}$/.test(k)))return unknown('Reward identity evidence incomplete');
    overlap ||= q.customerKeys.some(k=>keys.has(k));
   }else if(!overlap){
    // Older ledger rows have no client email column. Resolve their bound Hive
    // inspection instead of assuming a different contact ID is a different person.
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(row['Hive Inspection ID']||''))return unknown('Legacy reward source missing');
    let inspection;try{inspection=await readHive('inspections/'+encodeURIComponent(row['Hive Inspection ID']));}catch{return unknown('Legacy reward source unavailable');}
    const customers=inspection?.contacts?.filter(c=>c.role==='Customer');
    if(inspection?.id!==row['Hive Inspection ID']||customers?.length!==1||customers[0].id!==row['Client ID']||!norm(customers[0].email))return unknown('Legacy reward identity changed or unknown');
    overlap=norm(customers[0].email)===norm(email);
   }
   if(overlap)return {verified:true,useId,email:norm(email),clear:false,reference:'codeSnapshot:prior-reward'};
  }
  return {verified:true,useId,email:norm(email),clear:true,reference:'codeSnapshot:2026-10-22-reconcile'};
 };
}
