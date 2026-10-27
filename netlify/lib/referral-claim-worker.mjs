import {createHash} from 'node:crypto';
export function claimSuppression({request}){return async email=>{const normalized=String(email||'').trim().toLowerCase();const member=await request('GET','/members/'+createHash('md5').update(normalized).digest('hex'));return !!member&&member.status==='subscribed'&&String(member.email_address||'').trim().toLowerCase()===normalized;};}
export function claimOperator({claims,invitations,resolveToken}){return async command=>{if(!command||!['reconcile','revoke','release-held','record-invitation-receipt'].includes(command.action))throw Error('Unsupported recovery');if(command.action==='record-invitation-receipt')return invitations.reconcileReceipt(command.useId,command.evidence);const token=await resolveToken(command.useId);if(command.action==='reconcile')return claims.reconcile(token);if(command.action==='revoke')return claims.revoke(token);return claims.releaseHeld(token,command.evidence,command.id);};}
export async function claimWorker({ledger,claims,invitations,operator,resolveToken,store,suppression,config={},now=()=>Date.now(),limit=10}){
 const report={mode:config.dryRun!==false?'no-send':'active',candidates:0,prepared:0,sent:0,suppressed:0,reconciled:0,operations:0,held:0,failed:0};
 if(!config.dispatch&&!config.reconciliation&&!config.operations)return {...report,disabled:true};
 const dry=config.dryRun!==false;limit=Math.max(1,Math.min(10,limit));
 if(config.dispatch){
  if(config.qualificationInputsVerified!==true||!Number.isFinite(Date.parse(config.startAfter))||Date.parse(config.startAfter)>now())report.blocked='Qualification inputs or launch cutoff unverified';
  else {
  const cursor=await store.get('worker/candidates',{type:'json'});const page=await ledger('claimCandidates',{after:cursor?.after||'',limit,startAfter:config.startAfter});
  for(const item of page.items){report.candidates++;try{const candidate=await ledger('claimCandidate',{useId:item.useId});if(!candidate.ready||candidate.invitationAllowed!==true){report.held++;continue;}if(!await suppression(candidate.email)){report.suppressed++;continue;}if(dry)continue;await invitations.prepare(item.useId);report.prepared++;const result=await invitations.deliver(item.useId);if(result.state==='sent')report.sent++;else report.held++;}catch{report.failed++;}}
  if(!dry)await store.setJSON('worker/candidates',{after:page.next||''});
  }
 }
 if(config.reconciliation){
  const cursor=await store.get('worker/recovery',{type:'json'}),after=cursor?.after||'';
  // SDK pagination is an AsyncIterator; provider cursors are not persisted.
  // Keep only the next bounded batch in memory, regardless of page ordering.
  let keys=[];
  for await(const page of store.list({prefix:'claim-uses/',paginate:true})){
   for(const entry of page.blobs){if(entry.key>after)keys.push(entry.key);}
   keys=[...new Set(keys)].sort().slice(0,limit+1);
  }
  for(const key of keys.slice(0,limit)){try{const index=await store.get(key,{type:'json'});const row=await store.get(index.claimKey,{type:'json'});if(!row?.attemptedAt||row.ledgerSynced)continue;if(dry){report.held++;continue;}const result=await claims.reconcile(await resolveToken(row.useId));if(result.state==='issued')report.reconciled++;else report.held++;}catch{report.failed++;}}
  if(!dry)await store.setJSON('worker/recovery',{after:keys.length>limit?keys[limit-1]:''});
 }

 if(config.operations){const page=await ledger('claimOperations', {limit});for(const command of page.items){if(dry){report.held++;continue;}try{await operator(command);await ledger('finishClaimOperation',{id:command.id,state:'DONE'});report.operations++;}catch{await ledger('finishClaimOperation',{id:command.id,state:'REVIEW REQUIRED'});report.failed++;}}}
 return report;
}
