// Applies only to new enrollment. Never changes existing request scope/receipts.
export const REVIEW_INTAKE_START_AFTER='2026-10-31T19:10:47.000Z';
export function allowsReviewIntake(inspection,startAfter){
 const cutoff=Date.parse(startAfter||''),end=Date.parse(inspection?.ends_at||'');
 return Number.isFinite(cutoff)&&Number.isFinite(end)&&end>=cutoff;
}
