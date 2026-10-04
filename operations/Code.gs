const TERMS_VERSION = '2026-09-30';
const email = value => String(value ?? '').trim().toLowerCase();
function validateSubmission(input) {
 const out = { ...input };
 for (const key of ['referrerName','friendName']) {
  if(typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100 || /[\r\n\x00-\x1f]/.test(input[key])) throw new Error('Invalid name');
  out[key] = input[key].trim();
 }
 for (const key of ['referrerEmail','friendEmail']) {
  out[key]=email(input[key]);
  if(out[key].length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out[key])) throw new Error('Invalid email');
 }
 if(out.referrerEmail===out.friendEmail) throw new Error('Self referral');
 for(const key of ['eligibility','permission','terms']) if(input[key] !== 'on' && input[key] !== true) throw new Error('Consent required');
 if(!/^[a-f0-9-]{36}$/i.test(input.idempotencyKey ?? '')) throw new Error('Request ID required');
 return {referrerName:out.referrerName,referrerEmail:out.referrerEmail,friendName:out.friendName,friendEmail:out.friendEmail,idempotencyKey:input.idempotencyKey,termsVersion:TERMS_VERSION};
}
function plusMonths(iso, months) {
 const d = new Date(iso), day=d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+months);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(day,last)); return d.toISOString();
}
function eligible(referral, clients, exclusions) {
 const address=email(referral['Referrer Email']);
 if(exclusions.some(c=>email(c.Email)===address)) return {state:'INELIGIBLE',reason:'Excluded referrer'};
 const matches=clients.filter(c=>email(c.Email)===address && String(c['Past Client Verified']).toUpperCase()==='YES');
 if(matches.length!==1)return {state:'PENDING',reason:'Past-client verification required'};
 if(clients.some(c=>email(c.Email)===email(referral['Friend Email']) && String(c['Past Client Verified']).toUpperCase()==='YES'))return {state:'INELIGIBLE',reason:'Friend is an existing client'};
 return {state:'ELIGIBLE',reason:''};
}
function applyInspection(referral, inspection, now = new Date().toISOString()) {
 const r={...referral};
 if(!inspection.emails.includes(email(r['Friend Email']))) return {...r,'Hold Reason':'Booking email mismatch'};
 if(r['Inspection ID'] && String(r['Inspection ID'])!==inspection.id) return {...r,'Hold Reason':'Multiple inspections require review'};
 r.Provider=inspection.provider;r['Inspection ID']=inspection.id;r['Last Verified At']=now;
 r['Booked At']=inspection.bookedAt;
 if(!inspection.bookedAt || new Date(inspection.bookedAt)<=new Date(r['Submitted At']))r['Hold Reason']='Referral must precede booking';
 else if(inspection.canceled) r['Hold Reason']='Inspection canceled or deleted';
 else if(!inspection.fullInspection)r['Hold Reason']='Full inspection service not verified';
 else if(r['New Client Verified']!=='YES')r['Hold Reason']='New-client check required';
 else if(!r['Completed At'] || !Number.isFinite(Date.parse(r['Completed At'])) || Date.parse(r['Completed At'])>Date.parse(now))r['Hold Reason']='Verify full inspection completion';
 else if(inspection.refunded || inspection.disputed)r['Hold Reason']='Refund or dispute detected';
 else if(r['Dispute Or Refund']!=='NO')r['Hold Reason']='Verify no refund or dispute';
 else r['Hold Reason']='';
 r['Service Verified']=inspection.fullInspection?'YES':'NO';
 // Use first observed paid time. It is conservative when no paid-at field exists.
 r['Paid At']=inspection.paid ? (r['Paid At'] || now) : '';
 r['Reward Due At']=r['Completed At'] && r['Paid At'] ? new Date(Math.max(Date.parse(r['Completed At']),Date.parse(r['Paid At']))+86400000).toISOString() : '';
 if(!['REWARD SENT','REDEEMED','EXPIRED'].includes(r.Status))r.Status=r['Completed At'] && r['Paid At']?'PAID':r['Completed At']?'COMPLETED':inspection.booked?'BOOKED':inspection.booked===false?'SUBMITTED':'BOOKED';
 return r;
}
function rewardReady(r,now=Date.now()) {
 return r.Eligibility==='ELIGIBLE' && !r['Hold Reason'] && r['Service Verified']==='YES' && r['New Client Verified']==='YES' && r['Dispute Or Refund']==='NO' && !!r['Completed At'] && !!r['Paid At'] && !!r['Reward Due At'] && Date.parse(r['Reward Due At'])<=now && Date.parse(r['Last Verified At'])<=now && now-Date.parse(r['Last Verified At'])<300000 && !r['Reward ID'] && !r['Reward State'];
}

/* Bound Apps Script for the existing Referral Leads spreadsheet.
 * Deploy as web app, execute as owner. HMAC is required for every operation.
 * Script properties: REFERRAL_LEDGER_SECRET (random 32+ bytes), REFERRAL_SHEET_ID.
 * Keep script and sheet editors limited to trusted operators.
 */
function doPost(e) {
 try {
  var envelope=JSON.parse(e.postData.contents),secret=PropertiesService.getScriptProperties().getProperty('REFERRAL_LEDGER_SECRET');
  if(!secret || !/^\d+$/.test(envelope.timestamp) || Math.abs(Date.now()-Number(envelope.timestamp))>300000)throw Error('Unauthorized');
  var bytes=Utilities.computeHmacSha256Signature(envelope.timestamp+'.'+envelope.payload,secret);
  var expected=bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  if(!constantEqual(expected,envelope.signature))throw Error('Unauthorized');
  var request=JSON.parse(envelope.payload),lock=LockService.getScriptLock();lock.waitLock(15000);
  try {return output({ok:true,data:dispatch(request.action,request.data)});}finally{lock.releaseLock();}
 }catch(error){return output({ok:false,error:'Operation failed'});}
}
function output(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function constantEqual(a,b){if(typeof b!=='string'||a.length!==b.length)return false;var result=0;for(var i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
function book(){var id=PropertiesService.getScriptProperties().getProperty('REFERRAL_SHEET_ID');if(!id)throw Error('Sheet not configured');return SpreadsheetApp.openById(id);}
function table(name){var s=book().getSheetByName(name);if(!s)throw Error('Missing tab');return s;}
function records(name){var values=table(name).getDataRange().getDisplayValues(),headers=values.shift();return values.filter(function(row){return row[0];}).map(function(row){var o={};headers.forEach(function(key,i){o[key]=row[i];});return o;});}
function safeCell(v){v=v==null?'':String(v);return /^[=+\-@]/.test(v)?"'"+v:v;}
function writeRecord(name,record,key){var s=table(name),values=s.getDataRange().getDisplayValues(),headers=values[0],index=headers.indexOf(key),row=values.findIndex(function(r,i){return i>0&&r[index]===String(record[key]);});if(row<0)row=s.getLastRow();s.getRange(row+1,1,1,headers.length).setValues([headers.map(function(h){return safeCell(record[h]);})]);SpreadsheetApp.flush();}
function dispatch(action,data){
 if(['codeSnapshot','prepareShare','prepareLowCodeAlert','lowCodeAlertSent','recordCodeUse','reserveCodeReward','codeRewardSent','codeRewardStatus'].includes(action))return codeDispatch(action,data);
 throw Error('Retired or unknown operation');
}
