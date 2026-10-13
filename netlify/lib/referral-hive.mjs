import {randomUUID} from 'node:crypto';
import {ledger} from './referral-transport.mjs';

const API = 'https://api.hiveinspect.com/v1/';
const OVERLAP = 5 * 60_000;
const STATE_KEY = 'poll/v1';
const validId = value => typeof value === 'string' && /^[-a-zA-Z0-9]+$/.test(value);
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
class EvidenceError extends Error {}
class BudgetError extends Error {}

// A small per-run budget leaves room for other workers sharing Hive's 120/minute quota.
// Never retry 429 within the same invocation or include provider bodies/PII in errors.
export function createHiveReader({env = process.env, fetcher = fetch, now = Date.now, maxRequests = 24, deadline = now() + 25_000} = {}) {
  let requests = 0;
  return async path => {
    if (!env.HIVE_API_KEY) throw Error('Hive not configured');
    if (!/^(inspections|contacts)(\?|\/[-a-zA-Z0-9]+(?:\?|$)|$)/.test(path)) throw Error('Unsupported Hive read');
    if (++requests > maxRequests || now() + 9_000 >= deadline) throw new BudgetError('Hive verification budget exhausted');
    const response = await fetcher(API + path, {
      method: 'GET', headers: {Authorization: 'Bearer ' + env.HIVE_API_KEY},
      signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - now() - 8_000))), redirect: 'error'
    });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Hive rate limited' : 'Hive read failed');
      error.status = response.status;
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After');
        const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - now();
        error.retryAt = now() + Math.max(60_000, Number.isFinite(delay) ? delay : 0);
      }
      throw error;
    }
    return response.json();
  };
}

function pageData(page) {
  if (!page || !Array.isArray(page.data) || !(page.next_cursor === null || typeof page.next_cursor === 'string' && page.next_cursor.length) || !Number.isInteger(page.total) || page.total < 0) throw new EvidenceError('Incomplete Hive page');
  if (page.data.some(row => !validId(row?.id))) throw new EvidenceError('Invalid Hive page identity');
  return page;
}

async function allPages(readHive, resource, filters) {
  const rows = new Map(), cursors = new Set();
  let cursor = null, total = null;
  do {
    const query = new URLSearchParams({...filters, limit: '200'});
    if (cursor) query.set('cursor', cursor);
    const page = pageData(await readHive(resource + '?' + query));
    if (total !== null && total !== page.total) throw new EvidenceError('Hive history changed during verification');
    total = page.total;
    for (const row of page.data) {
      if (rows.has(row.id) && JSON.stringify(rows.get(row.id)) !== JSON.stringify(row)) throw new EvidenceError('Conflicting Hive history');
      rows.set(row.id, row);
    }
    cursor = page.next_cursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new EvidenceError('Hive pagination did not finish');
    cursors.add(cursor);
  } while (cursor);
  if (rows.size !== total) throw new EvidenceError('Incomplete Hive history');
  return [...rows.values()];
}

// Search every same-email Customer identity, not only the contact attached to this booking.
// Canceled/deleted earlier bookings conservatively require human review too.
export async function verifyNewClient(readHive, inspection, customer) {
  const address = email(customer.email);
  const read = readHive; let reads = 0;
  readHive = path => { if (++reads > 12) throw new EvidenceError('Large Customer history needs manual verification'); return read(path); };
  const contacts = await allPages(readHive, 'contacts', {email: address, role: 'Customer'});
  if (!contacts.length || !contacts.some(row => row.id === customer.id)) throw new EvidenceError('Customer identity not verified');
  if (contacts.some(row => email(row.email) !== address || !Array.isArray(row.roles) || !row.roles.includes('Customer'))) throw new EvidenceError('Ambiguous Customer identity');
  let seenCurrent = false, prior = false;
  for (const contact of contacts) {
    const history = await allPages(readHive, 'inspections', {contact_id: contact.id, include_canceled: 'true', include_deleted: 'true', sort: 'created_at'});
    for (const row of history) {
      if (!Array.isArray(row.contacts) || row.contacts.some(c => typeof c?.role !== 'string' || !validId(c.id))) throw new EvidenceError('Incomplete Customer history');
      const linked = row.contacts.filter(c => c.id === contact.id);
      if (!linked.length) throw new EvidenceError('Unrelated Customer history');
      if (!linked.some(c => c.role === 'Customer')) continue;
      if (!timestamp(row.created_at)) throw new EvidenceError('Missing history booking time');
      if (row.id === inspection.id) {
        if (row.created_at !== inspection.created_at) throw new EvidenceError('Booking changed during verification');
        seenCurrent = true;
      } else if (Date.parse(row.created_at) <= Date.parse(inspection.created_at)) prior = true;
    }
  }
  if (!seenCurrent) throw new EvidenceError('Current booking absent from Customer history');
  return !prior;
}

