export function showClaimState(root,state){
 const messages={held:'Your reward is reserved, but cannot be issued yet. No purchase was attempted. Please return later or contact Neal.',expired:'This claim link has expired. Please contact Neal for help.',revoked:'This claim is no longer available. Please contact Neal for help.',invalid:'Please open the private claim link provided by InSites.',unavailable:'Reward claims are not yet available.',processing:'Your claim is being processed. Please return later; do not submit another claim.',reconciling:'We’re checking your claim. Please return later; we will not place a second order while checking.'};
 if(!messages[state])return false;
 root.getElementById('form').hidden=true;
 root.getElementById('status').textContent=messages[state];return true;
}
// Local prepared page only. The production bootstrap remains disabled below.
export function bindClaimPage({root,token,enabled=false,preview=false,entitlementVerified=false,fetcher=fetch}){
 const el=id=>root.getElementById(id);let submitted=false;
 const status=message=>{el('status').textContent=message;};
 el('preview').hidden=!preview;
 if(!preview&&!enabled){el('form').hidden=true;status('Reward claims are not yet available.');return;}
 if(!preview&&!/^[a-f0-9]{64}$/.test(token||'')){el('form').hidden=true;status('Please open the private claim link provided by InSites.');return;}
 if(!entitlementVerified&&!preview){el('form').hidden=true;status('Your reward eligibility has not been verified. Please contact Neal for help.');return;}
 el('form').hidden=false;
 if(entitlementVerified){
  el('claim-title').textContent='Your introduction made a difference.';
  el('claim-description').textContent='Your qualifying referral earned you an Amazon.com gift card.';
  el('claim-amount').hidden=false;el('claim-opening').hidden=false;
 }
 el('agree').addEventListener('change',()=>{el('claim').disabled=submitted||!el('agree').checked;});
 el('form').addEventListener('submit',async event=>{
  event.preventDefault();if(submitted||!el('agree').checked)return;submitted=true;el('claim').disabled=true;
  if(preview){status('Preview: your reward would be prepared after this confirmation. Nothing was purchased.');return;}
  status('Checking your claim…');
  try{
   const response=await fetcher('/.netlify/functions/referral-claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'claim',confirm:true}),credentials:'same-origin',redirect:'error'});
   if(!response.ok)throw Error('unavailable');const value=await response.json();
   if(showClaimState(root,value.state))return;
   if(value.state!=='issued'||!value.link){status('We’re checking your claim. Please return later; we will not place a second order while checking.');return;}
   const url=new URL(value.link);
   if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='tremendous.com'||url.hostname.endsWith('.tremendous.com')))throw Error('invalid-link');
   el('reward').href=url.href;el('reward').hidden=false;el('form').hidden=true;
   status('Your gift card has been issued. Use the button below to access it.');
  }catch{status('We could not confirm your claim. Please return later or contact Neal; we will not place a second order while checking.');}
 });
}

// Read-only status POST keeps the capability out of URLs. Never claims on load.
export async function initializeClaimPage({root,token,enabled=false,preview=false,fetcher=fetch}){
 const args={root,token,enabled,preview,fetcher};
 if(!enabled||preview||!/^[a-f0-9]{64}$/.test(token||'')){bindClaimPage(args);return;}
 root.getElementById('form').hidden=true;
 root.getElementById('status').textContent='Checking your private invitation…';
 try{
  const response=await fetcher('/.netlify/functions/referral-claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action:'status'}),credentials:'same-origin',redirect:'error'});
  if(!response.ok)throw Error('status-unavailable');
  const value=await response.json();
  if(value.enabled!==true||value.amount!==25||value.currency!=='USD'||value.product!=='Amazon.com gift card')throw Error('unverified-entitlement');
  if(['expired','revoked','processing','reconciling'].includes(value.state)){showClaimState(root,value.state);return;}
  if(!['available','issued','held'].includes(value.state))throw Error('unexpected-state');
  bindClaimPage({...args,entitlementVerified:true});
  root.getElementById('status').textContent=value.state==='issued'?'This gift card has already been issued. Confirm below to retrieve it; this will not buy another card.':value.state==='held'?'Your reward is on hold. Confirming checks availability again; it will not create a duplicate reward.':'Your stored invitation is recognized. Eligibility is checked again when you confirm.';
  if(value.state==='issued')root.getElementById('claim').textContent='Access my existing gift card';
 }catch{showClaimState(root,'unavailable');}
}

if(typeof document!=='undefined'){
 const host=document.getElementById('claim-card-host');
 if(host?.shadowRoot){
  const token=location.hash.slice(1);history.replaceState(null,'',location.pathname+location.search);
  initializeClaimPage({root:host.shadowRoot,token,enabled:false,preview:new URLSearchParams(location.search).has('preview')});
 }
}
