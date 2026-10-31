// Explicit cutover hold. Preserve queues and history; do not resume writers until
// both audience field schemas, historical projections and flow triggers verify.
export const MAILCHIMP_STATE_MIGRATION=Object.freeze({paused:true,version:'review-fields-v1'});
