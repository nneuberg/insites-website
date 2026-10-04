# Personal referral sharing — October 4, 2026

The form collects only referrer name/email and eligibility/terms acknowledgment. Generate code reuses that email’s oldest active assigned code, or atomically assigns a VERIFIED/AVAILABLE code. Codes are never replaced or recycled. The message dialog offers sms and mailto links plus a copy fallback. Recipients are chosen in the user’s app. The website never sends emails to friends or collects their details.

Codes holds owner name/email and assignment. Shares holds code-request IDs, referrer details and consent; CODE READY does not mean a message was sent. The unused friend and delivery columns were removed. Legacy Referrals is hidden for history; its public intake endpoint returns 410. CodeUses keeps opaque Hive inspection/client IDs for future reward deduplication; no referred-client name or email column.

Low-stock monitoring runs hourly through the Netlify referral-stock scheduled function, independently of form activation. It counts only VERIFIED + AVAILABLE $25 codes with no owner, excluding the 284 pending Hive creation. At <=5, an HMAC-protected ledger action reserves one alert episode. Resend sends it to neal@insites.services using the existing RESEND_API_KEY. Repeated checks do not resend a confirmed alert. Refill above five closes the episode and rearms the next alert. Ambiguous delivery retries use the same provider idempotency key for at most 23 hours, then require review in Alerts. No new credential is needed.

Apps Script deployment source is Code.gs plus CodeSharing.gs. Existing endpoint and HMAC secret unchanged. Sharing is enabled by default; REFERRAL_CODES_ENABLED=false is the emergency pause. The owner explicitly approved checkbox-based eligibility on October 4, 2026. No Clients/Exclusions lookup is required for sharing or code rewards; form eligibility and terms acknowledgment are required and recorded via consent timestamp/version. Existing old legacy referral flows are retired. No client imports are needed to activate sharing.

Hive API/webhooks and Xoxoday fulfillment remain deferred. 16 codes created in Hive, 284 pending; creation paused by user. Existing 24h post-completion/payment wait and six-month claim period unchanged. No automatic gift-card sending is running.

Validation: node --test tests/referral-sharing.test.mjs. Includes repeated-code retrieval, immutable attribution, no friend-data storage, duplicate rewards, inventory filtering, threshold alert, refill rearming and idempotent retry cutoff.
