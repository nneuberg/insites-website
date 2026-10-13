# Personal referral sharing — October 4, 2026

The form collects only referrer name/email and eligibility/terms acknowledgment. Generate code reuses that email’s oldest active assigned code, or atomically assigns a VERIFIED/AVAILABLE code. Codes are never replaced or recycled. The message dialog offers sms and mailto links plus a copy fallback. Recipients are chosen in the user’s app. The website never sends emails to friends or collects their details.

Codes holds owner name/email and assignment. Shares holds code-request IDs, referrer details and consent; CODE READY does not mean a message was sent. The unused friend and delivery columns were removed. Legacy Referrals, Clients, Exclusions, Events and Setup tabs were removed after verifying only test/empty/setup data. A local backup preserves the removed values. All legacy dispatch actions are retired; the old public intake endpoint returns 410. CodeUses keeps opaque Hive inspection/client IDs for future reward deduplication; no referred-client name or email column.

Low-stock monitoring runs hourly through the Netlify referral-stock scheduled function, independently of form activation. It counts only VERIFIED + AVAILABLE $25 codes with no owner, excluding the 284 pending Hive creation. At <=5, an HMAC-protected ledger action reserves one alert episode. Resend sends it to neal@insites.services using the existing RESEND_API_KEY. Repeated checks do not resend a confirmed alert. Refill above five closes the episode and rearms the next alert. Ambiguous delivery retries use the same provider idempotency key for at most 23 hours, then require review in Alerts. No new credential is needed.

Apps Script deployment source is Code.gs plus CodeSharing.gs. Existing endpoint and HMAC secret unchanged. Sharing is enabled by default; REFERRAL_CODES_ENABLED=false is the emergency pause. The owner explicitly approved checkbox-based eligibility on October 4, 2026. No Clients/Exclusions lookup is required for sharing or code rewards; form eligibility and terms acknowledgment are required and recorded via consent timestamp/version. Existing old legacy referral flows are retired. No client imports are needed to activate sharing.

Hive API/webhooks and Xoxoday fulfillment remain deferred. 16 codes created in Hive, 284 pending; creation paused by user. Existing 24h post-completion/payment wait and six-month claim period unchanged. No automatic gift-card sending is running.

Validation: node --test tests/referral-sharing.test.mjs. Includes repeated-code retrieval, immutable attribution, no friend-data storage, duplicate rewards, inventory filtering, threshold alert, refill rearming and idempotent retry cutoff.

## Mailchimp follow-ups (2026-10-04 migration)

The scheduled `referral-followups` function no longer sends through Resend. It synchronizes original code ownership into Mailchimp; Mailchimp owns scheduling, delivery, reports and unsubscribe handling. The older Resend template/helpers and signed unsubscribe endpoint remain only for backwards compatibility. No old follow-ups were sent before this migration. Low-stock administrative alerts still use Resend.

Mailchimp audience: `3ebb3017d4` (existing name: Agents). New referral contacts receive only `REF:CODE-OWNER`; never apply agent trigger tags. Use referral-only segments for referral campaigns, and agent-only segments for agent campaigns. Do not send an audience-wide agent campaign once referral contacts exist.

Merge fields: REFCODE (text), REFNAME (text), REF2DAY (date), REFSIX (date). Dates derive from original Assigned At in America/New_York, with six calendar months clamped to the last day when needed. Mailchimp date flows send on the due calendar day, not exactly 48 hours to the minute. Returning visitors retain original dates/code.

Flows:
- `9515`: InSites | Referral code — 2-day thank-you; email `10157790`, specific date REF2DAY, 0 days before.
- `9516`: InSites | Referral code — 6-month reminder; email `10157791`, specific date REFSIX, 0 days before.
Both have re-entry disabled. HTML source is in operations/mailchimp/.

Required production Netlify variables: MAILCHIMP_API_KEY (secret), MAILCHIMP_REFERRAL_AUDIENCE_ID=3ebb3017d4, REFERRAL_MAILCHIMP_ENABLED=true. Without the key the scheduler remains inactive. Never place API keys in the website, repository, sheet or this document.

Every 15 minutes the worker reads the ledger and current audience subscription states, then synchronizes at most three changed contacts. Never changes an existing subscription status, first/last name or agent tags. Conflicting codes require review. Legacy ledger opt-outs are suppressed. Overdue dates and stages already handled by the old sender are not backfilled automatically. Mailchimp reports are the source of truth for these email sends; the old K:R sheet receipt columns are retained as historical migration evidence only.

Connection acceptance check: after the key is entered and Netlify redeployed, verify one authorized code owner's name/code/date fields and REF:CODE-OWNER tag in Mailchimp, without enrolling agents or altering existing opt-outs. No customer send or inbox delivery test has yet been performed.

The current Essentials plan shows 1,464 / 1,500 contacts. The sync holds new contacts at 1,500 instead of intentionally entering an overage tier. Existing contacts can still be updated. Capacity is account-wide: recheck the limit before enabling if additional audiences are created. MAILCHIMP_CONTACT_LIMIT can be raised only after the owner authorizes the additional billing.

## Hive attribution adapter draft (2026-10-13)

This repository now includes `netlify/functions/referral-hive.mjs` and `netlify/lib/referral-hive.mjs`. This is an attribution-only draft, disabled unless `REFERRAL_HIVE_ENABLED=true`. No production setting, Apps Script deployment, Hive code, customer message, reward reservation, gift-card order, or billing plan was changed as part of this implementation. The historical 16-created / 284-pending inventory above was not re-counted. Code creation remains paused.