export function mapHiveInspection(detail, codes, serviceIds, previous) {
  if (!validId(detail?.id)) throw Error('Invalid inspection identity');
  const hold = (reason, attributionChanged = false) => ({hold: reason, attributionChanged});
  if (detail.deleted === true || detail.deleted_at || detail.status === 'canceled' || detail.canceled_at) return hold('Inspection canceled or deleted');
  if (detail.deleted !== false || detail.deleted_at !== null || detail.canceled_at !== null || !['draft', 'waiting', 'review', 'confirmed'].includes(detail.status)) return hold('Cancellation or deletion state unverified');
  if (!Array.isArray(detail.discount_codes) || detail.discount_codes.some(c => typeof c?.code !== 'string' || !c.code)) return hold('Applied discount codes unverified');
  const applied = [...new Set(detail.discount_codes.map(c => c.code))];
  const candidates = codes.filter(c => applied.includes(c.Code));
  if (applied.filter(value => /^INS25/.test(value)).length > 1) return hold('Multiple personal referral codes applied', !!previous);
  if (!candidates.length && !previous) return {skip: true};
  if (candidates.length !== 1 || candidates[0]['Hive State'] !== 'VERIFIED' || candidates[0]['Assignment State'] !== 'ASSIGNED' || Number(candidates[0]['Discount Amount']) !== 25 || !/^INS25[A-Z0-9]+$/.test(candidates[0].Code)) return hold('Referral code missing, ambiguous, or inactive', !!previous);
  const code = candidates[0];
  if (!Array.isArray(detail.contacts) || detail.contacts.some(c => typeof c?.role !== 'string')) return hold('Customer roles unverified');
  const customers = detail.contacts.filter(c => c.role === 'Customer');
  if (customers.length !== 1 || !validId(customers[0].id) || !validEmail(email(customers[0].email))) return hold('Customer attribution missing or ambiguous', !!previous);
  const customer = customers[0];
  if (previous && (previous.Code !== code.Code || previous['Client ID'] !== customer.id || email(previous['Referrer Email']) !== email(code['Referrer Email']))) return hold('Code, client, or owner changed', true);
  if (!validEmail(email(code['Referrer Email'])) || !timestamp(code['Assigned At'])) return hold('Code ownership unverified');
  if (email(customer.email) === email(code['Referrer Email'])) return hold('Self referral');
  if (!timestamp(detail.created_at) || Date.parse(detail.created_at) <= Date.parse(code['Assigned At'])) return hold('Code must be assigned before booking');
  if (!Array.isArray(detail.services) || detail.services.some(service => !validId(service?.id)) || !detail.services.some(service => serviceIds.has(service.id))) return hold('Full inspection service not verified');
  const price = detail.price;
  const paid = price?.paid === true && price.payment_status === 'paid' && typeof price.amount_paid === 'number' && Number.isFinite(price.amount_paid) && price.amount_paid > 0 && price.amount_due === 0;
  return {
    customer,
    inspection: {
      id: detail.id, codes: [code.Code], clientId: customer.id, clientEmail: email(customer.email),
      bookedAt: detail.created_at, fullInspection: true, canceled: false, paid,
      // Hive documents scheduled ends_at, not actual completed_at or dispute clearance.
      // A paid/published booking is NEVER sufficient to manufacture these facts.
      completed: null, completedAt: null, disputed: null,
      refunded: price?.payment_status === 'refunded' ? true : null
    }
  };
}

