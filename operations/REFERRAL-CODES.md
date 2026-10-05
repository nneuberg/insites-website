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
