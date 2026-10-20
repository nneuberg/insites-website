import {getStore} from '@netlify/blobs';
import permit from './permit.json' with {type:'json'};
import {createHarness} from './harness.mjs';
import {createHandler} from './http-handler.mjs';
export const openHarness=()=>createHarness({storeFactory:name=>getStore({name,consistency:'strong'}),transport:fetch,env:process.env,permit});
export async function handle(request){
 try{return await createHandler(openHarness())(request)}catch{return Response.json({error:'Synthetic test unavailable'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow'}})}
}
