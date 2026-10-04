import {createHash} from 'node:crypto';
export const CODE_TERMS_VERSION = '2026-10-04';
export function validateShare(input) {
 const out = {channel:input.channel};
 if (!['text','email'].includes(out.channel)) throw Error('Choose Text or Email.');
 for (const role of out.channel === 'email' ? ['referrer','friend'] : ['referrer']) {
  const name = input[role+'Name'], address = String(input[role+'Email'] || '').trim().toLowerCase();
  if(typeof name !== 'string' || !name.trim() || name.length>100 || /[\x00-\x1f]/.test(name)) throw Error('Enter a valid name.');
  if(address.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || /[\x00-\x1f]/.test(address)) throw Error('Enter a valid email.');
  out[role+'Name']=name.trim();out[role+'Email']=address;
 }
 if(out.friendEmail === out.referrerEmail) throw Error('Self-referrals are not eligible.');
 if(input.eligibility!=='confirmed' || input.permissionAndTerms!=='accepted') throw Error('Please accept the program rules and eligibility statement.');
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.referralId||'')) throw Error('Refresh the page and try again.');
 out.shareId=input.referralId;out.termsVersion=CODE_TERMS_VERSION;
 out.requestHash=createHash('sha256').update(JSON.stringify(out)).digest('hex');
 return out;
}
const escape = value => String(value).replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function referralEmail(share,code) {
 if(!/^INS25[A-Z2-9]{7}$/.test(code))throw Error('Invalid code');
 const text=`Hi ${share.friendName},\n\n${share.referrerName} thought of you. As their friend, you can save $25 on a full home inspection with Neal at InSites.\n\nYour referral code: ${code}\n\nVisit https://www.insites.services to schedule and enter this code when booking. The code connects your inspection to ${share.referrerName}, who can receive a $25 Amazon gift card after your qualifying inspection is completed and paid.\n\nFor new InSites clients; full home inspections only. Program terms: https://www.insites.services/refer#terms\n\nQuestions? Reply to Neal at neal@insites.services or call 330-990-9700.\n\nThis is a one-time introduction requested by your friend. You have not been added to a marketing list.`;
 return {subject:'A friend sent you $25 off your InSites inspection',text,html:`<!doctype html><html><body style="margin:0;background:#f7f5ee;font-family:Arial,Helvetica,sans-serif;color:#171815"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" style="width:100%;max-width:560px;background:#fff;border-top:4px solid #d4bd73" cellpadding="0" cellspacing="0"><tr><td style="padding:36px"><img src="https://www.insites.services/insites-wordmark-official.png" alt="InSites Inspection Services" width="180"><p style="margin-top:36px;font-size:11px;letter-spacing:2px;color:#766124">A GOOD INTRODUCTION</p><h1 style="font-size:32px;line-height:1.15">Your friend thought of you.<br>Here’s $25 off.</h1><p style="font-size:16px;line-height:1.7">Hi ${escape(share.friendName)},<br>${escape(share.referrerName)} wanted to introduce you to Neal at InSites. Save $25 on a full home inspection with your referral code:</p><p style="background:#f7f5ee;border:1px solid #deddd3;padding:22px;text-align:center;font-size:25px;letter-spacing:2px;font-weight:bold">${code}</p><p style="line-height:1.7">Enter this code when booking so we can thank ${escape(share.referrerName)} with a $25 Amazon gift card after your qualifying inspection is completed and paid.</p><p style="margin:28px 0"><a href="https://www.insites.services" style="display:inline-block;padding:16px 24px;background:#171815;color:#fff;text-decoration:none">Schedule your inspection →</a></p><p style="font-size:12px;line-height:1.7;color:#68685f">For new InSites clients. Full home inspections only. <a href="https://www.insites.services/refer#terms" style="color:#766124">Program rules</a>.</p><p style="font-size:14px;line-height:1.7">Questions? Reply to Neal or call <a href="tel:+13309909700">330-990-9700</a>.</p><p style="font-size:11px;line-height:1.6;color:#68685f;border-top:1px solid #deddd3;padding-top:18px">This one-time introduction was requested by your friend. You have not been added to a marketing list.</p></td></tr></table></td></tr></table></body></html>`};
}
export async function sendReferralEmail(share,code,env=process.env) {
 if(!env.RESEND_API_KEY) throw Error('Email not connected');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`referral-share/${share.shareId}`},body:JSON.stringify({from:env.REFERRAL_FROM_EMAIL || 'InSites <offers@insites.services>',to:[share.friendEmail],reply_to:'neal@insites.services',...referralEmail(share,code)}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Email delivery not confirmed');
 const result=await response.json();if(!result.id)throw Error('Missing email receipt');return result.id;
}
