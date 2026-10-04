import {checkStock} from '../lib/referral-stock.mjs';
export default async ()=>{await checkStock();return new Response(null,{status:204});};
export const config={schedule:'0 * * * *'};
