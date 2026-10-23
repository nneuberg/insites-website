export const REVIEW_LAUNCH=Object.freeze({enabled:true,startAfter:'2026-10-23T00:02:00.000Z'});
export function reviewEnvironment(env=process.env){return {...env,REVIEW_ENABLED:REVIEW_LAUNCH.enabled?'true':'false',REVIEW_START_AFTER:REVIEW_LAUNCH.startAfter,REVIEW_CLIENT_ONLY:'true',REVIEW_REFERRALS_ENABLED:'false'};}
