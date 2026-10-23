import {createHash} from 'node:crypto';
export function queueLowRating(row,now){
 if(row.isTest||row.lowRatingAlert||!Number.isInteger(row.rating)||row.rating<1||row.rating>3)return;
 row.lowRatingAlert={state:'pending',submittedAt:now,rating:row.rating,feedback:row.feedback,revision:row.feedbackRevision||1,
  body:{from:'InSites Reviews <neal@insites.services>',to:['neal@insites.services'],subject:'Private InSites feedback: follow-up requested',
   text:`Private feedback saved at ${new Date(now).toISOString()}\n\nName: ${row.name}\nRole: ${row.role}\nInspection/property: ${row.address}\nContact email: ${row.email}\nRating: ${row.rating}/5\n\nComment:\n${row.feedback||'(No written comment)'}\n\nThis is the first low-rating submission for this review request. Later edits may differ; no automatic follow-up has been sent to this person. This alert does not confirm a Google review.`}};
}
export async function deliverLowRating(row,{env,fetcher,save,now}){
 const alert=row.lowRatingAlert;if(alert?.state!=='pending'||row.isTest)return;
 if(!env.RESEND_API_KEY){alert.lastError='Email integration unavailable';await save(row);return;}
 // Stop before the provider's 24-hour idempotency window expires. Never resend blindly after that.
 if(alert.firstAttemptAt!==undefined&&now()-alert.firstAttemptAt>=23*3600000){alert.state='needs-review';alert.lastError='Delivery requires provider reconciliation before another attempt';await save(row);return;}
 if(alert.firstAttemptAt===undefined){alert.firstAttemptAt=now();await save(row);}
 try{
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'review-low-'+createHash('sha256').update(row.token).digest('hex')},body:JSON.stringify(alert.body),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Email provider did not confirm delivery');
  const receipt=await response.json();if(!receipt.id)throw Error('Email provider receipt missing');
  alert.state='sent';alert.emailId=receipt.id;alert.sentAt=now();delete alert.lastError;await save(row);
 }catch{alert.state='pending';alert.lastError='Delivery unconfirmed; retry uses the same idempotency key';await save(row);console.warn('Low-rating alert delivery unconfirmed; saved feedback retained.');}
}
