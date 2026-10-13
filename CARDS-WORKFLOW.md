# Buying-agent thank-you cards — disabled draft

This adds a Netlify-native review coordinator to the existing InSites website.
It does not deploy, send email, call Cardly, purchase cards, create webhook
subscriptions, activate a Zap, or introduce OAuth. The existing site already
has Node >=22.12 and @netlify/blobs 11.1.4; no dependency changes are required.

**Do not merge/deploy this draft or remove `build.ignore = "exit 0"` without
explicit approval. Commits also carry `[skip netlify]`.** Preview and local
requests fail before opening storage. Production is OFF unless the separate
`HIVE_CARDS_ENABLED` flag is explicitly set. Card dispatch always throws, even
if other flags are changed. No card API credential is read by this code.

## Architecture and exact proposed endpoints

Use the existing Netlify project `chimerical-praline-beb612` and existing
`www.insites.services` domain. After a separately approved deployment:

- Hive destination: `https://www.insites.services/.netlify/functions/hive-card-webhook`
- Owner review API: `https://www.insites.services/.netlify/functions/cards-control`
- Restricted Zapier ledger bridge: `https://www.insites.services/.netlify/functions/cards-bridge`

These are proposed routes, NOT currently deployed or verified live endpoints.
No custom domain, separate server, database account or Google OAuth is needed.
The Python files from the earlier local prototype are not deployment dependencies.

Hive Inspection Complete -> raw HMAC verification -> private durable queue ->
verified buying-agent/agency snapshot -> complete per-agent history -> distinct
copy -> owner review -> approved immutable snapshot. Zapier reads pending ledger
projections through its restricted bridge and uses the existing Sheets connection.
Future Cardly transmission remains an independently reviewed final stage.

Store `insites-agent-cards`, key `state`, holds event IDs, business identities,
wording reservations, approval/audit and projection state in a SINGLE object.
Every mutation uses strong reads and conditional setJSON (`onlyIfNew` or
`onlyIfMatch`). The whole decision is retried on CAS conflict. This prevents
same-agent wording races without pretending that separate Blob keys or Sheets
lookup/append form a transaction. State has a conservative 1MB capacity hold;
never remove historical records to get past that hold. Partitioned storage or a
transactional database needs a later migration design before substantial scale.
No customer data or credentials belong in this public GitHub repository.

## Implemented versus remaining

Implemented: Netlify entrypoints; production/off gates; exact event/org allowlist;
raw-body timestamped Hive HMAC; durable-before-202 receipt; replay/conflict
protection; inspection+agent campaign dedupe; changed-agent hold; office address,
suppression and history holds; exact normalized text prevention and conservative
trigram near-match guard; three attempts then manual review; revisioned owner
approval bound to exact copy/snapshot/artwork; approval revocation on edits or
late history; private queue access; restricted Sheets projection/ack endpoint;
GET-only Hive contact/agency reader and fail-closed mapping resolver; pure Cardly
request/evidence adapters; synthetic tests. Owner/bridge tokens are distinct;
bridge cannot approve, import history, stage a job or order a card.

Additional implementation: a gated five-minute draft worker resolves contacts and
linked agencies using reviewed mapping; requires an owner office/suppression
attestation (expires after 30 days), reconciled history and exact stable IDs;
and produces at most three grounded template candidates before manual review.
A generic owner review page holds its bearer token only in memory and supports
exact-copy edits, prepare, and explicit approval. It does not display a Cardly
rendered proof; actual artwork review remains external and mandatory before use.
Authenticated API actions support office preview/verification, event retry,
history reconciliation and revisioned HOLD reevaluation. Recovery preserves
identity and snapshots and can return only to review, never approval or delivery.

Remaining: verified completion enum/payload paths; independently verified contact
GET response shape and exact mapping; initial identity/address/suppression/history
reconciliation; actual Zapier serialized Sheets upsert/readback wiring; approved
Cardly preview and cost binding; provider transport with one-way send reservation
and UNKNOWN recovery; provider status polling or verified event mapping.
The pure Sheets serializer emits 37 strings for RAW writes; bridge acknowledgement
requires exact headers and readback values plus current revision. No live Sheets
write/readback transport has been wired. This is not an end-to-end live workflow.

