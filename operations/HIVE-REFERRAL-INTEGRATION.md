# Hive referral integration — October 19, 2026

The existing form and Mailchimp follow-ups remain unchanged. The review engine is a separate workflow, with its own activation controls. No reward may depend on leaving a review or on its rating.

## Implemented

- Official Hive GET /v1/inspections and GET /v1/inspections/{id}, Bearer HIVE_API_KEY. Exact discount_codes[].code lookup against immutable Codes ownership. A generic $25 price reduction cannot identify a referrer.
- Bounded paginated audit library with an explicit complete flag and continuation cursor. Unknown provider facts stay unknown. Multiple customers/codes, self-referrals, booking before assignment, changes to prior attribution, and non-full payment are held.
- A daily diagnostic at 08:00 UTC reads the sheet and a sample of five inspections. It can also be run from Netlify's authenticated Run now button. It records an operational report in private insites-referral-audit/latest, with no customer names, addresses or email. It does not update the referral sheet, contact records, messages or rewards. A sample with zero matches is not a full-history result.
- Disabled webhook receiver: /.netlify/functions/referral-hive-webhook. It verifies Hive's native HMAC-SHA256 timestamp.raw_body signature, rejects stale/future messages and foreign organizations, and queues only event and inspection identifiers with atomic onlyIfNew deduplication. The event payload is never accepted as payment evidence. Provider test messages are acknowledged without queueing.

## Official contract verified in Hive docs

- https://docs.hiveinspect.com/api/inspections/get-an-inspection
- https://docs.hiveinspect.com/api/webhook-events
- https://docs.hiveinspect.com/api/webhook-signatures

Inspection response includes discount_codes, contacts, services, price.paid/payment_status/amount_paid/amount_due, reports.status and scheduled ends_at. It does not document a true completed-at timestamp, refund/dispute clearance, or historical new-client certification. Webhooks include confirmed, rescheduled, canceled and published; no payment webhook is documented. Payment reconciliation therefore also needs polling.

## Verified live

Commit 4352a55808434e57161fdcf87a067bee7296c4b2 deployed successfully as 6ad6b0cc6bdac6dd07a9227a. Netlify Run now on October 19 at 8:08 PM Eastern read the authenticated ledger and five Hive inspections successfully in 7 seconds. Zero code matches in that sample; complete=false. No customer writes, emails, or gift cards.

## Not yet active / remaining work

1. Agree completion rule (published report plus elapsed scheduled end, versus manual confirmation). Exact full-inspection service IDs must be configured from the account catalog.
2. New-client verification across migrated history and refund/dispute evidence need a documented source or an explicit manual approval path. Do not manufacture false values for absent provider fields.
3. Finish the queue consumer and payment polling -> ledger reconciliation; webhook queue alone does not update the sheet. Before allowing rewards, fix/test ledger behavior when a previously used code is removed or ownership/client changes, and maintain the 24-hour delay from the later of completion and first observed full payment.
4. Register a dedicated Hive webhook endpoint only when its consumer is ready. Set REFERRAL_HIVE_WEBHOOK_SECRET, HIVE_ORGANIZATION_ID and REFERRAL_HIVE_WEBHOOK_ENABLED=true. Keep disabled until the dedicated signing secret is saved; do not reuse the card/review secret. Signing-secret creation/entry requires user handoff in the browser.
5. Xoxoday credentials are not present under XOXO in Netlify. Verify the account's pay-when-redeemed arrangement, $25 USD Amazon product, six-month claim window, order idempotency/reconciliation, and redemption status callback before enabling any fulfillment. No real gift-card test is performed.
6. Complete full-history read-only reconciliation, then a controlled synthetic integration test outside customer messaging/reward providers. Finish reward retry and ambiguous-outcome tests before launch.

Google Business Profile access is used by the separate review engine; the referral matching itself does not require Google reviews. Existing Google Apps Script ledger authentication is already verified. Coupon generation remains paused as requested.
