import {createClient} from '@supabase/supabase-js';
import {supabaseConfig} from '../dist/supabase-config.js';
export {supabaseConfig};
export const client=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{global:{fetch:(url,opts={})=>fetch(url,{...opts,signal:opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})}});
export async function rpc(name,args={}){
 const {data,error}=await client.rpc(name,args);
 if(error)throw new Error(error.code==='PGRST202'?'The event database update is missing. Please contact the host.':error.message);
 if(data?.error)throw new Error(data.error);return data;
}
export function download(name,data,type='application/json'){
 const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
