import {createHash} from 'node:crypto';

// Preparation only. This module has no scheduler, credentials, network access,
// activation flag, member creation, tags, email, or unsubscribe operations.
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const address = value => /^\S+@\S+\.\S+$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hold = (reason, inspectionId=null) => ({status:'held', reason, inspectionId});

function validateCatalog(catalog) {
  if (catalog?.verified !== true || !id(catalog.version) ||
      !Array.isArray(catalog.serviceIds) || !Array.isArray(catalog.addOnIds) ||
      !catalog.serviceIds.length && !catalog.addOnIds.length ||
      [...catalog.serviceIds,...catalog.addOnIds].some(value => !id(value))) {
    throw Error('Verified photography service and add-on IDs required');
  }
}

// Positive source evidence only. An excluded/held order is not evidence that a
// person has never used photography. A whole-account contact role is not used.
export function assessPhotoBooking(order, {catalog, attributionPolicy, sourceObservedAt, now=Date.now(), maxAgeMs=86400000}={}) {
  validateCatalog(catalog);
  if (attributionPolicy !== 'unique-listing-agent') return hold('Attribution policy not configured');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || !Number.isSafeInteger(sourceObservedAt) || sourceObservedAt > now || now-sourceObservedAt > maxAgeMs) return hold('Source stale or unverified');
  if (!id(order?.id)) return hold('Inspection identity unavailable');
  if (order.deleted === true || order.status === 'canceled' || typeof order.canceled_at === 'string') return {status:'excluded',reason:'Inactive inspection',inspectionId:order.id};
  if (order.status !== 'confirmed' || order.confirmed !== true || order.deleted !== false || order.canceled_at !== null) return hold('Confirmed active booking not verified',order.id);
  const revision = Date.parse(order.updated_at);
  if (!Number.isFinite(revision) || revision > sourceObservedAt || !Array.isArray(order.services) || !Array.isArray(order.add_ons)) return hold('Complete service source required',order.id);
  if (order.services.some(s=>!id(s?.id)) || order.add_ons.some(s=>!id(s?.id) || typeof s.quantity !== 'number' || !Number.isFinite(s.quantity) || s.quantity < 0)) return hold('Service or add-on schema uncertain',order.id);
  const matchedServices = [...new Set(order.services.filter(s=>catalog.serviceIds.includes(s.id)).map(s=>s.id))].sort();
  const matchedAddOns = [...new Set(order.add_ons.filter(s=>s.quantity > 0 && catalog.addOnIds.includes(s.id)).map(s=>s.id))].sort();
  if (!matchedServices.length && !matchedAddOns.length) return {status:'excluded',reason:'No configured photography item on this order',inspectionId:order.id};
  if (!Array.isArray(order.contacts) || order.contacts.some(c=>!id(c?.id) || typeof c.role !== 'string')) return hold('Contact source incomplete',order.id);
  const listing = order.contacts.filter(c=>['Listing Agent','Seller Agent'].includes(c.role));
  if (listing.length !== 1 || !address(email(listing[0]?.email))) return hold('Exactly one identified listing agent required',order.id);
  // Different contact IDs sharing the address are not silently merged.
  const selected = listing[0], normalized = email(selected.email);
  if (order.contacts.some(c=>c.id !== selected.id && email(c.email) === normalized)) return hold('Shared or ambiguous contact email',order.id);
  const evidence = {inspectionId:order.id,revision:order.updated_at,contactId:selected.id,email:normalized,role:selected.role,serviceIds:matchedServices,addOnIds:matchedAddOns,catalogVersion:catalog.version,sourceObservedAt};
  return {status:'positive',kind:'confirmed-photography-booking',...evidence,evidenceHash:digest(evidence)};
}

// Plans additions only. No absence-based removals and no historical enrollment.
// Unknown membership remains unknown. A separate cancellation/history policy is
// required before enabling an automated writer or implementing removals.
export function photoGroupAdditionPlan(evidence, member, {audienceId, interestId}={}) {
  if (evidence?.status !== 'positive' || !id(audienceId) || !id(interestId) || !address(email(evidence.email))) return {action:'hold',reason:'Configured positive evidence required'};
  if (!member) return {action:'hold',reason:'Existing member required; no subscriber creation'};
  const hash=createHash('md5').update(evidence.email).digest('hex');
  if (member.id !== hash || member.list_id !== audienceId || email(member.email_address) !== evidence.email) return {action:'hold',reason:'Mailchimp identity mismatch'};
  if (member.status !== 'subscribed') return {action:'hold',reason:'Subscription state preserved'};
  if (typeof member.interests?.[interestId] !== 'boolean') return {action:'hold',reason:'Group schema not verified'};
  if (member.interests[interestId]) return {action:'unchanged'};
  const binding={audienceId,memberId:hash,email:evidence.email,interestId};
  return {action:'add',binding,evidenceHash:evidence.evidenceHash,method:'PATCH',path:`/lists/${audienceId}/members/${hash}`,body:{interests:{[interestId]:true}}};
}

// Readback verifies the only property this candidate owns. It deliberately does
// not retry a write: caller must reconcile an uncertain request before retrying.
export function verifyPhotoGroupReadback(plan, member) {
  if (plan?.action !== 'add' || !member) return false;
  const b=plan.binding;
  return member.id === b.memberId && member.list_id === b.audienceId && email(member.email_address) === b.email && member.interests?.[b.interestId] === true;
}