export function hiveRollout(env, context) {
  if (env.REFERRAL_HIVE_ENABLED !== 'true') return {paused: true, reason: 'disabled'};
  if (context !== 'production') return {paused: true, reason: 'non-production'};
  return null;
}

export async function runHiveReferrals({store, env = process.env, context = env.CONTEXT, readHive, callLedger = ledger, now = Date.now} = {}) {
  const paused = hiveRollout(env, context);
  if (paused) return paused;
  const serviceIds = new Set((env.REFERRAL_HIVE_SERVICE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
  if (!serviceIds.size || [...serviceIds].some(id => !validId(id)) || !timestamp(env.REFERRAL_HIVE_START_AFTER)) throw Error('Approved service IDs and explicit start timestamp required');
  const startAfter = Date.parse(env.REFERRAL_HIVE_START_AFTER);
  if (startAfter > now()) throw Error('Start timestamp is in the future');
  // Scheduled functions have a 30s ceiling; reserve time for durable writes.
  const deadline = now() + 25_000;
  const hive = readHive || createHiveReader({env, now, deadline});
  const writeLedger = (action, data = {}) => {
    const remaining = deadline - now() - 2_000;
    if (remaining < 1_000) throw new BudgetError('Poll deadline reached');
    return callLedger(action, data, env, Math.min(8_000, remaining));
  };
  const lockKey = 'lock/v1', owner = randomUUID();
  const oldLock = await store.getWithMetadata(lockKey, {type: 'json'});
  if (oldLock?.data.until > now()) return {busy: true};
  const lock = await store.setJSON(lockKey, {owner, until: now() + 120_000}, oldLock ? {onlyIfMatch: oldLock.etag} : {onlyIfNew: true});
  if (!lock.modified) return {busy: true};
  let state;
  try {
    state = await store.get(STATE_KEY, {type: 'json'}) || {since: startAfter, cycleStarted: now(), cursor: null, retryAfterId: null};
    if (state.notBefore > now()) return {rateLimited: true, retryAt: state.notBefore};
    const assertLease = () => { if (now() >= deadline) throw Error('Poll deadline reached; retry pending work'); };
    const save = async () => { assertLease(); await store.setJSON(STATE_KEY, state); };
    const snapshot = await writeLedger('codeSnapshot');
    if (!Array.isArray(snapshot?.codes) || !Array.isArray(snapshot?.uses)) throw Error('Incomplete code ledger');
    const result = {processed: 0, held: 0, skipped: 0, cycleComplete: false};
    async function processId(id) {
      assertLease();
      const previous = snapshot.uses.find(u => u['Hive Inspection ID'] === id);
      let detail;
      try { detail = await hive('inspections/' + id); }
      catch (error) {
        if (error.status !== 404) throw error;
        // Deleted detail can disappear. Re-fetch an authenticated tombstone before holding it.
        const deleted = pageData(await hive('inspections?' + new URLSearchParams({ids: id, include_canceled: 'true', include_deleted: 'true', limit: '200'})));
        if (deleted.next_cursor || deleted.data.length !== 1 || deleted.data[0].id !== id || deleted.data[0].deleted !== true) throw error;
        detail = deleted.data[0];
      }
      if (detail?.id !== id) throw Error('Inspection detail identity mismatch');
      const mapped = mapHiveInspection(detail, snapshot.codes, serviceIds, previous);
      if (mapped.skip) { result.skipped++; return; }
      if (mapped.hold) {
        // No guessed client/code is introduced. Existing uses are made ineligible immediately.
        if (previous) {
          assertLease();
          const held = await writeLedger('holdCodeUse', {inspectionId: id, reason: mapped.hold, attributionChanged: mapped.attributionChanged});
          if (held?.held !== true) throw Error('Ledger hold was not acknowledged');
        }
        // Record only opaque IDs/reasons for un-attributable bookings, never client email.
        await store.setJSON('holds/' + id, {inspectionId: id, reason: mapped.hold, at: now()});
        result.held++; return;
      }
      let historyHold = '';
      try { mapped.inspection.newClient = await verifyNewClient(hive, detail, mapped.customer); }
      catch (error) {
        if (!(error instanceof EvidenceError || error instanceof BudgetError)) throw error;
        // A verified attribution with incomplete eligibility is safe to save on hold.
        // It joins the round-robin retry queue rather than blocking all subsequent bookings.
        mapped.inspection.newClient = null;
        historyHold = error.message;
      }
      assertLease();
      const recorded = await writeLedger('recordCodeUse', {
        inspection: mapped.inspection,
        evidence: 'Hive REST v1: refreshed inspection and approved service ID; ' + (historyHold || 'complete same-email Customer history checked') + '; actual completion and refund/dispute clearance unverified.'
      });
      if (recorded?.matched !== true && recorded?.held !== true) throw Error('Ledger attribution was not acknowledged');
      await store.setJSON('holds/' + id, {inspectionId: id, reason: historyHold || 'Actual completion and refund/dispute clearance unverified', at: now()});
      result.processed++;
    }
    // Recheck every recorded use in round-robin order, including sent rewards, for later refunds.
    // The checkpoint moves only after a successful, acknowledged refresh.
    const retryIds = [...new Set(snapshot.uses.map(u => u['Hive Inspection ID']))].sort();
    if (retryIds.some(id => !validId(id))) throw Error('Invalid ledger inspection identity');
    const retryId = retryIds.find(id => !state.retryAfterId || id > state.retryAfterId) || retryIds[0];
    // Alternate retry and scan invocations so a large retry cannot starve the changed feed.
    if (retryId && state.retryNext) {
      // Consume only the phase before trying: failures must not starve the changed feed.
      // The per-inspection retry checkpoint still moves only after success.
      state.retryNext = false; await save();
      await processId(retryId); state.retryAfterId = retryId; await save();
      return result;
    }
    state.retryNext = true;
    if (!state.pending) {
      const query = new URLSearchParams({updated_since: new Date(state.since).toISOString(), include_canceled: 'true', include_deleted: 'true', sort: 'updated_at', limit: '5'});
      if (state.cursor) query.set('cursor', state.cursor);
      const page = pageData(await hive('inspections?' + query));
      if (page.next_cursor && page.next_cursor === state.cursor) throw Error('Hive polling cursor did not advance');
      const seen = new Set(state.seen || []);
      if (state.cursor && state.total !== page.total) {
        // Concurrent changes invalidated this snapshot. Restart the same window, never advance it.
        state.cursor = null; delete state.seen; delete state.total; await save();
        throw new EvidenceError('Hive poll changed during pagination; retry same window');
      }
      for (const row of page.data) seen.add(row.id);
      if (!page.next_cursor && seen.size !== page.total || page.next_cursor && !page.data.length) throw new EvidenceError('Incomplete Hive poll');
      state.seen = [...seen]; state.total = page.total;
      state.pending = [...new Set(page.data.map(row => row.id))];
      state.next = page.next_cursor;
      await save();
    }
    for (let count = 0; state.pending.length && count < 2; count++) {
      const id = state.pending[0];
      await processId(id);
      state.pending.shift();
      await save();
    }
    if (!state.pending.length) {
      state.cursor = state.next;
      delete state.pending; delete state.next;
      if (!state.cursor) {
        delete state.seen; delete state.total;
        state.since = Math.max(startAfter, state.cycleStarted - OVERLAP);
        state.cycleStarted = now();
        result.cycleComplete = true;
      }
      await save();
    }
    return result;
  } catch (error) {
    if (error.status === 429 && state) {
      // Read persisted state again: uncommitted in-memory progress must not become a checkpoint.
      const durable = await store.get(STATE_KEY, {type: 'json'}) || {since: startAfter, cycleStarted: now(), cursor: null};
      await store.setJSON(STATE_KEY, {...durable, notBefore: error.retryAt || now() + 60_000});
      return {rateLimited: true, retryAt: error.retryAt || now() + 60_000};
    }
    throw error;
  } finally {
    const held = await store.getWithMetadata(lockKey, {type: 'json'});
    if (held?.data.owner === owner) await store.setJSON(lockKey, {owner, until: 0}, {onlyIfMatch: held.etag});
  }
}
