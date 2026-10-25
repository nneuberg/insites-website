# Hive tag synchronization ownership

`netlify/lib/hive-tag-sync.mjs` uses removal policy
`automatic-agent-status-v1`. Only these normalized tag names can produce an
`inactive` Mailchimp tag operation:

- 1st time buying agent
- new selling agent
- repeat selling agent
- absent selling agent
- absent buying agent
- repeat buying agent
- super buying agent
- vip buying agent
- no business

Normalization trims surrounding whitespace and lowercases; internal spacing and
spelling are significant. Operations retain Mailchimp's existing spelling when
removing a tag. The exported frozen list and each run's result make the boundary
auditable. Current and historical Hive catalog membership cannot expand it.
Every other manual, review, referral, suppression, photo, campaign or operational
tag is preserved, including catalog names absent from a particular contact.
`REVIEW:*`, `REF:*`, `google reviewed` and `feedback received` also have an
explicit defensive removal guard.

Hive additions retain the existing policy: `REVIEW:*` and `feedback received`
are excluded, now consistently after normalization. Other Hive tag additions
continue, including `google reviewed` and `REF:*`. This change does not enable
any Mailchimp flow or change native Hive integration settings. Adding a tag can
still be meaningful to an independently configured flow; no live addition tests
are performed by this suite.

The existing catalogs, stored cursor keys, email union, two existing audiences,
subscription state, fields, shared lock/request timeout and five-minute
schedule are preserved. No import/upsert, subscription changes, review/referral
dates, messages, deduplication resets or business-history writes are added.

## Source validation and counted coverage

