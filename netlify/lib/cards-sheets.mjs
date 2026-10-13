import {SHEET_HEADERS} from './cards-adapters.mjs';
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
