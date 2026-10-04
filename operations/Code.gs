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
function onOpen(){SpreadsheetApp.getUi().createMenu('Referral Rewards').addItem('Verify selected referral','verifySelectedReferral').addToUi();}
function verifySelectedReferral(){
 var ui=SpreadsheetApp.getUi(),s=SpreadsheetApp.getActiveSheet(),row=s.getActiveRange().getRow();
 if(s.getName()!=='Referrals'||row<2){ui.alert('Select a referral row on the Referrals tab first.');return;}
 var id=s.getRange(row,1).getDisplayValue();if(!id){ui.alert('This row has no referral ID.');return;}
 var evidence=ui.prompt('Verification evidence','Describe how you verified this is a new client, the full inspection was completed, and there is no refund or dispute. Cancel if any fact is unknown.',ui.ButtonSet.OK_CANCEL);
 if(evidence.getSelectedButton()!==ui.Button.OK||!evidence.getResponseText().trim())return;
 var completed=ui.prompt('Full inspection completion','Enter actual completion with timezone, e.g. 2026-10-02T15:00:00-04:00. Do not use report publication or scheduled end time without confirming completion.',ui.ButtonSet.OK_CANCEL);
 if(completed.getSelectedButton()!==ui.Button.OK)return;
 if(!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(completed.getResponseText())){ui.alert('Please include date, time, and timezone.');return;}
 if(ui.alert('Confirm verified facts','Record new client, completed full inspection, and no refund/dispute for '+id+'? This does not send a reward.',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
 var lock=LockService.getScriptLock();lock.waitLock(15000);
 try{dispatch('verify',{referralId:id,completedAt:completed.getResponseText(),newClient:true,noRefundOrDispute:true,evidence:evidence.getResponseText().trim()});ui.alert('Verification recorded. Payment and eligibility must still pass reconciliation.');}
 catch(error){ui.alert('Verification could not be saved. Check completion date and sheet configuration.');}
 finally{lock.releaseLock();}
}
function writeRecord(name,record,key){var s=table(name),values=s.getDataRange().getDisplayValues(),headers=values[0],index=headers.indexOf(key),row=values.findIndex(function(r,i){return i>0&&r[index]===String(record[key]);});if(row<0)row=s.getLastRow();s.getRange(row+1,1,1,headers.length).setValues([headers.map(function(h){return safeCell(record[h]);})]);SpreadsheetApp.flush();}
function dispatch(action,data){
 if(['codeSnapshot','prepareShare','shareEmailSent','recordCodeUse','reserveCodeReward','codeRewardSent','codeRewardStatus'].includes(action))return codeDispatch(action,data);
 var now=new Date().toISOString();
 if(action==='snapshot')return {referrals:records('Referrals'),clients:records('Clients'),exclusions:records('Exclusions'),events:records('Events')};
 if(action==='submit'){
  var input=validateSubmission(data);
  var all=records('Referrals');
  if(all.some(function(r){return r['Request ID']===input.idempotencyKey;}))return {accepted:true};
  // A generic response avoids disclosing a friend's existing referral or client status.
  var candidate={'Referrer Email':input.referrerEmail,'Friend Email':input.friendEmail};
  var check=eligible(candidate,records('Clients'),records('Exclusions'));
  if(all.some(function(r){return email(r['Friend Email'])===input.friendEmail && r.Eligibility!=='INELIGIBLE';}))return {accepted:true};
  var recent=all.filter(function(r){return email(r['Referrer Email'])===input.referrerEmail && Date.parse(r['Submitted At'])>Date.now()-3600000;});
  if(recent.length>=10)throw Error('Rate limit');
  writeRecord('Referrals',{'Referral ID':'REF-'+Utilities.getUuid(),'Submitted At':now,Status:'SUBMITTED','Referrer Name':input.referrerName,'Referrer Email':input.referrerEmail,'Friend Name':input.friendName,'Friend Email':input.friendEmail,Eligibility:check.state,'Hold Reason':check.reason||'Friend consent / eligibility review','Consent At':now,'Terms Version':TERMS_VERSION,'Request ID':input.idempotencyKey,'Friend Consent':'UNKNOWN','New Client Verified':'UNKNOWN','Dispute Or Refund':'UNKNOWN','Reward State':''},'Referral ID');
  return {accepted:true};
 }
 if(action==='inbox'){
  if(records('Events').some(function(r){return r['Event ID']===data.eventId;}))return {duplicate:true};
  writeRecord('Events',{'Event ID':data.eventId,'Received At':now,Source:data.source,'Event Type':'Awaiting mapping',Payload:data.payload,Processing:'RECEIVED'},'Event ID');return {accepted:true};
 }
 if(action==='eventDone'){
  var event=records('Events').find(function(r){return r['Event ID']===data.eventId;});if(!event)throw Error('Missing event');
  event.Processing=data.processing;event.Notes=data.notes||'';writeRecord('Events',event,'Event ID');return {updated:true};
 }
 if(action==='update'){
  var old=records('Referrals').find(function(r){return r['Referral ID']===data.record['Referral ID'];});if(!old)throw Error('Missing referral');
  if((old['Last Verified At']||'')!==data.expected)throw Error('Concurrent update; retry');
  // Reconciliation cannot overwrite operator verification or fulfillment identifiers.
  var next=Object.assign({},old);['Status','Eligibility','Hold Reason','Provider','Inspection ID','Booked At','Paid At','Reward Due At','Last Event ID','Service Verified','Last Verified At','Notes'].forEach(function(k){if(k in data.record)next[k]=data.record[k];});
  if(data.record['Dispute Or Refund']==='YES')next['Dispute Or Refund']='YES';
  if(['REWARD SENT','REDEEMED','EXPIRED'].includes(old.Status))next.Status=old.Status;
  writeRecord('Referrals',next,'Referral ID');
  if(next['Dispute Or Refund']==='YES'){next['Hold Reason']='Refund or dispute detected';next['Reward Due At']='';writeRecord('Referrals',next,'Referral ID');}
  if(data.eventId)dispatch('eventDone',{eventId:data.eventId,processing:'PROCESSED',notes:next['Referral ID']});
  return {updated:true};
 }
 if(action==='verify'){
  var r=records('Referrals').find(function(r){return r['Referral ID']===data.referralId;});if(!r||!data.evidence)throw Error('Evidence required');
  if(data.completedAt){if(!Number.isFinite(Date.parse(data.completedAt))||Date.parse(data.completedAt)>Date.now())throw Error('Invalid completion');r['Completed At']=new Date(data.completedAt).toISOString();}
  if(data.newClient===true)r['New Client Verified']='YES';
  if(data.noRefundOrDispute===true)r['Dispute Or Refund']='NO';
  if(data.friendConsent===true)r['Friend Consent']='VERIFIED';
  r.Notes=data.evidence;writeRecord('Referrals',r,'Referral ID');return {updated:true};
 }
 if(action==='linkInspection'){
  var r=records('Referrals').find(function(r){return r['Referral ID']===data.referralId;});
  if(!r||!data.evidence||!/^[-a-zA-Z0-9]+$/.test(data.inspectionId)||r['Reward ID']||r['Reward State'])throw Error('Inspection evidence required');
  r.Provider='hive';r['Inspection ID']=data.inspectionId;r['Last Verified At']='';r['Paid At']='';r['Reward Due At']='';r.Notes=data.evidence;
  writeRecord('Referrals',r,'Referral ID');return {updated:true};
 }
 if(action==='reserveReward'){
  var r=records('Referrals').find(function(r){return r['Referral ID']===data.referralId;});if(!r)throw Error('Missing referral');
  var check=eligible(r,records('Clients'),records('Exclusions'));r.Eligibility=check.state;if(check.reason)r['Hold Reason']=check.reason;
  var earlier=records('Referrals').some(function(x){return x['Referral ID']!==r['Referral ID'] && email(x['Friend Email'])===email(r['Friend Email']) && (x['Reward ID'] || (eligible(x,records('Clients'),records('Exclusions')).state==='ELIGIBLE' && Date.parse(x['Submitted At'])<=Date.parse(r['Submitted At'])));});
  if(earlier||!rewardReady(r))throw Error('Not ready');
  r['Reward State']='RESERVED';r.Notes='Reserved for fulfillment; ambiguous provider timeouts require reconciliation, never blind retry';writeRecord('Referrals',r,'Referral ID');return r;
 }
 if(action==='rewardSent'){
  var r=records('Referrals').find(function(r){return r['Referral ID']===data.referralId;});
  if(!r||r['Reward State']!=='RESERVED'||!data.rewardId||!data.sentAt||!data.claimDeadline)throw Error('Reward receipt required');
  if(!Number.isFinite(Date.parse(data.sentAt))||!Number.isFinite(Date.parse(data.claimDeadline)))throw Error('Invalid dates');
  if(new Date(data.claimDeadline).toISOString()!==plusMonths(new Date(data.sentAt).toISOString(),6))throw Error('Campaign expiry differs from program');
  r['Reward ID']=data.rewardId;r['Reward Sent At']=data.sentAt;r['Claim Deadline']=data.claimDeadline;r['Reward State']='SENT';r.Status='REWARD SENT';writeRecord('Referrals',r,'Referral ID');return {updated:true};
 }
 if(action==='rewardStatus'){
  var r=records('Referrals').find(function(r){return r['Reward ID']===data.rewardId;});if(!r||!['REDEEMED','EXPIRED'].includes(data.status)||!data.evidence)throw Error('Provider evidence required');
  if(r.Status==='REDEEMED')return {updated:false};
  r.Status=data.status;r['Reward State']=data.status;r[data.status==='REDEEMED'?'Redeemed At':'Expired At']=now;r.Notes=data.evidence;writeRecord('Referrals',r,'Referral ID');return {updated:true};
 }
 throw Error('Unknown operation');
}
