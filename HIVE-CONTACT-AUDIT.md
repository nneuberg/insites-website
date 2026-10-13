# Private Hive contact audit (disabled draft)

This scheduled function reads all Hive contacts and agencies into private Netlify
Blobs in the existing project. It does not write to Hive, Sheets or Mailchimp and
has no public production endpoint. Existing review/tag functions are untouched.

The draft adds `build.ignore = "exit 0"` to prevent automatic Netlify deployments.
Do not merge or remove this guard without explicit deployment approval. Every draft
commit also uses `[skip netlify]`. No credentials are included or newly created.

## Approved activation only

1. Review this draft and run `node --test tests/hive-contact-audit.test.mjs` (17 tests).
2. Obtain approval to deploy this read-only function and store the private snapshot
   in the same Netlify project. Remove the draft build-ignore guard only then.
3. Keep existing `HIVE_API_KEY` in production Functions scope; never reveal/copy it.
4. Add nonsecret production Functions variables `HIVE_CONTACT_AUDIT_ENABLED=true`
   and a unique `HIVE_CONTACT_AUDIT_RUN_ID` matching `[A-Za-z0-9_-]{8,64}`.
5. Set nonsecret `HIVE_CONTACT_AUDIT_NOT_BEFORE` and `HIVE_CONTACT_AUDIT_EXPIRES_AT`
   ISO timestamps for a window no longer than one hour. Outside that window the
   handler returns BEFORE any Blob or API access. Use Functions > Run now manually
   for each page; 2710 contacts and 170 agencies require approximately 30 successful
   invocations for two passes. Each run ID has a hard 80-attempt budget including
   API failures and crashes. Preview runs are gated.
   Netlify Run now requires a scheduled function: `@yearly` is the dormant platform
   trigger, NOT a true one-time schedule. No minute polling remains. An annual tick
   outside the short window does no storage/API work. If the window includes Jan 1
   00:00 UTC, an automatic annual invocation can occur; choose another window.
6. Inspect counts/status only in function logs. Download private Blob
   `insites-hive-contact-audit/runs/<run-id>` through the project dashboard.
   The Blob includes both snapshots and a SHA-256 manifest; never publish it.
7. `complete` means both sequential passes have identical content and each passed
   unique-ID/total/cursor checks. This is not an atomic database snapshot. Re-read
   records before any reconciliation and never treat a later missing record alone
   as deletion permission. On `changed_between_passes_hold` or
   `invalid_snapshot_hold`, investigate and use a new approved run ID.
8. On success, budget exhaustion, failure hold, or expiry, set
   `HIVE_CONTACT_AUDIT_ENABLED=false` immediately. This is the smallest disable
   action: it prevents all store/API work even if an owner presses Run now again.
   Then remove the audit function in a follow-up approved deployment to eliminate
   the dormant annual schedule entirely. Completed/held runs never fetch more
   pages; manual calls inside the window still read status from one Blob.
   Retain/delete private audit data only per owner policy.

## Implementation and boundaries

One CAS-protected state Blob holds progress and private rows. A persisted attempt
reservation and 30-second lease fence concurrent readers before the GET. API failure
keeps cursor progress but consumes the bounded attempt budget; invalid pagination
holds the run. A crash consumes its attempt and requires lease expiry to retry. API calls are GET-only, fixed-origin,
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
