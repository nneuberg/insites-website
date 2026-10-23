import {SHEET_HEADERS,sheetRow} from './cards-adapters.mjs';
import {mutate,fingerprint} from './cards-core.mjs';
// Run only while the coordinator's global projection claim is owned. Never append.
export function createLedgerPlanner(env=process.env){
 const workbook=env.HIVE_CARDS_LEDGER_WORKBOOK_ID;
 if(typeof workbook!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(workbook))throw Error('private_workbook_configuration_required');
 return function planUpsert(values,projection){
 if(!Array.isArray(values)||JSON.stringify(values[0])!==JSON.stringify(SHEET_HEADERS))throw Error('ledger_headers_changed');
 if(!projection?.record_id||!Array.isArray(projection.rawRow)||projection.rawRow.length!==37||projection.rawRow[0]!==projection.record_id)throw Error('invalid_projection');
 const matches=[];let last=1;
 for(let i=1;i<values.length;i++){const row=values[i]||[];if(row.some(x=>x!==''&&x!==null&&x!==undefined))last=i+1;if(row[0]===projection.record_id)matches.push(i+1);}
 if(matches.length>1)throw Error('duplicate_ledger_record');
 const row=matches[0]||last+1;if(row>1000)throw Error('ledger_capacity_hold');
 return {method:'PUT',url:'https://sheets.googleapis.com/v4/spreadsheets/'+workbook+'/values/'+encodeURIComponent("'Sent Cards'!A"+row+':AK'+row)+'?valueInputOption=RAW',body:{range:"'Sent Cards'!A"+row+':AK'+row,majorDimension:'ROWS',values:[projection.rawRow]},readbackRange:"'Sent Cards'!A"+row+':AK'+row};
}
}

// Owner-only recovery, never a lease timeout or bridge retry. The owner must
// stop the old writer and attest a fresh full-range read from the fixed ledger.
// Without that operational fence, an old HTTP write could land after readback.
export async function reconcileProjection(store,input,env=process.env,now=Date.now()){
 createLedgerPlanner(env); // Validate the private, deployment-bound target.
 const {jobId,projectionToken,revision,workbookId,range,values,observedAt,writerStopped,evidence}=input;
 if(workbookId!==env.HIVE_CARDS_LEDGER_WORKBOOK_ID||range!=="'Sent Cards'!A1:AK1000"||writerStopped!==true||typeof evidence!=='string'||!evidence.trim()||evidence.length>2000||!Number.isFinite(observedAt)||observedAt>now||now-observedAt>300000||!Array.isArray(values)||values.length<1||values.length>1000||JSON.stringify(values[0])!==JSON.stringify(SHEET_HEADERS)||values.some(row=>!Array.isArray(row)||row.length>37||row.some(cell=>typeof cell!=='string')))throw Error('reconciliation_evidence_required');
 return mutate(store,s=>{
  const lease=s.projectionLease,j=s.jobs[jobId];
  if(!lease||!projectionToken||lease.token!==projectionToken||lease.jobId!==jobId||!j||j.revision!==revision||!j.projectionPending||!lease.snapshot||lease.snapshot.id!==jobId||lease.snapshot.revision!==lease.revision||observedAt<lease.at)throw Error('stale_reconciliation');
  const matches=values.slice(1).filter(row=>row[0]===jobId);
  const expected=sheetRow(lease.snapshot);
  const exact=matches.length===1&&expected.every((cell,i)=>cell===(matches[0][i]??''));
  const outcome=matches.length===0?'row_absent':exact?(j.revision===lease.revision?'current_write_confirmed':'older_write_confirmed'):'external_drift';
  s.audit.push({jobId,action:'projection_reconciled',at:now,outcome,claimRevision:lease.revision,currentRevision:j.revision,observedAt,evidence,writerStopped:true,readbackFingerprint:fingerprint(values),claimSnapshot:structuredClone(lease.snapshot)});
  if(outcome==='external_drift')return {status:'manual_review',outcome,locked:true};
  // Do not change the job revision, approval, delivery status, or original copy.
  // Missing/older rows leave the current desired projection queued.
  j.projectionPending=outcome!=='current_write_confirmed';delete s.projectionLease;
  return {status:'reconciled',outcome,locked:false,projectionPending:j.projectionPending,revision:j.revision};
 });
}
