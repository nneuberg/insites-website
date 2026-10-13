# Private Hive contact audit (disabled draft)

This scheduled function reads all Hive contacts and agencies into private Netlify
Blobs in the existing project. It does not write to Hive, Sheets or Mailchimp and
has no public production endpoint. Existing review/tag functions are untouched.

The draft adds `build.ignore = "exit 0"` to prevent automatic Netlify deployments.
Do not merge or remove this guard without explicit deployment approval. Every draft
commit also uses `[skip netlify]`. No credentials are included or newly created.

## Approved activation only

1. Review this draft and run `node --test tests/hive-contact-audit.test.mjs` (24 tests).
2. Obtain approval to deploy this read-only function and store the private snapshot
   in the same Netlify project. Remove the draft build-ignore guard only then.
3. Keep existing `HIVE_API_KEY` in production Functions scope; never reveal/copy it.
4. BEFORE the initial approved deployment, add nonsecret production Functions variables `HIVE_CONTACT_AUDIT_ENABLED=true`
   and a unique `HIVE_CONTACT_AUDIT_RUN_ID` matching `[A-Za-z0-9_-]{8,64}`.
5. Set nonsecret `HIVE_CONTACT_AUDIT_NOT_BEFORE` and `HIVE_CONTACT_AUDIT_EXPIRES_AT`
   ISO timestamps BEFORE deployment for a window no longer than one hour. Account
   for build time when choosing the fixed start/end. Netlify captures Functions
   environment at deployment; later variable edits do not update deployed functions.
   Outside that window the
   handler returns BEFORE any Blob or API access. Use Functions > Run now manually
   for each page; 2710 contacts and 170 agencies require approximately 30 successful
   invocations for two passes. Each run ID has a hard 80-attempt budget including
   API failures and crashes. Failed reads back off 5/10/20/30 seconds. Preview runs are gated.
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
8. On success, budget exhaustion, failure hold, or expiry, stop invoking Run now
   and execute the approved follow-up deployment that removes the audit function.
   Also reset the audit flag in project settings to prevent accidental future reuse.
   Changing the environment flag alone is NOT an immediate kill switch: a new
   deployment is required. Removal eliminates the dormant annual trigger entirely.
   The existing deployed absolute deadline independently stops all Blob/API work
   after expiry, even before cleanup deployment. Completed/held runs never fetch more
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
Environment deployment semantics: https://docs.netlify.com/build/functions/environment-variables/

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

## Data minimization

All contacts are enumerated so roleless agents cannot be mistaken as absent. Only
an explicit reconciliation projection is stored and hashed: immutable ID, relevant
names, email, phone, agency ID/follow-address flag, `agency_name` and `business_name`
as plain-text brokerage matching evidence when unlinked, address components (including
Hive's exact `address_line2` suite/unit field), update time,
verbatim role values and a small set of unverified agent/broker tag hints. Agency rows retain ID,
name, phone, address components and update time. Nested agency data contributes its
ID only. Birthdays, freeform notes, unrelated tags/custom fields and expiring photo
URLs are never persisted or included in hashes/logs. Changes only to excluded
fields do not invalidate the reconciliation projection. Enumeration includes
non-agent identities; they must never all be added to the Agents tab.

## Removal and deployment cost

The infrastructure schedule remains annual until the function is removed. Approval
should cover the initial deploy AND a follow-up removal deploy after success, hold
or expiry. A flag edit alone cannot disable the deployed function. Remove it when
the audit is finished, preferably bundled with an already-approved production deployment. At
the reported account rate of 15 credits per production deploy, two dedicated
deploys would consume 30 credits; confirm current billing before execution. Do not
claim a truly one-time infrastructure schedule or leave the annual trigger hidden.

Documented agent roles are `Buyer Agent` and `Listing Agent`. Unknown roles such as
`Agent` or `Seller Agent` remain verbatim for review, never silently discarded or
classified. Missing roles remain absent; verified `roles: []` remains empty.
`candidate_agent_tags` contains unverified organization labels only, not proof of
agent status. Do not add a contact based on tags without verified identity/role
evidence. This audit does not itself classify or add agent rows.
