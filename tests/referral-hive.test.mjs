import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHiveReader, mapHiveInspection, runHiveReferrals, verifyNewClient} from '../netlify/lib/referral-hive.mjs';
import handler from '../netlify/functions/referral-hive.mjs';

const NOW = Date.parse('2026-10-13T00:00:00Z');
const code = {Code: 'INS25ABCDEFG', 'Discount Amount': '25', 'Hive State': 'VERIFIED', 'Assignment State': 'ASSIGNED', 'Referrer Email': 'owner@example.com', 'Assigned At': '2026-10-01T00:00:00Z'};
const base = {
  id: 'inspection-one', status: 'confirmed', confirmed: true, deleted: false, deleted_at: null, canceled_at: null,
  created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', ends_at: '2026-10-03T15:00:00Z',
  discount_codes: [{code: code.Code}], services: [{id: 'full-home', name: 'Any name'}],
  contacts: [{id: 'client-one', role: 'Customer', email: 'Friend@example.com'}],
  price: {paid: true, payment_status: 'paid', amount_paid: 400, amount_due: 0},
  reports: {status: 'published'}, agreements: {all_signed: true}
};
const env = {REFERRAL_HIVE_ENABLED: 'true', REFERRAL_HIVE_SERVICE_IDS: 'full-home', REFERRAL_HIVE_START_AFTER: '2026-10-01T00:00:00Z', CONTEXT: 'production'};
const page = (data, next_cursor = null, total = data.length) => ({data, next_cursor, total});
function memory() {
  const rows = new Map(); let serial = 0;
  return {
    rows, async get(k) { return structuredClone(rows.get(k)?.data ?? null); },
    async getWithMetadata(k) { return structuredClone(rows.get(k) ?? null); },
    async setJSON(k, data, options = {}) {
      const old = rows.get(k);
      if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag !== options.onlyIfMatch) return {modified: false};
      rows.set(k, {data: structuredClone(data), etag: String(++serial)}); return {modified: true};
    }
  };
}
function ledgerHarness() {
  const tables = {Codes: [structuredClone(code)], Shares: [], Alerts: [], CodeUses: []};
  const ctx = vm.createContext({Date, Number, String, Error, Array, JSON});
  vm.runInContext(fs.readFileSync(new URL('../operations/Code.gs', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../operations/CodeSharing.gs', import.meta.url), 'utf8'), ctx);
  ctx.records = name => structuredClone(tables[name]);
  ctx.writeRecord = (name, row, key) => {
    const index = tables[name].findIndex(item => item[key] === row[key]);
    if (index < 0) tables[name].push(structuredClone(row)); else tables[name][index] = structuredClone(row);
  };
  const calls = [];
  return {tables, calls, async call(action, data) { calls.push(action); return ctx.dispatch(action, data); }};
}
function reader(detail = base) {
  const calls = [];
  const read = async path => {
    calls.push(path);
    if (path === 'inspections/' + detail.id) return structuredClone(detail);
    const url = new URL(path, 'https://example.invalid/');
    if (url.pathname === '/contacts') return page([{id: 'client-one', email: 'friend@example.com', roles: ['Customer']}]);
    if (url.searchParams.has('contact_id')) return page([detail]);
    return page([detail]);
  };
  return {calls, read};
}
const mapped = (detail = base, codes = [code], previous) => mapHiveInspection(detail, codes, new Set(['full-home']), previous);
const options = h => ({store: memory(), callLedger: h.call, env, readHive: reader().read, now: () => NOW});

test('missing completion, dispute, and refund clearance remain unknown despite published paid report', () => {
  const result = mapped().inspection;
  assert.equal(result.completed, null); assert.equal(result.completedAt, null);
  assert.equal(result.disputed, null); assert.equal(result.refunded, null); assert.equal(result.paid, true);
});
test('service verification uses explicit IDs, never service names or add-ons', () => {
  assert.match(mapped({...base, services: [{id: 'radon', name: 'Full Home Inspection'}], add_ons: [{id: 'full-home'}]}).hold, /service/);
  assert.ok(mapped({...base, services: []}).hold);
});
test('ambiguous, inactive, duplicate ledger codes and missing applied codes hold', () => {
  const other = {...code, Code: 'INS25HIJKLMN'};
  assert.ok(mapped({...base, discount_codes: [{code: code.Code}, {code: other.Code}]}, [code, other]).hold);
  assert.ok(mapped(base, [code, code]).hold);
  assert.ok(mapped(base, [{...code, 'Hive State': 'PENDING CREATION'}]).hold);
  assert.ok(mapped({...base, discount_codes: [{code: null}]}).hold);
  assert.deepEqual(mapped({...base, discount_codes: []}), {skip: true});
  assert.equal(mapped({...base, discount_codes: [{code: code.Code}, {code: code.Code}]}).inspection.codes.length, 1);
});
test('missing or multiple Customers, self referrals, assignment gaps, cancellations and deletions hold', () => {
  for (const detail of [
    {...base, contacts: []}, {...base, contacts: [...base.contacts, {...base.contacts[0], id: 'client-two'}]},
    {...base, contacts: [{...base.contacts[0], email: ' OWNER@example.com '}]},
    {...base, canceled_at: '2026-10-12T00:00:00Z'}, {...base, deleted: true}, {...base, deleted: undefined},
    {...base, canceled_at: undefined}, {...base, created_at: null}
  ]) assert.ok(mapped(detail).hold);
  assert.ok(mapped(base, [{...code, 'Assigned At': ''}]).hold);
});
test('changed code/client/owner attribution is rejected', () => {
  for (const previous of [
    {Code: 'OTHER', 'Client ID': 'client-one', 'Referrer Email': code['Referrer Email']},
    {Code: code.Code, 'Client ID': 'client-other', 'Referrer Email': code['Referrer Email']},
    {Code: code.Code, 'Client ID': 'client-one', 'Referrer Email': 'other@example.com'}
  ]) assert.equal(mapped(base, [code], previous).attributionChanged, true);
});
test('refund and partial payment never appear fully paid', () => {
  assert.equal(mapped({...base, price: {...base.price, payment_status: 'refunded'}}).inspection.refunded, true);
  for (const price of [{}, {...base.price, amount_due: 1}, {...base.price, paid: false}, {...base.price, payment_status: 'partial'}]) assert.equal(mapped({...base, price}).inspection.paid, false);
});
test('same-email duplicate identities and all history pages are checked before newClient=true', async () => {
  const requests = [];
  const read = async path => {
    requests.push(path); const url = new URL(path, 'https://example.invalid/'), q = url.searchParams;
    if (url.pathname === '/contacts') return q.has('cursor') ? page([{id: 'client-two', email: 'FRIEND@example.com', roles: ['Customer']}], null, 2) : page([{id: 'client-one', email: 'friend@example.com', roles: ['Customer']}], 'contacts-next', 2);
    if (q.get('contact_id') === 'client-one') return page([base]);
    return q.has('cursor') ? page([{...base, id: 'old', created_at: '2026-09-01T00:00:00Z', contacts: [{...base.contacts[0], id: 'client-two'}]}], null, 2) : page([{...base, id: 'agent-only', contacts: [{...base.contacts[0], id: 'client-two', role: 'Buyer Agent'}]}], 'history-next', 2);
  };
  assert.equal(await verifyNewClient(read, base, base.contacts[0]), false);
  assert.equal(requests.length, 5);
  assert.ok(requests.filter(x => x.startsWith('inspections')).every(x => x.includes('include_canceled=true') && x.includes('include_deleted=true')));
});
test('history failures, missing cursor/total, cursor loops and missing current booking never verify new clients', async () => {
  const r = reader();
  await assert.rejects(verifyNewClient(async p => p.startsWith('contacts') ? r.read(p) : Promise.reject(Error('network')), base, base.contacts[0]));
  for (const bad of [{data: []}, page([], null, 1), page([{id: 'client-one', email: 'wrong@example.com', roles: ['Customer']}])]) {
    await assert.rejects(verifyNewClient(async () => bad, base, base.contacts[0]));
  }
  await assert.rejects(verifyNewClient(async () => page([{id: 'client-one', email: 'friend@example.com', roles: ['Customer']}], 'loop', 1), base, base.contacts[0]), /pagination/);
  await assert.rejects(verifyNewClient(async p => p.startsWith('contacts') ? r.read(p) : page([]), base, base.contacts[0]), /absent/);
});
test('future booking does not disqualify first client, but equal/earlier booking does', async () => {
  for (const [date, expected] of [['2026-10-03T00:00:00Z', true], ['2026-10-02T00:00:00Z', false], ['2026-09-01T00:00:00Z', false]]) {
    const r = reader();
    const read = p => p.startsWith('contacts') ? r.read(p) : page([base, {...base, id: 'other', created_at: date}]);
    assert.equal(await verifyNewClient(read, base, base.contacts[0]), expected);
  }
});
test('disabled and preview runs never read credentials, store, Hive, or production ledger', async () => {
  const trap = () => { throw Error('must not access'); };
  for (const settings of [{...env, REFERRAL_HIVE_ENABLED: 'false'}, {...env, CONTEXT: 'deploy-preview'}, {...env, CONTEXT: undefined}]) {
    assert.equal((await runHiveReferrals({env: settings, store: new Proxy({}, {get: trap}), readHive: trap, callLedger: trap})).paused, true);
  }
  const prior = process.env.REFERRAL_HIVE_ENABLED;
  process.env.REFERRAL_HIVE_ENABLED = 'true';
  try { assert.equal((await (await handler(null, {deploy: {context: 'deploy-preview'}})).json()).paused, true); }
  finally { if (prior === undefined) delete process.env.REFERRAL_HIVE_ENABLED; else process.env.REFERRAL_HIVE_ENABLED = prior; }
});
test('rollout requires explicit start and service IDs before any provider or store read', async () => {
  for (const settings of [{...env, REFERRAL_HIVE_SERVICE_IDS: ''}, {...env, REFERRAL_HIVE_START_AFTER: ''}]) await assert.rejects(runHiveReferrals({env: settings}), /required/);
});
test('duplicates import exactly one ledger use, keep reward held, and never reserve or send', async () => {
  const h = ledgerHarness(), opts = options(h);
  await runHiveReferrals(opts); await runHiveReferrals(opts);
  assert.equal(h.tables.CodeUses.length, 1);
  const use = h.tables.CodeUses[0];
  assert.equal(use['Completed At'], ''); assert.equal(use['Dispute Or Refund'], 'UNKNOWN');
  assert.equal(use['Reward Due At'], ''); assert.ok(use['Hold Reason']);
  assert.equal(use['New Client Verified'], 'YES');
  assert.ok(h.calls.every(action => ['codeSnapshot', 'recordCodeUse', 'holdCodeUse'].includes(action)));
  assert.ok(!JSON.stringify([...opts.store.rows]).includes('friend@example.com'));
});
test('pending uses refresh even when no changed inspections are returned', async () => {
  const h = ledgerHarness(), opts = options(h); await runHiveReferrals(opts);
  const r = reader({...base, price: {...base.price, payment_status: 'refunded'}});
  opts.readHive = p => p.includes('updated_since') ? page([]) : r.read(p);
  await runHiveReferrals(opts);
  assert.ok(r.calls.some(p => p === 'inspections/inspection-one'));
  assert.equal(h.tables.CodeUses[0]['Dispute Or Refund'], 'YES'); assert.equal(h.tables.CodeUses[0]['Paid At'], '');
});
test('removed codes and canceled/deleted inspections hold existing uses; attribution changes stay sticky', async () => {
  for (const detail of [{...base, discount_codes: []}, {...base, status: 'canceled'}, {...base, deleted: true}]) {
    const h = ledgerHarness(), opts = options(h); await runHiveReferrals(opts);
    opts.readHive = reader(detail).read; await runHiveReferrals(opts);
    assert.ok(h.tables.CodeUses[0]['Hold Reason']); assert.equal(h.tables.CodeUses[0]['Reward Due At'], '');
    if (!detail.discount_codes.length) {
      assert.match(h.tables.CodeUses[0]['Hold Reason'], /Attribution changed/);
      opts.readHive = reader().read; await runHiveReferrals(opts);
      assert.match(h.tables.CodeUses[0]['Hold Reason'], /Attribution changed/);
    }
  }
});
test('404 requires an authenticated deletion tombstone and never guesses a deleted inspection', async () => {
  const h = ledgerHarness(), opts = options(h); await runHiveReferrals(opts);
  opts.readHive = p => {
    if (p === 'inspections/inspection-one') throw Object.assign(Error('missing'), {status: 404});
    return page([{id: base.id, deleted: true}]);
  };
  await runHiveReferrals(opts); assert.match(h.tables.CodeUses[0]['Hold Reason'], /deleted/);
  opts.readHive = p => { if (p === 'inspections/inspection-one') throw Object.assign(Error('missing'), {status: 404}); return page([]); };
  await runHiveReferrals(opts); // scan phase finds no changes
  await assert.rejects(runHiveReferrals(opts), /missing/);
});
test('Hive history failure preserves pending inspection and checkpoint for retry', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader();
  opts.readHive = p => p.startsWith('contacts') ? Promise.reject(Error('history failed')) : r.read(p);
  await assert.rejects(runHiveReferrals(opts), /history failed/);
  const state = await opts.store.get('poll/v1');
  assert.deepEqual(state.pending, [base.id]); assert.equal(state.since, Date.parse(env.REFERRAL_HIVE_START_AFTER));
  assert.equal(h.tables.CodeUses.length, 0);
  opts.readHive = r.read; await runHiveReferrals(opts); assert.equal(h.tables.CodeUses.length, 1);
});
test('ambiguous ledger timeout or checkpoint write failure safely replays idempotent use', async () => {
  for (const kind of ['ledger', 'checkpoint']) {
    const h = ledgerHarness(), opts = options(h); let fail = true;
    if (kind === 'ledger') opts.callLedger = async (action, data) => {
      const result = await h.call(action, data);
      if (action === 'recordCodeUse' && fail) { fail = false; throw Error('timeout after write'); } return result;
    };
    else {
      const save = opts.store.setJSON.bind(opts.store);
      opts.store.setJSON = async (key, value, settings) => {
        if (key === 'poll/v1' && value.pending?.length === 0 && fail) { fail = false; throw Error('checkpoint failed'); }
        return save(key, value, settings);
      };
    }
    await assert.rejects(runHiveReferrals(opts));
    assert.deepEqual((await opts.store.get('poll/v1')).pending, [base.id]);
    await runHiveReferrals(opts); assert.equal(h.tables.CodeUses.length, 1);
  }
});
test('completed scan overlaps its start time and continues durable next-page cursor', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader();
  const paths = [];
  opts.readHive = p => {
    paths.push(p);
    if (p.includes('updated_since')) return p.includes('cursor=next-page') ? page([], null, 1) : page([base], 'next-page', 1);
    return r.read(p);
  };
  await runHiveReferrals(opts); assert.equal((await opts.store.get('poll/v1')).cursor, 'next-page');
  await runHiveReferrals(opts); // retry phase
  await runHiveReferrals(opts); const state = await opts.store.get('poll/v1');
  assert.equal(state.cursor, null); assert.equal(state.since, NOW - 5 * 60_000);
  assert.ok(paths.some(p => p.includes('cursor=next-page')));
});
test('429 persists Retry-After without skipping pending work and next run waits', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader(); let hits = 0;
  opts.readHive = p => { hits++; if (p.startsWith('contacts')) throw Object.assign(Error('rate'), {status: 429, retryAt: NOW + 90_000}); return r.read(p); };
  assert.equal((await runHiveReferrals(opts)).rateLimited, true);
  const state = await opts.store.get('poll/v1'); assert.deepEqual(state.pending, [base.id]);
  const previousHits = hits;
  assert.equal((await runHiveReferrals(opts)).rateLimited, true); assert.equal(hits, previousHits);
  opts.now = () => NOW + 100_000; opts.readHive = r.read;
  await runHiveReferrals(opts); assert.equal(h.tables.CodeUses.length, 1);
});
test('reader is GET-only, rejects redirects, budgets calls, and reads Retry-After safely', async () => {
  const calls = [], read = createHiveReader({env: {HIVE_API_KEY: 'fake-fixture-only'}, now: () => NOW, maxRequests: 1, fetcher: async (url, opts) => { calls.push({url, opts}); return Response.json({}); }});
  await read('inspections/one'); assert.equal(calls[0].opts.method, 'GET'); assert.equal(calls[0].opts.redirect, 'error');
  await assert.rejects(read('inspections/two'), /budget/);
  const rate = createHiveReader({env: {HIVE_API_KEY: 'fake-fixture-only'}, now: () => NOW, fetcher: async () => new Response('', {status: 429, headers: {'Retry-After': '180'}})});
  await assert.rejects(rate('inspections'), error => error.status === 429 && error.retryAt === NOW + 180_000);
});
test('concurrent poll lease prevents duplicate provider and ledger work', async () => {
  const store = memory(); await store.setJSON('lock/v1', {owner: 'other', until: NOW + 100_000});
  const trap = () => { throw Error('unexpected read'); };
  assert.equal((await runHiveReferrals({store, env, now: () => NOW, callLedger: trap, readHive: trap})).busy, true);
});

