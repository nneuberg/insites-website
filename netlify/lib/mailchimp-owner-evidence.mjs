export function summarizeOwnerEvidence(snapshot){
 const allowed=new Set([1,2,3].map(n=>'owner9531-20261028-'+n));
 const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
 return {complete:snapshot.complete===true,activityTypes:[...new Set(snapshot.activity.map(a=>a.activity_type).filter(v=>typeof v==='string'&&/^[a-z_-]{1,32}$/i.test(v)))],observedAt:new Date(snapshot.observedAt).toISOString(),events:snapshot.events.filter(e=>e.name==='insites_claim_test_20261028'&&allowed.has(e.properties?.invitation_id)).map(e=>({invitationId:e.properties.invitation_id,occurredAt:iso(e.occurred_at),rewardBinding:e.properties.reward_id==='inert-'+e.properties.invitation_id,linkBinding:e.properties.claim_url==='https://example.com/#'+e.properties.invitation_id})),sent:snapshot.activity.filter(a=>a.activity_type==='sent'&&a.campaign_id==='4722278d00').map(a=>({campaignId:'4722278d00',sentAt:iso(a.created_at_timestamp)})),deliveryProvenByThisRead:false};
}
