import {CLAIM_LAUNCH} from '../lib/referral-claim-launch.mjs';
export default async(request,context)=>{
 if(!CLAIM_LAUNCH.enabled)return Response.json({error:'Reward claims are not yet available.'},{status:503,headers:{'Cache-Control':'no-store'}});
 // Live ledger must never receive sandbox issuance. Sandbox uses injected mocks
 // or an explicitly separate harness, never this production entry point.
 if(context?.deploy?.context!=='production'||CLAIM_LAUNCH.environment!=='production')return new Response(null,{status:503});
 const [{getStore},{createClaims,claimHandler},{tremendous},{ledger},{claimVault}]=await Promise.all([import('@netlify/blobs'),import('../lib/referral-claims.mjs'),import('../lib/tremendous.mjs'),import('../lib/referral-transport.mjs'),import('../lib/claim-vault.mjs')]);
 const production=context?.deploy?.context==='production';
 if(!production&&CLAIM_LAUNCH.environment==='production')return new Response(null,{status:503});
 const store=getStore({name:production?'insites-referral-claims':'insites-referral-claims-'+(context?.deploy?.id||'local'),consistency:'strong'});
 const provider=tremendous({...CLAIM_LAUNCH,key:process.env.TREMENDOUS_API_KEY});
 return claimHandler({claims:createClaims({store,provider,ledger,vault:claimVault(process.env.REFERRAL_CLAIM_ENCRYPTION_KEY),enabled:CLAIM_LAUNCH.enabled})})(request);
};
export const config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
