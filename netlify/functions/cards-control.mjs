import {getStore} from '@netlify/blobs';
import {handle} from '../lib/cards-http.mjs';
export default (request,context)=>handle({request,context,kind:'control',openStore:()=>getStore({name:'insites-agent-cards',consistency:'strong'})});
