import {ledger} from './referral-transport.mjs';
export async function sendStockEmail(alert,env=process.env){
 if(!env.RESEND_API_KEY||alert.recipient!=='neal@insites.services')throw Error('Alert email not configured');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`referral-stock/${alert.alertId}`},body:JSON.stringify({from:'InSites <offers@insites.services>',to:['neal@insites.services'],subject:`InSites referral codes: only ${alert.remaining} left`,text:`Only ${alert.remaining} verified, unassigned $25 referral codes remain.\n\nCreate more codes in Hive and mark them VERIFIED in the Codes tab. Codes already assigned to clients remain active and are not counted as available inventory.\n\nReferral Leads: https://docs.google.com/spreadsheets/d/1BGGdchJHky3q7dCA37SQNgkSKzUvqjTY7Z1E1t6UXJk/edit?gid=10#gid=10\n\nThis alert is sent once per low-stock period. It resets when available inventory rises above five.`}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Alert delivery not confirmed');const result=await response.json();if(!result.id)throw Error('Missing alert receipt');return result.id;
}
export async function checkStock({callLedger=ledger,sendEmail=sendStockEmail,env=process.env}={}){
 const alert=await callLedger('prepareLowCodeAlert',{},env);if(alert.review)throw Error('Low-code email needs delivery review');if(!alert.send)return {sent:false,remaining:alert.remaining};
 const emailId=await sendEmail(alert,env);await callLedger('lowCodeAlertSent',{alertId:alert.alertId,emailId},env);return {sent:true,remaining:alert.remaining};
}
