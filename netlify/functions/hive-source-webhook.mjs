import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceStore} from '../lib/hive-source-runtime.mjs';
import {createHiveSourceWebhook} from '../lib/hive-source-webhook.mjs';
export default async(request,context)=>{
 if(context?.deploy?.context!=='production'||!SOURCE_PLAN.receive)return new Response(null,{status:503});
 return createHiveSourceWebhook({store:sourceStore(context),enabled:true,secret:process.env.HIVE_SOURCE_WEBHOOK_SECRET,organizationId:process.env.HIVE_SOURCE_ORGANIZATION_ID})(request);
};
