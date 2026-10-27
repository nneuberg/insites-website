import {qualificationSnapshot} from './referral-qualification-clock.mjs';
import {assessReferralIdentity} from './referral-identity-evidence.mjs';
import {customerReservationKeys} from './referral-qualification-integration.mjs';
export const RUN='synthetic-referral-qualification-20261027-v2';
export function fixture(anchor){
 if(!Number.isFinite(anchor))throw Error('Fixture anchor required');
 const iso=n=>new Date(n).toISOString(),cutoff=iso(anchor-3*86400000),booking=iso(anchor-2*86400000);
 const cases=['same-a','same-b','different','first-seen'].map((suffix,n)=>{
  const inspectionId=RUN+'-'+suffix,useId='HIVE-'+inspectionId,sourceContactId='synthetic-contact-'+suffix,email=n<2?'same@example.invalid':suffix+'@example.invalid';
  const identityInput={email,sourceContactIds:[sourceContactId]},operatorEvidence={inspectionId,verified:true,authorized:true,reference:RUN+'/synthetic-completion/'+suffix,verifiedAt:booking};
  const facts={inspectionId,sourceContactId,clientEmail:email,referrerId:RUN+'-owner',code:'SYNTHETIC-QUALIFICATION-V2',bookingCreatedAt:booking,bookingProvenanceVerified:true,newCustomerVerified:true,consumerReferrerVerified:true,codeAssociationVerified:true,distinctPeopleVerified:true,fullyPaid:true,active:true,noPriorRewardVerified:true,serviceIds:['e7a79860-a349-40be-988b-0a55f57ee168']};
  const keys=customerReservationKeys(assessReferralIdentity(identityInput)),completion={verified:true,inspectionId,source:'operator-verified-completion',evidenceReference:operatorEvidence.reference};
  const q=qualificationSnapshot({facts:{...facts,canonicalCustomerId:keys.join('|'),identityVerified:true,completion},observedAt:iso(anchor-86400001),launchCutoff:cutoff}).state;
  return {useId,facts,identityInput,operatorEvidence,row:{'Use ID':useId,'Hive Inspection ID':inspectionId,'Client ID':sourceContactId,Code:facts.code,'Referrer Name':'SYNTHETIC TEST ONLY','Referrer Email':'owner@example.invalid',Eligibility:'ELIGIBLE','Service Verified':'YES','New Client Verified':'YES','Dispute Or Refund':'NO','Booked At':booking,Notes:RUN,'Qualification Evidence':n===3?'':JSON.stringify({version:1,qualified:true,binding:q.binding,customerKeys:keys,firstQualifiedAt:iso(anchor-86400001),lastVerifiedAt:iso(anchor-86400001),lastObservedAt:iso(anchor-86400001),completion})}};
 });
 return {run:RUN,anchor,cutoff,cases,codes:[{Code:'SYNTHETIC-QUALIFICATION-V2','Hive State':'VERIFIED','Assignment State':'ASSIGNED','Referrer Email':'owner@example.invalid','Referrer Name':'SYNTHETIC TEST ONLY','Assigned At':iso(anchor-4*86400000),Notes:RUN}],shares:[{'Share ID':RUN,Code:'SYNTHETIC-QUALIFICATION-V2','Referrer Email':'owner@example.invalid','Consent At':booking,Notes:RUN}]};
}
