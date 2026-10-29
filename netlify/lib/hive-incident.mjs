// Temporary containment for the confirmed monthly-quota incident, 2026-10-28.
// This is deliberately source-controlled, not a credential or automatic reset.
// Do not resume until low-request replacements and the provider reset are verified.
export const HIVE_INCIDENT=Object.freeze({paused:true,reason:'monthly-quota-exhausted'});
export class HiveUnavailable extends Error {
 constructor(status=503){super('Hive verification deferred');this.name='HiveUnavailable';this.code='HIVE_UNAVAILABLE';this.status=status;}
}
export const hiveUnavailable=error=>error?.code==='HIVE_UNAVAILABLE';