### Before any separately approved rollout

1. Review and deploy `operations/Code.gs` plus `operations/CodeSharing.gs` together to the existing ledger. The adapter needs the authenticated `holdCodeUse` action as well as the existing `codeSnapshot` and `recordCodeUse` actions. Existing spreadsheet columns suffice; no new sheet/client-email column is introduced.
2. Verify the actual full-inspection service IDs in Hive and explicitly set `REFERRAL_HIVE_SERVICE_IDS` to a comma-separated allowlist. Service names and add-ons never establish full-inspection eligibility. The public API does not expose service-configuration or discount-code creation endpoints; this adapter does neither.
3. Choose an explicit ISO timestamp for `REFERRAL_HIVE_START_AFTER`. This controls the initial changed-inspection window. Start-date/service-allowlist changes are operational decisions; changing the start date does not rewind an existing checkpoint. An authorized replay/reset must retain the existing ledger's immutable IDs and holds.
4. Reuse only the already configured runtime `HIVE_API_KEY`, `REFERRAL_LEDGER_URL`, and `REFERRAL_LEDGER_SECRET`. Never put secret values in source, the sheet, logs, or this document. No new credential/persistent-access setup is included.
5. Keep `REFERRAL_HIVE_ENABLED` unset or `false` until the ledger deployment, service IDs, start window, and activation have been explicitly approved. Local, branch-preview, and deploy-preview invocations are always paused before store/provider access, even when this gate is accidentally true. There is no preview override that can reach the production ledger.

### What it does when enabled in production

- Runs every 15 minutes. Alternates changed-inspection scans with a round-robin refresh of recorded uses, including sent uses so later cancellation/refund signals can still be flagged.
- Requests canceled and deleted records, paginates the changed feed, and refreshes inspection detail. A missing detail is considered a deletion only after a fresh authenticated list response provides that inspection's deletion tombstone.
- Matches exactly one registered VERIFIED / ASSIGNED $25 personal INS25 code. Missing/ambiguous Customers or codes, self-referrals, service mismatch, missing ownership/booking data, cancellations, and deletions cannot create an eligible attribution.
- Verifies new-client status across all exact, case-insensitive, same-email Customer contact identities and their paginated inspection histories. Agent-only associations do not count as past client work. Earlier or simultaneous Customer bookings, including canceled/deleted bookings, conservatively disqualify automatic new-client verification. Only a fully checked, consistent history containing the current booking can yield `newClient=true`.
- Saves a matched use through `recordCodeUse` using its existing `HIVE-{inspectionId}` identity. Customer email is transient for identity/self-referral checks; it is not stored in CodeUses or the adapter's checkpoint/hold records.
- Uses `holdCodeUse` to invalidate previously recorded attribution when current code/client data is removed, ambiguous, or changed. Attribution-change holds are sticky and require an operator review; a later restored code cannot silently clear them.
- Keeps opaque inspection IDs and safe reasons under `holds/` in the strong-consistency `insites-referral-hive-production` Blobs store. CodeUses remains the program ledger. Holds without a confidently attributable customer/code are not fabricated into ledger uses. Such un-attributed holds need operator review or a fresh changed-inspection event/replay.

### Reward safety and known limits

Hive's published REST schema provides scheduled `ends_at`, report publication, agreements and payment state. It does **not** provide an authoritative actual-completion timestamp or reliable negative refund/dispute clearance. The adapter always sends unknown actual completion, unknown dispute state, and unknown refund clearance unless the explicit `refunded` payment state is present. A paid/published inspection therefore remains visibly held with no reward due time. It never calls `reserveCodeReward`, any fulfillment provider, or a customer sender.

Published reports, elapsed scheduled end time, and full payment must not be substituted for verified actual completion. A future completion policy/evidence source, refund/dispute verification, and fulfillment/idempotency workflow require separate approval and implementation. The existing 24-hour wait and six-calendar-month claim rule are unchanged.

History checks are bounded to protect the scheduled runtime: unusually large, inconsistent, or semantically incomplete histories stay `UNKNOWN` and join the retry/review queue. No partial history can verify a new client. Transient provider/ledger errors preserve pending work. A permanent evidence gap is recorded on hold so it cannot block all later inspections.

### Recovery and verification

The scheduled runtime has a 25-second work deadline within Netlify's 30-second scheduled-function limit, a small request budget, bounded Hive/ledger request timeouts, and an atomic lease. Durable page IDs/cursors are saved before work; item progress is saved only after an acknowledged ledger result or a recorded safe hold. A crash or ambiguous ledger response replays the same use idempotently. A complete feed window is required before advancing its watermark, with a five-minute overlap. Inconsistent page totals restart the same window. HTTP 429 records a `Retry-After` cooldown; no immediate retry burst occurs. Other workers share Hive's per-owner rate limit, so production load still needs monitoring.

Rollback: keep/set `REFERRAL_HIVE_ENABLED=false`. No code inventory, public sharing flow, Mailchimp follow-up setting, or reward fulfillment setting needs to change.

Offline verification: `node --test tests/*.test.mjs`. The draft passes all 88 tests, including the original 42 referral/Mailchimp/review tests and 27 new adapter tests. Coverage includes duplicate events, same-email history pagination/failure, ambiguous clients/codes, missing completion/dispute data, unchanged pending uses, checkpoint/ledger failures, cancellation/refund/deletion, rate limits, preview isolation, and incomplete-feed protection. No authenticated live Hive request or production end-to-end run was performed.

API contract: https://docs.hiveinspect.com/api/openapi.json
