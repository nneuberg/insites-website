import {rewardBudget} from './referral-budget.mjs';
import {budgetedProvider} from './referral-budget-provider.mjs';
// Shared by public claim handler and private worker; never defaults to unbudgeted spending.
export function productionBudgetProvider({provider,store,config,now=()=>Date.now()}){
 if(config?.enabled!==true||config.monthlyCapCents!==20000||config.timeZone!=='America/New_York')throw Error('Production budget disabled');
 return budgetedProvider({provider,budget:rewardBudget({store,now}),readAvailableCents:()=>provider.readAvailableCents(),maxFeeCents:config.maxFeeCents,feeEvidence:config.feeEvidence});
 // Provider fee response is not assumed: retain the full verified fee bound until
 // receipt-specific fee evidence is available. This never frees speculative budget.
}
