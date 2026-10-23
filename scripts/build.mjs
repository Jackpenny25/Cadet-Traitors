import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const qa=process.argv.includes('--qa');
if(!qa&&Boolean(process.env.SUPABASE_URL)!==Boolean(process.env.SUPABASE_PUBLISHABLE_KEY))throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
const configuredUrl=!qa&&process.env.SUPABASE_URL?new URL(process.env.SUPABASE_URL):null;
if(configuredUrl&&(configuredUrl.protocol!=='https:'||configuredUrl.pathname!=='/'||configuredUrl.search||configuredUrl.hash||configuredUrl.username||configuredUrl.password))throw new Error('SUPABASE_URL must be the HTTPS project origin.');
const configPath=process.env.TNO_CONFIG_PATH||'dist/supabase-config.js';
const config=qa?`export const supabaseConfig={url:globalThis.location.origin,publishableKey:'LOCAL_QA_ONLY',turnstileEnabled:false,turnstileSiteKey:''};`:process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY?`export const supabaseConfig=${JSON.stringify({url:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY,turnstileEnabled:false,turnstileSiteKey:''})}`:await readFile(configPath,'utf8');
const dist=qa?'work-before-simplify/qa-site':process.env.TNO_OUTPUT||'dist';await mkdir(dist,{recursive:true});
const configPlugin={name:'browser-config',setup(builder){builder.onResolve({filter:/supabase-config\.js$/},()=>({path:'configuration',namespace:'tno-config'}));builder.onLoad({filter:/.*/,namespace:'tno-config'},()=>({contents:config,loader:'js'}));}};
await build({entryPoints:{app:'src/event-app.js',projector:'src/event-projector.js'},outdir:dist,bundle:true,format:'esm',minify:true,target:'es2022',plugins:[configPlugin],legalComments:'none'});
// Only browser-safe values go here.
await writeFile(dist+'/supabase-config.js',config);
if(dist!=='dist')for(const name of ['index.html','projector.html','styles.css','live.css','event.css','theatre.css','favicon.svg'])await copyFile('dist/'+name,dist+'/'+name);
if(configuredUrl)for(const name of ['index.html','projector.html']){const path=dist+'/'+name;await writeFile(path,(await readFile(path,'utf8')).replace(/https:\/\/[a-z0-9]+\.supabase\.co/g,configuredUrl.origin));}
// Keep old /dist links working when GitHub Actions deploys dist as the site root.
await mkdir(dist+'/dist',{recursive:true});
await writeFile(dist+'/compat-redirect.js',`const name=location.pathname.endsWith('/projector.html')?'projector.html':'index.html';location.replace('../'+name+location.search+location.hash);`);
for(const name of ['index.html','projector.html'])await writeFile(dist+'/dist/'+name,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trust No One</title><meta http-equiv="refresh" content="1;url=../${name}"><script defer src="../compat-redirect.js"></script></head><body><a href="../${name}">Open Trust No One</a></body></html>`);
console.log('Built connected app and projector into '+dist);
