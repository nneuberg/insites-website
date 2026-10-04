/* Added to the existing HMAC-authenticated Apps Script project.
 * All mutations run inside doPost's script lock. Never reuse/reassign a code.
 */
function codeDispatch(action,data) {
 var now=new Date().toISOString(), codes=records('Codes'), shares=records('Shares');
 if(action==='codeSnapshot')return {codes:codes,shares:shares,uses:records('CodeUses')};
 if(action==='prepareShare') {
  if(!['text','email'].includes(data.channel)||!/^[-a-f0-9]{36}$/i.test(data.shareId||'')||! /^[a-f0-9]{64}$/.test(data.requestHash||''))throw Error('Invalid share');
  var address=email(data.referrerEmail);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||!data.referrerName||data.termsVersion!=='2026-10-04')throw Error('Invalid share');
  if(data.channel==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.friendEmail||'')||email(data.friendEmail)===address||!data.friendName))throw Error('Invalid friend');
  var check=eligible({'Referrer Email':address,'Friend Email':data.channel==='email'?data.friendEmail:''},records('Clients'),records('Exclusions'));
  if(check.state!=='ELIGIBLE')return {pending:true};
  var previous=shares.find(function(s){return s['Share ID']===data.shareId;});
  if(previous) {
   if(previous['Request Hash']!==data.requestHash||previous['Referrer Email']!==address)throw Error('Request changed');
   // Resend retains an idempotency key for 24h; never retry beyond 23h.
   return {code:previous.Code,status:previous.Status,canSend:previous.Status==='EMAIL RESERVED'&&Date.now()-Date.parse(previous['Email Reserved At'])<23*3600000,referrerName:codes.find(function(c){return c.Code===previous.Code;})['Referrer Name']};
  }
  var recent=shares.filter(function(s){return s['Referrer Email']===address&&Date.now()-Date.parse(s['Created At'])<3600000;});
  if(recent.length>=10)throw Error('Too many shares');
  if(data.channel==='email'&&shares.some(function(s){return s['Referrer Email']===address&&s['Friend Email']===data.friendEmail&&s.Channel==='email'&&Date.now()-Date.parse(s['Created At'])<86400000;}))throw Error('Friend already contacted; review previous share');
  var owned=codes.filter(function(c){return email(c['Referrer Email'])===address;});
  // Returning clients retain the oldest active code. Additional codes stay linked.
  var code=owned.filter(function(c){return c['Hive State']==='VERIFIED'&&c['Assignment State']==='ASSIGNED';}).sort(function(a,b){return Date.parse(a['Assigned At'])-Date.parse(b['Assigned At']);})[0];
  if(owned.length&&!code)throw Error('Existing codes need review');
  if(code&&(code['Hive State']!=='VERIFIED'||code['Assignment State']!=='ASSIGNED'))throw Error('Code unavailable');
  if(!code) {
   code=codes.find(function(c){return c['Hive State']==='VERIFIED'&&c['Assignment State']==='AVAILABLE'&&!c['Referrer Email']&&!c['Referrer ID']&&Number(c['Discount Amount'])===25;});
   if(!code)throw Error('No codes available');
   var client=records('Clients').find(function(c){return email(c.Email)===address&&c['Past Client Verified']==='YES';});
   code['Assignment State']='ASSIGNED';code['Referrer ID']='OWNER-'+Utilities.getUuid();code['Referrer Name']=client.Name||data.referrerName;code['Referrer Email']=address;code['Assigned At']=now;
   writeRecord('Codes',code,'Code');
  }
  var status=data.channel==='email'?'EMAIL RESERVED':'TEXT READY';
  writeRecord('Shares',{'Share ID':data.shareId,'Created At':now,Channel:data.channel,Code:code.Code,'Referrer Email':address,'Friend Name':data.friendName||'','Friend Email':data.friendEmail||'',Status:status,'Email Reserved At':data.channel==='email'?now:'','Consent At':now,'Terms Version':data.termsVersion,'Request Hash':data.requestHash},'Share ID');
  return {code:code.Code,status:status,canSend:data.channel==='email',referrerName:code['Referrer Name']};
 }
 if(action==='shareEmailSent') {
  var share=shares.find(function(s){return s['Share ID']===data.shareId;});
  if(!share||share['Request Hash']!==data.requestHash||!data.emailId||share.Channel!=='email')throw Error('Receipt required');
  if(share.Status==='EMAIL SENT'){if(share['Email ID']!==data.emailId)throw Error('Different receipt');return {updated:false};}
  if(share.Status!=='EMAIL RESERVED')throw Error('Not reserved');
  share.Status='EMAIL SENT';share['Email ID']=data.emailId;share['Email Sent At']=now;writeRecord('Shares',share,'Share ID');return {updated:true};
 }
 if(action==='recordCodeUse') {
  // Called only after authenticated Hive fetch. Unknown provider fields must remain unknown.
  var i=data.inspection;
  if(!i||!/^[-a-zA-Z0-9]+$/.test(i.id||'')||!data.evidence||!Array.isArray(i.codes)||!i.clientId||!i.clientEmail)throw Error('Inspection evidence required');
  var matches=codes.filter(function(c){return i.codes.includes(c.Code)&&c['Assignment State']==='ASSIGNED'&&c['Hive State']==='VERIFIED';});
  if(matches.length!==1)return {matched:false};
  var code=matches[0],id='HIVE-'+i.id,all=records('CodeUses'),old=all.find(function(u){return u['Use ID']===id;});
  if(old&&(old.Code!==code.Code||old['Client ID']!==String(i.clientId))){old['Hold Reason']='Code or client changed; review attribution';old['Reward Due At']='';writeRecord('CodeUses',old,'Use ID');return {held:true};}
  var r=old||{'Use ID':id,Code:code.Code,'Referrer Name':code['Referrer Name'],'Referrer Email':code['Referrer Email'],'Hive Inspection ID':i.id,'Client ID':String(i.clientId),'Client Email':email(i.clientEmail)};
  var check=eligible({'Referrer Email':code['Referrer Email'],'Friend Email':i.clientEmail},records('Clients'),records('Exclusions'));
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
  var check=eligible({'Referrer Email':r['Referrer Email'],'Friend Email':r['Client Email']},records('Clients'),records('Exclusions'));
  if(check.state!=='ELIGIBLE'||!rewardReady(r))throw Error('Not ready');
  if(all.some(function(u){return u['Use ID']!==r['Use ID']&&(u['Hive Inspection ID']===r['Hive Inspection ID']||u['Client ID']===r['Client ID']||email(u['Client Email'])===email(r['Client Email']))&&(u['Reward State']||u['Reward ID']);}))throw Error('Reward already reserved');
  if(records('Referrals').some(function(u){return (u['Inspection ID']===r['Hive Inspection ID']||email(u['Friend Email'])===email(r['Client Email']))&&(u['Reward State']||u['Reward ID']);}))throw Error('Legacy reward already reserved');
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