test('incomplete terminal polling page cannot advance watermark', async () => {
  const h = ledgerHarness(), opts = options(h);
  opts.readHive = async () => page([], null, 10);
  await assert.rejects(runHiveReferrals(opts), /Incomplete Hive poll/);
  assert.equal(await opts.store.get('poll/v1'), null);
});
test('changing page totals restart the same window without watermark progress', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader();
  opts.readHive = p => p.includes('updated_since') ? page([base], 'next', 2) : r.read(p);
  await runHiveReferrals(opts); await runHiveReferrals(opts);
  opts.readHive = p => p.includes('updated_since') ? page([], null, 3) : r.read(p);
  await assert.rejects(runHiveReferrals(opts), /changed during pagination/);
  const state = await opts.store.get('poll/v1');
  assert.equal(state.cursor, null); assert.equal(state.since, Date.parse(env.REFERRAL_HIVE_START_AFTER));
});
test('permanently unverifiable history is held and does not starve changed inspection scanning', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader();
  opts.readHive = p => p.includes('contact_id=') ? page([]) : r.read(p);
  await runHiveReferrals(opts);
  assert.equal(h.tables.CodeUses[0]['New Client Verified'], 'UNKNOWN');
  assert.ok(h.tables.CodeUses[0]['Hold Reason']);
  await runHiveReferrals(opts); // held use retry
  const second = {...base, id: 'inspection-two'};
  opts.readHive = p => p.includes('updated_since') ? page([second]) : p === 'inspections/inspection-two' ? second : p.includes('contact_id=') ? page([]) : r.read(p);
  await runHiveReferrals(opts);
  assert.equal(h.tables.CodeUses.length, 2);
  assert.ok(h.tables.CodeUses.every(row => !row['Reward Due At']));
});
test('reader reserves checkpoint time and passes bounded timeout to the ledger', async () => {
  let time = NOW;
  const read = createHiveReader({env: {HIVE_API_KEY: 'fake-fixture-only'}, now: () => time, deadline: NOW + 25_000, fetcher: async () => { time += 17_000; return Response.json({}); }});
  await read('inspections/one'); await assert.rejects(read('inspections/two'), /budget/);
  const h = ledgerHarness(), opts = options(h), timeouts = [];
  opts.callLedger = (action, data, suppliedEnv, timeout) => { timeouts.push(timeout); return h.call(action, data); };
  await runHiveReferrals(opts);
  assert.ok(timeouts.every(timeout => timeout > 0 && timeout <= 8_000));
});
test('unknown second personal code is ambiguous even when only one code is registered', () => {
  assert.ok(mapped({...base, discount_codes: [{code: code.Code}, {code: 'INS25UNTRACKED'}]}).hold);
});

test('failed existing-use retry still permits the next changed-feed scan without advancing retry checkpoint', async () => {
  const h = ledgerHarness(), opts = options(h), r = reader(); await runHiveReferrals(opts);
  const second = {...base, id: 'inspection-two'};
  opts.readHive = p => {
    if (p === 'inspections/inspection-one') throw Object.assign(Error('missing'), {status: 404});
    if (p.includes('ids=inspection-one')) return page([]);
    if (p.includes('updated_since')) return page([second]);
    if (p === 'inspections/inspection-two') return second;
    if (p.includes('contact_id=')) return page([second]);
    return r.read(p);
  };
  await assert.rejects(runHiveReferrals(opts), /missing/);
  const state = await opts.store.get('poll/v1');
  assert.equal(state.retryNext, false); assert.equal(state.retryAfterId, null);
  await runHiveReferrals(opts);
  assert.equal(h.tables.CodeUses.length, 2);
});
