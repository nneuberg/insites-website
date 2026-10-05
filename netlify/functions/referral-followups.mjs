import {runFollowup} from '../lib/referral-followups.mjs';
export default async ()=>{if(!process.env.REFERRAL_MAILING_ADDRESS){console.info("Referral follow-ups await mailing-address configuration");return new Response(null,{status:204});}await runFollowup();return new Response(null,{status:204});};
export const config={schedule:'*/15 * * * *'};