No scheduler exists in the account because this draft is undeployed. The worker
source declares a five-minute schedule but requires BOTH production context and
activation/worker flags before reading Hive or storage. Missing mapping fails
closed. Flags alone cannot complete the unfinished provider/mapping work.

## Configuration handoffs — no values created or copied

Future production Functions configuration, only after specific authorization:

- `HIVE_CARDS_ENABLED=false` initially. Enable only with workflow activation consent.
- `HIVE_CARD_ORGANIZATION_ID` and `HIVE_CARD_EVENT`: exact verified values, no guessed enum.
- `HIVE_CARD_WEBHOOK_SECRET`: generated by saving Hive automation, shown once.
- `HIVE_CARDS_OWNER_TOKEN_SHA256`: hash of owner-only 32+ character random bearer token.
- `HIVE_CARDS_BRIDGE_TOKEN_SHA256`: different token hash for Zapier projections/ack only.
- `HIVE_CARDS_WORKER_ENABLED=false` initially.
- `HIVE_CARDS_MAPPING_JSON`: reviewed paths plus verified/evidence markers; use explicit `$` for direct response roots. The agency GET is documented as a direct object; contact GET root remains unverified.
- Existing `HIVE_API_KEY` remains in existing Netlify Functions scope. Never copy it
  to Zapier. Only an explicitly activated worker may use the reader.

Secure user handoff must provision tokens; do not put them in URLs, Sheets,
GitHub, logs, examples or the website's publish directory. Consider stronger
owner identity/session auth for the eventual review UI. No secret was generated.

Hive form: Inspection Complete / Webhook, Active OFF, Run automatically OFF,
delay 0, payload Inspection + Buying Agent + Event Details, agreements signed
and payment complete. Services selection needs business-scope review before
activation (unfiltered form currently means all services). Save only after the
receiver is deployed with intake OFF and the user authorizes secret generation.
Do not run Hive's Test Webhook: it transmits selected real inspection data.

## Existing Zapier workflow and Sheets ledger

Reuse original card Zap 375332117 (formerly Spectora Report -> Ask for Card
Message). Keep its hard-stop Code step and Draft/OFF state throughout setup.
Do not touch calendar Zap 383074395, blog 281609214, or the separate contact-sync
workflow. Do not activate legacy Catch Raw Hook/email steps.

Sent Cards already exists in the same Master Agents/Brokerages workbook with
37 headers and zero records. Agents/Brokerages remain unchanged; the original
Agents tab has no header row. Sync audit PR #11 is independent and must not edit
Sent Cards. This card branch starts from main and does not modify #11's branch,
code, private audit store or run flags. Both drafts add the same build-ignore
guard: retain one guard when eventually reconciling approved branches.

Proposed Zap after approval: restricted bridge POST `{"action":"projections"}`
with bridge bearer token; serialize all writes to Sent Cards; locate by record_id,
hold duplicate IDs, write values as literal strings/RAW, read back record_id plus
all expected values and revision in evidence_reference; then POST
`{"action":"ack","jobId":"...","revision":1,"headers":["..."],"readback":["..."]}`. A failed/ambiguous write must
look up the same record_id before retrying. Don't append blindly or acknowledge
before readback. The bridge is delivery projection only, not a concurrency lock.
Do not let an ordinary edited Sheet cell grant approval. All changes to copy go
back through the owner endpoint and invalidate prior approval.

`sheetProjection` returns named fields plus revision for safe mapping. No order,
mailing, delivery timestamp, sent text or cost is inferred from a draft/approval.
Exact original text is retained alongside normalized SHA256. Unicode NFKC,
lowercase, punctuation/spacing collapse plus selected casefold equivalences
provide deterministic exact prevention. Near-match uses trigram Dice >=0.82;
this conservative heuristic does not establish semantic originality. Include
all reconciled historical wording, draft reservations and final edited copy.

## Cardly verified contract (read-only documentation, no API calls)

Sources checked: https://api.card.ly/v2/docs and linked
https://api.card.ly/openapi/en-AU/2.2.0/json (link observed; specification not fetched).

