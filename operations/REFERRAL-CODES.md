# Referral codes rollout — October 4, 2026

## Current architecture
- `/refer` redirects to the unlisted, noindex referral page.
- Referrer supplies name and email, then Text or Email. Only Email collects friend details.
- `/api/referral-share` validates inputs and calls the HMAC-authenticated Google Apps Script.
- `prepareShare` locks the spreadsheet, verifies Clients and Exclusions, and reuses the oldest active code owned by normalized referrer email. New owners receive only VERIFIED/AVAILABLE Hive codes. Additional existing codes remain active and attributed; never replace or recycle a code.
- `Codes`: one row per code, immutable owner identity and assignment timestamp.
- `Shares`: one row per sharing request, consent, channel, optional friend data, email receipt and idempotency hash.
- `CodeUses`: one row per qualifying Hive inspection, referrer resolved from code, completion/payment and one reward reservation per new client.
- Text opens a client-side message; no SMS service or phone number is collected. Sharing is initiated by the referrer.
- Email uses the site's existing Resend integration. One-time introductions do not subscribe friends to Mailchimp. Provider idempotency key is the share ID; ambiguous sends are held after 23 hours, before Resend's 24-hour key expiration.

## Rollout
Apps Script source is Code.gs plus CodeSharing.gs, concatenated into the deployed Code.gs. The existing ledger URL and HMAC secret remain unchanged. No new Google scopes.
Set `REFERRAL_CODES_ENABLED=true` after validating the connection; `RESEND_API_KEY` must be configured. Optional `REFERRAL_FROM_EMAIL`, default InSites <offers@insites.services>. Never commit credentials.
Keep general campaign launch paused until client/exclusion import, real email delivery test, Hive integration and reward campaign verification are complete.

## Current external dependencies
- 300 random code labels in Referral Leads. 16 created and verified in Hive, 284 pending by user request. Resume creation only when requested; do not regenerate this pool.
- Clients and Exclusions imports still pending. Past-client verification must come from inspection evidence, not a subscription/tag alone. Marketing consent remains independent.
- Hive API and webhook access both show Not enabled. Automatic inspection matching and reward fulfillment are intentionally not running. RecordCodeUse accepts normalized, verified data only; provider mapping must be validated against real API fields when enabled. Never infer completion from publication or scheduled end time.
- Xoxoday pay-when-redeemed billing, gift selection, six-calendar-month claim expiry, provider credentials and dispatch are not verified. Do not fall back to prepaid purchases.
- Keep Mailchimp agent contacts segregated and excluded. No campaign launch or real reward was performed during this rollout.

## Future Hive reconciliation
Fetch current inspection through authenticated Hive API after event and again before reward. Identify applied referral code. Require one matching assigned code, a verified new client and full inspection, actual completion, full payment, no cancellation/refund/dispute, and assignment before booking. Unknown fields hold fulfillment. Reward due = later of completion and first observed fully-paid timestamp + 24h. Reserve under ledger lock, rejecting duplicates across both CodeUses and legacy Referrals by inspection ID, client ID or email. Ambiguous provider timeouts require receipt reconciliation; never blind retry. Record exact six-calendar-month claim expiry and provider-backed redemption/expiration events.

## Validation
`node --test tests/referral-sharing.test.mjs`
Covers returning same-email owners, multiple retained codes, unavailable inventory, ineligible clients, idempotent shares and email, escaped templates, separate multiple-client uses, delay/duplicate payout guards, origin and rollout protection.

Live sharing remains disabled. Automatic approval review rejected setting REFERRAL_CODES_ENABLED=true before client/exclusion import and real delivery validation. Complete those prerequisites and obtain explicit activation approval before enabling. The page displays a coming-soon notice.
