// No account, catalog, funding or customer-send approval has been applied.
export const CLAIM_LAUNCH=Object.freeze({enabled:false,purchasing:false,catalogVerified:false,environment:'sandbox',productId:null,fundingSourceId:null});

export const CLAIM_WORKER=Object.freeze({dispatch:false,reconciliation:false,operations:false,dryRun:true,qualificationInputsVerified:false,startAfter:null});

// Deliberately unverified until a reviewed activation configuration supplies fee evidence.
export const CLAIM_BUDGET=Object.freeze({enabled:false,monthlyCapCents:20000,timeZone:"America/New_York",maxFeeCents:null,feeEvidence:null});
export const CLAIM_SENDER=Object.freeze({verified:false,from:"InSites <offers@insites.services>",replyTo:"neal@insites.services",audienceId:null});