Source policy `validated-counted-source-v1` follows Hive's documented
[pagination](https://docs.hiveinspect.com/api/pagination),
[contacts](https://docs.hiveinspect.com/api/contacts/list-contacts), and
[OpenAPI schema](https://docs.hiveinspect.com/api/openapi.json), checked on
2026-10-25. `total` counts all matching records across pages. `next_cursor` is
an opaque string or explicit null at the end. Short pages, including filtered
empty intermediate pages, do not imply completion.

The sync requires these properties to be present with valid types, along with
nonempty unique record IDs. These are stricter safety preconditions for this
sync: OpenAPI itself does not declare the properties required. The complete
email lookup (limit 200) and catalog must have `next_cursor: null` and a total
equal to the number of distinct returned records. All duplicate contacts must
match the email; every contact must supply an array of valid tag names before
either audience can be written. A legitimate empty tag array remains valid.
An empty email match is held; it is not interpreted as an untagged contact.

Discovery keeps per-pass `coverage` metadata in the existing cursor keys:
distinct accepted contact IDs, visited cursor tokens, and the expected total.
Malformed pages are rejected before their pending work is saved. Changed totals,
repeated IDs/cursors, or inconsistent terminal counts retain the current cursor
and save `restartRequired`. The next tick deliberately starts counting again
from the first page with the same `since` filter, retaining completion watermarks.
This does not reset review/referral deduplication or discard pending work.

Legacy in-flight pages are consumed as saved, including an empty pending page
whose next cursor is already recorded. Their earlier coverage is unknown:
finishing such a cycle reports `fullCoverage: legacy-unverified`, leaves the
completion watermark and `since` unchanged, and begins a fresh counted cycle.
Historical `lastCycleComplete` is retained; `lastVerifiedCycleComplete` is written
only after the new policy verifies a completed cycle without outstanding holds.

`fullTraversalComplete` means a counted traversal ended consistently.
`cycleComplete` additionally requires zero unresolved holds. A valid traversal
with held records can advance discovery because those records have durable retry
work, but it cannot claim complete reconciliation. `unresolvedHolds`, `held`,
`deferred`, `retried`, `resolvedHolds`, `partial`, `fullCoverage` and
`budgetExhausted` make the outcome visible in the last-run record and function log.

## Isolated holds and recovery

A valid complete email response containing invalid contact tag data or zero
matches becomes an isolated hold. A valid but slow discovery reconciliation
that reaches its local work budget is also durably held with reason
`reconciliation-budget`, before its pending item is acknowledged. This prevents
the same record from repeatedly occupying the front of a discovery page.
Auth, rate limiting, network/timeout, HTTP,
JSON, malformed page/identity/email, destination and storage failures stop the
run. Missing Mailchimp members (404) retain the existing skip behavior.

Holds live in `tag-sync/holds-live` or `tag-sync/holds-audit` in the existing
private store, under the same reconciliation lock. They are deduplicated by
normalized email. A new hold is saved before the pending contact is removed.
Storage failure stops processing. Repeated discovery of a held email does not
bypass its retry schedule or repeatedly consume provider calls.

Retry policy `fresh-audience-progress-v1` attempts at most one audience on one
due held record per tick, ordered by due time, last attempt and email. It saves
the record reservation and rotates the audience before provider I/O, so a crash
cannot continually select the same record or start every retry at Agent.
Existing holds without audience progress migrate on their next reserved turn.
Invalid saved progress stops the run rather than silently discarding work.

For that audience, the current catalog, complete Hive email snapshot and current
Mailchimp member are read concurrently. Every read must settle before proceeding;
any global failure takes precedence over an isolated invalid contact. Catalog
and source validation still precede every write. Neither Hive tags nor Mailchimp
tags are cached between runs, and no saved mutation is replayed.

The hold persists a hash of the normalized complete Hive tag union and the
audiences completed against that union. If a fresh snapshot changes the union,
earlier completion is invalidated durably before writing. Invalid tag data also
clears completion. A successful audience is checkpointed; the hold is removed
only when both audiences have completed against the same validated union.
An interruption between a write, its completion checkpoint and hold removal
causes later retries to read current tags again. Just-resolved emails encountered
by discovery in that same run are acknowledged without restarting their work.

Successful partial progress becomes due again after five minutes. Failure
backoff starts at five minutes, then ten, twenty, forty and at most sixty minutes.
Holds never expire or silently disappear. `retryAudiencesCompleted`, alongside
`retried`, `resolvedHolds` and `unresolvedHolds`, reports partial progress. No
alerts are sent.

Each pass still fetches at most one 25-contact discovery page per tick. The retry
and recent pass use an 18-second soft budget from run start; full-pass bookkeeping
may continue to 25 seconds. New provider requests and contact work cannot start
at or after 18 seconds, leaving the shared 12-second request timeout within the
scheduled function's 30-second cap. A held audience needs at most two sequential
provider rounds: concurrent reads, then an optional tag write. At 11.9 seconds
per successful provider request the modeled work takes 23.8 seconds, rather
than summing catalog, source, member and write delays. Storage latency and platform
termination can still interrupt work; durable checkpoints and the existing
120-second lock expiry allow recovery. These are soft limits, not a guarantee
that all storage work will finish within a run.

## Verification

Run `node --test tests/hive-tag-sync.test.mjs tests/hive-tag-source-guards.test.mjs tests/hive-tag-retry-progress.test.mjs`
for the focused suite and
`node --test tests/*.test.mjs` for the aggregate repository suite. The focused
suite uses only an injected fetcher, fake credentials, reserved-domain contacts
and in-memory conditional storage, including when testing the real engine's
HTTP wrapper and lock. It never contacts Hive, Mailchimp or email providers.

Coverage includes all nine owned tags, non-owned catalog collisions, operational
markers, normalization, missing data, empty versus failed reads, duplicate-email
union, missing members, HTTP failures, ambiguous write responses, replay,
checkpoint interruption, legacy migration, counted cursor progression, changed
totals, deadline continuation, conditional lock contention, expired-lock recovery,
durable hold failures, fair bounded retries, backoff and repaired-record recovery.
Sustained-latency regressions use a virtual clock to model concurrent 9-second
and 11.9-second provider responses, both audiences, required writes, source changes,
crashes at each progress boundary, uncertain responses, and continued discovery
of slow valid records alongside healthy contacts. All latencies remain below
the existing per-request timeout; no real provider is slowed or fault-injected.
The complete suite can also run under macOS `sandbox-exec` with network access
denied. Existing subscribed/opt-out fields
cannot be changed by these tag-only calls.

Baseline commit `441224249ced17a92c82b4cbbb2d4fc85a6e30d7` has one unrelated
aggregate failure in `tests/gallery.test.mjs`, “paginates and filters hidden
folders”: its mock repeats an album response for the newer photo lookup, which
throws “Album photo search is temporarily unavailable.” This ownership change
does not modify the gallery implementation or tests.

## Remaining limits

- A valid-looking but incorrect payload, including `tags: []` with internally
  consistent metadata, is indistinguishable from genuine emptiness. Hive supplies
  no per-contact tag count/completeness marker. Stale reads can also affect replay.
- Hive does not promise a snapshot across a long traversal. Collection changes
  can cause conservative restarts and delay coverage certification. Equal counts
  do not prove an immutable snapshot or correct provider contents.
- Global provider failures intentionally stop processing. A large hold backlog
  takes multiple ticks to retry; permanently invalid records remain visible until
  repaired. No immediate HTTP retry loop or outbound alert is introduced.
- Audience completion is not a cross-provider transaction. Source changes detected
  between attempts invalidate completion, but continuous source changes can delay
  resolution. Concurrent external edits or valid-looking stale provider responses
  cannot be prevented by these checkpoints.
- Checkpoint and lock recovery are verified with mocks, not forced production
  interruptions. Live fixture retesting and counted full-scan proof are separate.

Local tests establish modeled behavior, not zero future failures. Customer
requests must never be used for fault injection.