- Base API `https://api.card.ly/v2`; `API-Key` header, `text/json` request type.
  Direct API keys are created in business portal Settings > API Keys; test keys
  begin `test_`, live keys `live_`. Test responses include `testMode:true`.
  This does not establish the auth mechanism behind Zapier's Connect screen.
- `POST /orders/place`: `lines[]` contains artwork, template, quantity, recipient,
  optional messages.pages (page, text, style), shippingMethod and shipToMe;
  top-level purchaseOrderNumber links the order to the coordinator.
- `Idempotency-Key` POST header: max64 chars; replays return same result and changed
  payload under the same key is rejected. Use the 64-character job hash; external
  order number is separate. Do NOT assume Zapier External Order Number alone
  gives this server-side idempotency. Verify Zapier native action behavior before
  enabling; if it cannot enforce it, use an approved authenticated API request
  within Zapier that preserves the exact frozen request + header. No credential
  migration or direct Netlify Cardly connection is authorized.
- Generate Preview is separate from Place Order. Template/page/font/bleed mapping
  and cost must be bound into the actual user-approved preview before sending.
- Place response `data.order.id` identifies the order. `paid` is not mailed.
  An authenticated Retrieve Order result must match stored order ID and external
  number, single card quantity1, and item `timings.shipped` before marking SENT.
  `delivery.dispatch` is an estimate, not proof. Ignore test-mode response times.
  No DELIVERED state inferred without carrier delivery evidence.
- Current webhook docs list `contact.order.sent` for automated contact sends;
  applicability to direct one-off orders is unverified. Prefer verified order
  reads until established. The page describes conflicting signature inputs
  (raw body/header versus JSON data/body), so no webhook verifier is guessed here.
  No provider webhook registration is created.

## Synthetic checks and deployment boundary

Run `node --test tests/cards.test.mjs` (37 synthetic Node tests). Tests use an in-memory CAS store,
synthetic keys/IDs/addresses and injected HTTP mocks. They exercise concurrent
receipt/draft collisions, wrong signatures/organization, failure before ack,
copy exhaustion, approval edits, incomplete history, permissions, provider test
responses and truthful mailing status. No external action tests occur.

A separately approved deployment must first verify the real Blobs adapter and
Netlify function packaging in a safe environment, response timing under10sec,
private access, backup/retention, mapping fixtures, card previews and spending
limits. No merges, deploys, env writes, subscriptions, orders or activation are
part of this draft. User must approve artwork first and each final card thereafter.

## Revision review and precise current state

Changed buying agent holds both old and new jobs. Changed snapshots, office or
suppression revoke approvals and increment revisions even on duplicate-stage
paths. Exact self-history is ignored only when record ID resolves to the same
agent's actual job and text exactly equals one of its recorded versions. True
collisions still hold. Projection reports held/untested copy truthfully and
preserves the original automation instance ID separately from internal hashes.
Equal owner and bridge token hashes are rejected before store access.

Cardly connection consent was granted, and the Zapier OAuth screen reached
Cardly's username/password login on 2026-10-13. No credentials entered; login
requires user handoff. Do not share the OAuth state URL as a portable iOS link.
An iPhone can independently open Zapier App Connections, create Cardly connection
and complete Cardly login. Account linkage must then be verified read-only.
The earlier Hive form was UNSAVED and its tab closed; no persistent automation
was created. The preparation screenshot is evidence of a proposal only.

37 Node tests validate this draft using synthetic in-memory CAS and fixture reads.
The earlier Python scaffold separately passed 51 tests; those do not validate
this implementation. No real SDK/Blobs concurrent-write or ambiguous-write
integration test has run. Required before activation: authorized nonsending
SDK integration test, deployment packaging test, real mapping fixture checks,
browser validation of the owner page, and serialized Sheets round-trip test.
The local card-proof file browser preview was policy-denied for file protocol;
no alternate browser/localhost workaround was attempted.

Owner review preparation uses a monotonic generation guard. Input/load changes invalidate pending preparations; out-of-order responses are discarded, failed current requests invalidate state, and approval rechecks current exact text/artwork/job revision. Regression tests cover these races.
