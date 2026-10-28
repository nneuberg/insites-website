// Pure validation, no credentials, provisioning or implicit activation.
export function validateClaimRuntime({launch,worker,budget,sender,now=Date.now()}){
 const active=launch.enabled||launch.purchasing||worker.dispatch||worker.reconciliation||worker.operations;
 if(!active)return {disabled:true};
 if(launch.environment!=='production'||launch.productId!=='OKMHM2X2OHYV'||launch.fundingSourceId!=='BALANCE'||launch.catalogVerified!==true)throw Error('Verified production Amazon/prepaid configuration required');
 if(!budget.enabled||budget.monthlyCapCents!==20000||budget.timeZone!=='America/New_York'||!Number.isSafeInteger(budget.maxFeeCents)||budget.maxFeeCents<0||typeof budget.feeEvidence!=='string'||!budget.feeEvidence.trim())throw Error('Verified fee-inclusive budget required');
 if(!Number.isFinite(Date.parse(worker.startAfter))||Date.parse(worker.startAfter)>now||worker.qualificationInputsVerified!==true)throw Error('Qualification evidence and launch cutoff required');
 if(worker.dispatch){if(!sender.verified||sender.from!=='InSites <offers@insites.services>'||sender.replyTo!=='neal@insites.services'||sender.audienceId!=='8f8749ba24')throw Error('Verified consumer invitation sender and audience required');}
 return {disabled:false};
}
