// Mailchimp owns both follow-up sends. The old Resend scheduler is intentionally disabled.
import {syncReferrals} from '../lib/referral-mailchimp.mjs';
export default async()=>{await syncReferrals();return new Response(null,{status:204});};
export const config={schedule:'*/15 * * * *'};
