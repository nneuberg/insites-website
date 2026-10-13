# Private Hive contact audit (disabled draft)

This scheduled function reads all Hive contacts and agencies into private Netlify
Blobs in the existing project. It does not write to Hive, Sheets or Mailchimp and
has no public production endpoint. Existing review/tag functions are untouched.

The draft adds `build.ignore = "exit 0"` to prevent automatic Netlify deployments.
Do not merge or remove this guard without explicit deployment approval. Every draft
commit also uses `[skip netlify]`. No credentials are included or newly created.

## Approved activation only

1. Review this draft and run `node --test tests/hive-contact-audit.test.mjs` (14 tests).
2. Obtain approval to deploy this read-only function and store the private snapshot
   in the same Netlify project. Remove the draft build-ignore guard only then.
3. Keep existing `HIVE_API_KEY` in production Functions scope; never reveal/copy it.
4. Add nonsecret production Functions variables `HIVE_CONTACT_AUDIT_ENABLED=true`
   and a unique `HIVE_CONTACT_AUDIT_RUN_ID` matching `[A-Za-z0-9_-]{8,64}`.
5. The minute schedule reads one page per invocation. With 2710 contacts and 170
   agencies, two passes take approximately 30 invocations. Functions > Run now is
   also available to the signed-in Netlify project operator. Preview runs are gated.
6. Inspect counts/status only in function logs. Download private Blob
   `insites-hive-contact-audit/runs/<run-id>` through the project dashboard.
   The Blob includes both snapshots and a SHA-256 manifest; never publish it.
7. `complete` means both sequential passes have identical content and each passed
   unique-ID/total/cursor checks. This is not an atomic database snapshot. Re-read
   records before any reconciliation and never treat a later missing record alone
   as deletion permission. On `changed_between_passes_hold` or
   `invalid_snapshot_hold`, investigate and use a new approved run ID.
8. Set `HIVE_CONTACT_AUDIT_ENABLED=false` after downloading. Completed run IDs do
   not fetch more Hive pages. Retain/delete private audit data only per owner policy.

## Implementation and boundaries

One CAS-protected state Blob holds progress and private rows. Concurrent invocations
may duplicate a GET but cannot overwrite a newer cursor. API failure keeps progress
for retry; invalid pagination holds the run. API calls are GET-only, fixed-origin,
redirect-disabled, eight-second timeout. No role filter is used. Response/logging
exposes statuses and counts only, never records or provider error bodies.

The existing dependency `@netlify/blobs` 11.1.4 is reused. No new dependencies.
The function's schedule is an infrastructure trigger, not a public data route.
Reference: https://docs.netlify.com/build/functions/scheduled-functions/

## Ongoing sync is a separate disabled workflow

Prefer the existing authorized Google Sheets connection in Zapier for workbook
actions if Zapier can supply durable coordination and the required current reads.
Do not introduce Google OAuth to Netlify solely for this audit. A new Hive Zapier
connection requires explicit action-time approval and secure user entry there;
never move the Netlify Hive secret to Zapier automatically.

Before ongoing writes: complete API baseline, exact agent classification/identity
review, native same-workbook backup including notes, immutable IDs, verified column
mapping, durable three-way baselines, loop suppression, conflict/outbox recovery,
association/address protections, and explicit activation approval. Do not prune
Brokerages or touch Sent Cards. Agency writes remain manual in Hive.
