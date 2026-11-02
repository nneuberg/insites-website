import {MARKETING_ADMISSION}from'../lib/marketing-admission-config.mjs';
import {handleTerminalCallback}from'../lib/marketing-terminal-callback.mjs';
import {createAdmissionClient}from'../lib/marketing-admission-client.mjs';
export default async(request,context)=>{
 if(context?.deploy?.context!=='production'||MARKETING_ADMISSION.terminalCallbackEnabled!==true)return new Response(null,{status:503});
 return handleTerminalCallback(request,{config:MARKETING_ADMISSION,client:createAdmissionClient(),secret:process.env.MARKETING_TERMINAL_CALLBACK_SECRET});
};
