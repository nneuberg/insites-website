import {qualification,reviewFingerprint} from './cards-core.mjs';
export const CARDLY_ASSETS=Object.freeze({artworkId:'cc7ce711-5608-3899-762e-a1e4eb82e202',templateId:'2ae60479-d2d7-c1dd-4cf7-7f84c8959a5f',templateSlug:'insites-agent-thank-you---approval-required',messagePage:3,shippingMethod:'standard',priceUsd:3.60});
// Pure preparation adapter only; never calls Cardly, Hive, Zapier or a network.
// IDs above read back from authenticated Cardly/Zapier UI, 2026-10-29.
export function buildInactiveZapMapping(job,organizationId){
 if(!job||job.status!=='APPROVED'||!job.approval||!job.approvedText)throw Error('owner_approval_required');
 const reason=qualification(job.snapshot,organizationId);if(reason)throw Error(reason);
 if(job.historyReconciled!==true)throw Error('history_unreconciled');
 if(job.approval.fingerprint!==reviewFingerprint(job,job.approvedText,job.approval.artwork))throw Error('approval_changed');
 const a=job.approval.artwork;
 if(a?.id!==CARDLY_ASSETS.artworkId||a?.templateId!==CARDLY_ASSETS.templateId||a?.messagePage!==3)throw Error('approved_artwork_mismatch');
 if(!job.externalOrderNumber||!/^[a-f0-9]{64}$/.test(job.idempotencyKey))throw Error('dedupe_identity_missing');
 const r=job.snapshot.recipient;
 return {mode:'INACTIVE_PREPARATION_ONLY',dispatchEnabled:false,fields:{templateId:CARDLY_ASSETS.templateId,artworkId:CARDLY_ASSETS.artworkId,shippingMethod:'standard',templateVar_approvedMessage:job.approvedText,recipientFirstName:r.firstName,recipientLastName:r.lastName||'',recipientCompany:r.company||'',recipientCountry:r.country,recipientAddress1:r.address,recipientAddress2:r.address2||'',recipientLocality:r.city,recipientRegion:r.region,recipientPostcode:r.postcode,purchaseOrderNumber:job.externalOrderNumber,testMode:true},evidence:{jobId:job.id,revision:job.revision,inspectionId:job.snapshot.inspectionId,contactId:job.snapshot.agentId,agencyId:job.snapshot.agencyId,approvalFingerprint:job.approval.fingerprint,idempotencyKey:job.idempotencyKey}};
}
