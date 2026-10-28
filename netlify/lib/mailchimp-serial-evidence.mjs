import {createHash} from 'node:crypto';
const md5=s=>createHash('md5').update(s).digest('hex');
// GET-only bounded reader. No member mutation, event POST, or credential output.
export function mailchimpEvidenceReader({env,fetcher=fetch,now=()=>Date.now()}){
 return async email=>{
  const normalized=String(email).trim().toLowerCase(),key=env?.MAILCHIMP_API_KEY;
  if(!/^\S+@\S+\.\S+$/.test(normalized)||!key?.endsWith('-us5')||env.MAILCHIMP_REFERRAL_AUDIENCE_ID!=='8f8749ba24')throw Error('Evidence connection unverified');
  const base=`https://us5.api.mailchimp.com/3.0/lists/8f8749ba24/members/${md5(normalized)}`;
  const read=async path=>{const r=await fetcher(base+path,{method:'GET',headers:{Authorization:'Basic '+Buffer.from('insites:'+key).toString('base64')},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Evidence unavailable');return r.json()};
  const member=await read('');if(String(member.email_address).trim().toLowerCase()!==normalized)throw Error('Evidence identity mismatch');
  const pages=async(path,field)=>{let items=[];for(let p=0;p<10;p++){const d=await read(`${path}?count=100&offset=${p*100}`);if(!Array.isArray(d[field]))throw Error('Evidence schema mismatch');items.push(...d[field]);if(d[field].length<100)return {items,complete:true};}return {items,complete:false};};
  const [events,activity]=await Promise.all([pages('/events','events'),pages('/activity-feed','activity')]);
  return {memberHash:md5(normalized),listId:'8f8749ba24',subscribed:member.status==='subscribed',observedAt:now(),events:events.items,activity:activity.items,complete:events.complete&&activity.complete};
 };
}
// This establishes a SENT notification under a verified exclusive single-step flow
// contract, not mailbox delivery or an API-reported Journey exit. Missing evidence
// remains held. No timeout/empty history ever authorizes resending the same event.
export function correlateSerialSent({snapshot,intent,baseline,policy}){
 const held=reason=>({verified:false,releaseRecipient:false,reason});
 if(policy?.exclusiveSingleStep!==true||policy.noOtherEventProducers!==true||policy.campaignMappingVerified!==true||typeof policy.campaignId!=='string'||!policy.campaignId||!Number.isSafeInteger(policy.waitMs)||policy.waitMs<300000)return held('flow-contract-unverified');
 if(!Number.isSafeInteger(intent?.attemptedAt)||!Number.isSafeInteger(snapshot?.observedAt)||!Number.isSafeInteger(baseline?.observedAt))return held('invalid-evidence-time');
 if(!snapshot?.complete||!baseline?.complete||snapshot.listId!=='8f8749ba24'||snapshot.memberHash!==intent?.memberHash||baseline.memberHash!==intent.memberHash||baseline.listId!==snapshot.listId||baseline.unresolvedPriorAttempts!==0||baseline.observedAt>intent.attemptedAt||snapshot.observedAt<intent.attemptedAt)return held('incomplete-or-conflicting-baseline');
 if(!Array.isArray(baseline.events)||!Array.isArray(snapshot.events)||!Array.isArray(snapshot.activity)||!Array.isArray(baseline.activity))return held('evidence-shape');
 const eventKey=e=>JSON.stringify([e.name,e.properties?.invitation_id,e.properties?.reward_id]);
 const previousEvents=new Set(baseline.events.map(eventKey));
 // occurred_at is supplied by our preparation, not proof of provider ingestion time.
 const newEvents=snapshot.events.filter(e=>e?.name===policy.eventName&&!previousEvents.has(eventKey(e)));
 if(newEvents.length!==1||newEvents[0].properties?.invitation_id!==intent.invitationId||newEvents[0].properties?.reward_id!==intent.rewardId)return held('event-not-uniquely-bound');
 const old=new Set(baseline.activity.filter(a=>a.activity_type==='sent').map(a=>`${a.campaign_id}|${a.created_at_timestamp}`));
 const candidates=snapshot.activity.filter(a=>a.activity_type==='sent'&&a.campaign_id===policy.campaignId&&!old.has(`${a.campaign_id}|${a.created_at_timestamp}`)&&Date.parse(a.created_at_timestamp)>=intent.attemptedAt&&Date.parse(a.created_at_timestamp)<=snapshot.observedAt);
 if(candidates.length!==1)return held('send-not-unique');
 const candidate=candidates[0];
 return {verified:true,kind:'email-sent',invitationId:intent.invitationId,rewardId:intent.rewardId,campaignId:policy.campaignId,reference:`activity:${policy.campaignId}:${candidate.created_at_timestamp}`,sentAt:Date.parse(candidate.created_at_timestamp),observedAt:snapshot.observedAt,releaseRecipient:true,notBefore:snapshot.observedAt+policy.waitMs,deliveryProven:false,journeyExitProven:false};
}
