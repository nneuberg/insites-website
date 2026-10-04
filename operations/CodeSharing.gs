/* Added to the existing HMAC-authenticated Apps Script project.
 * All mutations run inside doPost's script lock. Never reuse/reassign a code.
 */
function codeDispatch(action,data) {
 var now=new Date().toISOString(), codes=records('Codes'), shares=records('Shares');
 if(action==='codeSnapshot')return {codes:codes,shares:shares,uses:records('CodeUses')};
 if(action==='prepareShare') {
  if(!/^[-a-f0-9]{36}$/i.test(data.shareId||'')||! /^[a-f0-9]{64}$/.test(data.requestHash||''))throw Error('Invalid request');
  if(data.friendEmail||data.friendName||data.channel)throw Error('Only referrer details accepted');
  var address=email(data.referrerEmail);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||!data.referrerName||data.termsVersion!=='2026-10-04-personal-share')throw Error('Invalid referrer');
  if(data.eligibility!=='confirmed'||data.permissionAndTerms!=='accepted')throw Error('Eligibility acknowledgment required');
  var previous=shares.find(function(s){return s['Share ID']===data.shareId;});
  if(previous) {
   if(previous['Request Hash']!==data.requestHash||previous['Referrer Email']!==address)throw Error('Request changed');
   var prior=codes.find(function(c){return c.Code===previous.Code;});
   if(!prior||prior['Hive State']!=='VERIFIED'||prior['Assignment State']!=='ASSIGNED'||email(prior['Referrer Email'])!==address)throw Error('Code unavailable');
   return {code:prior.Code};
  }
  if(shares.filter(function(s){return s['Referrer Email']===address&&Date.now()-Date.parse(s['Created At'])<3600000;}).length>=10)throw Error('Too many requests');
  var owned=codes.filter(function(c){return email(c['Referrer Email'])===address;});
  var code=owned.filter(function(c){return c['Hive State']==='VERIFIED'&&c['Assignment State']==='ASSIGNED';}).sort(function(a,b){return Date.parse(a['Assigned At'])-Date.parse(b['Assigned At']);})[0];
  if(owned.length&&!code)throw Error('Existing codes need review');
  if(!code) {
   code=codes.find(codeAvailable);
   if(!code)throw Error('No codes available');
   code['Assignment State']='ASSIGNED';code['Referrer ID']='OWNER-'+Utilities.getUuid();code['Referrer Name']=data.referrerName;code['Referrer Email']=address;code['Assigned At']=now;
   writeRecord('Codes',code,'Code');
  }
  writeRecord('Shares',{'Share ID':data.shareId,'Created At':now,Code:code.Code,'Referrer Name':code['Referrer Name'],'Referrer Email':address,Status:'CODE READY','Consent At':now,'Terms Version':data.termsVersion,'Request Hash':data.requestHash},'Share ID');
  return {code:code.Code};
 }
 if(action==='prepareLowCodeAlert') {
  var count=codes.filter(codeAvailable).length,alerts=records('Alerts'),open=alerts.filter(function(a){return !a['Closed At'];});
  if(count>5){open.forEach(function(a){a['Closed At']=now;writeRecord('Alerts',a,'Alert ID');});return {send:false,remaining:count};}
  if(open.length>1)throw Error('Ambiguous alert state');
  var alert=open[0];
  if(alert&&alert.Status==='SENT')return {send:false,remaining:count};
  if(alert&&Date.now()-Date.parse(alert['Reserved At'])>=23*3600000){alert.Status='REVIEW REQUIRED';writeRecord('Alerts',alert,'Alert ID');return {send:false,review:true};}
  if(!alert){alert={'Alert ID':'LOW-'+Utilities.getUuid(),'Reserved At':now,'Available Codes':count,Recipient:'neal@insites.services',Status:'RESERVED'};writeRecord('Alerts',alert,'Alert ID');}
  return {send:true,alertId:alert['Alert ID'],remaining:Number(alert['Available Codes']),recipient:alert.Recipient};
 }
 if(action==='lowCodeAlertSent') {
  var alert=records('Alerts').find(function(a){return a['Alert ID']===data.alertId;});
  if(!alert||!data.emailId)throw Error('Alert receipt required');
  if(alert.Status==='SENT'){if(alert['Email ID']!==data.emailId)throw Error('Receipt mismatch');return {updated:false};}
  if(alert.Status!=='RESERVED')throw Error('Alert not reserved');
  alert.Status='SENT';alert['Email ID']=data.emailId;alert['Sent At']=now;writeRecord('Alerts',alert,'Alert ID');return {updated:true};
 }
 if(action==='recordCodeUse') {
  // Called only after authenticated Hive fetch. Unknown provider fields must remain unknown.
  var i=data.inspection;
  if(!i||!/^[-a-zA-Z0-9]+$/.test(i.id||'')||!data.evidence||!Array.isArray(i.codes)||!i.clientId||!i.clientEmail)throw Error('Inspection evidence required');
  var matches=codes.filter(function(c){return i.codes.includes(c.Code)&&c['Assignment State']==='ASSIGNED'&&c['Hive State']==='VERIFIED';});
  if(matches.length!==1)return {matched:false};
  var code=matches[0],id='HIVE-'+i.id,all=records('CodeUses'),old=all.find(function(u){return u['Use ID']===id;});
  if(old&&(old.Code!==code.Code||old['Client ID']!==String(i.clientId))){old['Hold Reason']='Code or client changed; review attribution';old['Reward Due At']='';writeRecord('CodeUses',old,'Use ID');return {held:true};}
  var r=old||{'Use ID':id,Code:code.Code,'Referrer Name':code['Referrer Name'],'Referrer Email':code['Referrer Email'],'Hive Inspection ID':i.id,'Client ID':String(i.clientId)};
  var check={state:'ELIGIBLE',reason:''}; // Referrer eligibility is self-attested when the code is assigned.
  r.Eligibility=check.state;r['Hold Reason']=check.reason||'';
  r['Booked At']=i.bookedAt||'';r['Completed At']=i.completed===true&&Number.isFinite(Date.parse(i.completedAt))&&Date.parse(i.completedAt)<=Date.now()?i.completedAt:'';
  r['Paid At']=i.paid===true?(r['Paid At']||now):'';
  r['Service Verified']=i.fullInspection===true?'YES':'UNKNOWN';r['New Client Verified']=i.newClient===true?'YES':'UNKNOWN';
  r['Dispute Or Refund']=i.refunded===true||i.disputed===true?'YES':i.refunded===false&&i.disputed===false?'NO':'UNKNOWN';
  if(email(i.clientEmail)===code['Referrer Email'])r['Hold Reason']='Self referral';
  if(!i.bookedAt||!Number.isFinite(Date.parse(i.bookedAt))||Date.parse(i.bookedAt)<=Date.parse(code['Assigned At']))r['Hold Reason']='Code must be assigned before booking';
  if(i.canceled!==false)r['Hold Reason']='Cancellation state not cleared';
  if(r['Service Verified']!=='YES'||r['New Client Verified']!=='YES'||r['Dispute Or Refund']!=='NO')r['Hold Reason']='Eligibility facts need verification';
  r['Reward Due At']=r['Paid At']&&r['Completed At']?new Date(Math.max(Date.parse(r['Paid At']),Date.parse(r['Completed At']))+86400000).toISOString():'';
  r['Last Verified At']=now;r['Last Event ID']=data.eventId||'';r.Notes=data.evidence;
  if(!['REWARD SENT','REDEEMED','EXPIRED'].includes(r.Status))r.Status=r['Paid At']&&r['Completed At']?'PAID':r['Completed At']?'COMPLETED':'BOOKED';
  writeRecord('CodeUses',r,'Use ID');return {matched:true,useId:id};
 }
 if(action==='reserveCodeReward') {
  var all=records('CodeUses'),r=all.find(function(u){return u['Use ID']===data.useId;});if(!r)throw Error('Unknown use');
  var owner=codes.find(function(c){return c.Code===r.Code;});
  if(!owner||owner['Assignment State']!=='ASSIGNED'||owner['Hive State']!=='VERIFIED'||owner['Referrer Email']!==r['Referrer Email'])throw Error('Owner mismatch');
  if(!rewardReady(r))throw Error('Not ready');
  if(all.some(function(u){return u['Use ID']!==r['Use ID']&&(u['Hive Inspection ID']===r['Hive Inspection ID']||u['Client ID']===r['Client ID'])&&(u['Reward State']||u['Reward ID']);}))throw Error('Reward already reserved');
  r['Reward State']='RESERVED';writeRecord('CodeUses',r,'Use ID');return r;
 }
 if(action==='codeRewardSent') {
  var r=records('CodeUses').find(function(u){return u['Use ID']===data.useId;});
  if(!r||r['Reward State']!=='RESERVED'||!data.rewardId||!data.sentAt||!data.claimDeadline||!Number.isFinite(Date.parse(data.sentAt)))throw Error('Receipt required');
  if(data.claimDeadline!==plusMonths(new Date(data.sentAt).toISOString(),6))throw Error('Expiry mismatch');
  r.Status='REWARD SENT';r['Reward State']='SENT';r['Reward ID']=data.rewardId;r['Reward Sent At']=data.sentAt;r['Claim Deadline']=data.claimDeadline;writeRecord('CodeUses',r,'Use ID');return {updated:true};
 }
 if(action==='codeRewardStatus') {
  var r=records('CodeUses').find(function(u){return u['Reward ID']===data.rewardId;});
  if(!r||!['REDEEMED','EXPIRED'].includes(data.status)||!data.evidence)throw Error('Provider evidence required');
  if(r.Status==='REDEEMED')return {updated:false};r.Status=data.status;r['Reward State']=data.status;r[data.status==='REDEEMED'?'Redeemed At':'Expired At']=now;r.Notes=data.evidence;writeRecord('CodeUses',r,'Use ID');return {updated:true};
 }
 throw Error('Unknown code operation');
}

function codeAvailable(c){return c['Hive State']==='VERIFIED'&&c['Assignment State']==='AVAILABLE'&&!c['Referrer Email']&&!c['Referrer ID']&&Number(c['Discount Amount'])===25;}
