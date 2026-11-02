// Private configuration only; no customer identifiers or hashes in public code.
// Exact October24 baseline must be verified before this registry is installed.
export function createManualExclusion({env=process.env}={}){
 let addresses=null;
 try{const r=JSON.parse(env.MARKETING_NB_EXCLUSIONS_JSON||'null');if(r?.version==='nb-baseline-20261024'&&r.verified===true&&Array.isArray(r.entries)&&r.entries.length>=4&&r.entries.length<=16&&r.entries.filter(x=>x.kind==='office-manager-baseline').length===3&&r.entries.some(x=>x.kind==='owner')&&r.entries.every(x=>['office-manager-baseline','owner'].includes(x.kind)&&typeof x.email==='string'&&x.email===x.email.trim().toLowerCase()&&/^\S+@\S+\.\S+$/.test(x.email)&&x.email.length<=254)&&new Set(r.entries.map(x=>x.email)).size===r.entries.length)addresses=new Set(r.entries.map(x=>x.email));}catch{}
 return async email=>addresses?{verified:true,excluded:addresses.has(String(email).trim().toLowerCase())}:{verified:false,excluded:false};
}
