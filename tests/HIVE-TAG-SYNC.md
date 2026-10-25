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
subscription state, fields, lock, timeout, failure behavior and five-minute
schedule are preserved. No import/upsert, subscription changes, review/referral
dates, messages, deduplication resets or business-history writes are added.

## Verification

Run `node --test tests/hive-tag-sync.test.mjs` for the focused suite and
`node --test tests/*.test.mjs` for the aggregate repository suite. The focused
suite uses only an injected fetcher, fake credentials, reserved-domain contacts
and in-memory conditional storage, including when testing the real engine's
HTTP wrapper and lock. It never contacts Hive, Mailchimp or email providers.

Coverage includes all nine owned tags, non-owned catalog collisions, operational
markers, normalization, missing data, empty versus failed reads, duplicate-email
union, missing members, HTTP failures, ambiguous write responses, replay,
checkpoint interruption, cursor progression, deadline continuation, conditional
lock contention and expired-lock recovery. Existing subscribed/opt-out fields
cannot be changed by these tag-only calls.

Baseline commit `441224249ced17a92c82b4cbbb2d4fc85a6e30d7` has one unrelated
aggregate failure in `tests/gallery.test.mjs`, “paginates and filters hidden
folders”: its mock repeats an album response for the newer photo lookup, which
throws “Album photo search is temporarily unavailable.” This ownership change
does not modify the gallery implementation or tests.

## Existing limits requiring separate work

- Explicitly missing/invalid tag arrays, failed HTTP/JSON reads, an empty email
  match, mismatched emails or an email/catalog `next_cursor` abort processing.
  The pending contact remains available for the next scheduled retry.
- Successful source responses with no cursor are trusted. The sync does not
  reconcile `total` against returned email matches or catalog size, and cannot
  detect a silently truncated contact tag array. A missing duplicate holding an
  automatic status can therefore cause that allowlisted status to be removed.
  The tests characterize this gap; non-owned tags remain protected even then.
- A discovery page with inconsistent `total` and no cursor can be marked
  complete. Cursor traversal/recovery is tested for well-formed responses, not
  proof against a changing remote collection or incorrect provider metadata.
- There is no immediate HTTP retry/backoff in the shared engine. Exceptions
  leave pending work for a later scheduled run. Ambiguous writes converge by
  reading current member tags again; a remote stale read remains a limitation.
- Checkpoint and lock recovery are verified with mocks, not a forced production
  interruption. Full-pass budget remains 35 seconds; actual platform termination
  can occur sooner. The existing 120-second lock expires after an abandoned run.

These issues are outside this limited ownership deployment. Local tests establish
the removal boundary and modeled recovery behavior, not live end-to-end delivery
or an assurance of zero future failures. Live fixture retesting is coordinated
separately; customer requests must never be used for fault injection.
