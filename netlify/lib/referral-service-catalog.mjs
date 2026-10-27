// Authenticated Hive catalog evidence refreshed Oct26. Service policy approved Oct27 01:37:26UTC; these are local configuration, not deployed activation.
export const REFERRAL_SERVICE_CATALOG=Object.freeze([
 Object.freeze({"id": "e7a79860-a349-40be-988b-0a55f57ee168", "name": "Single Family Inspection", "scheduler": true, "scope": "approved", "policy": "approved-full-inspection"}),
 Object.freeze({"id": "028730f7-77fc-4dee-ad6e-c235087d3b5c", "name": "Multi-Family Inspection", "scheduler": true, "scope": "approved", "policy": "approved-full-inspection"}),
 Object.freeze({"id": "a0ae8e52-2fa7-4c06-ad87-c8895b04dd0f", "name": "Pre-Listing Inspection", "scheduler": true, "scope": "approved", "policy": "approved-full-inspection"}),
 Object.freeze({"id": "c59d9c82-ceaf-4291-afa8-12e5f375d63f", "name": "Single Family Inspection (After Hours)", "scheduler": false, "scope": "approved", "policy": "approved-full-inspection"}),
 Object.freeze({"id": "3e4aa6d2-c95d-4d92-8c3d-a48a5c70c392", "name": "Deprecated Demo Home Inspection", "scheduler": null, "scope": "excluded", "policy": "deprecated-demo"}),
 Object.freeze({"id": "4c2c7f93-b437-4db1-a239-a84b3a7abef1", "name": "Standalone Assessment", "scheduler": false, "scope": "held", "policy": "not-proven-full-inspection"})
]);
export const APPROVED_REFERRAL_FULL_SERVICE_IDS=Object.freeze(REFERRAL_SERVICE_CATALOG.filter(x=>x.scope==='approved').map(x=>x.id));
// Compatibility alias: service selection is approved; runtime activation remains off.
export const PROPOSED_REFERRAL_FULL_SERVICE_IDS=APPROVED_REFERRAL_FULL_SERVICE_IDS;
export const REFERRAL_SERVICE_CONFIGURATION_READY=true;
