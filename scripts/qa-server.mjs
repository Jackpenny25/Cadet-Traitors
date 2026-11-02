// Local QA only. Real embedded Postgres, mocked Supabase Auth, no remote project writes.
import {createServer} from 'node:http';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {eventDatabase} from '../tests/runtime-helpers.js';
const root=resolve('work-before-simplify/qa-site');await mkdir(root,{recursive:true});
const fixture=await eventDatabase(53);
const ports=(process.env.TNO_QA_PORTS||'4185,4186').split(',').map(Number);
await fixture.db.exec(await readFile('supabase/migrations/20261023203457_dramatic_four_group_schedule.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261023211459_guard_event_admin_actions.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261028164351_clarify_cadet_flow_and_joining.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261028173202_actionable_group_controls_and_role_labels.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261028205344_evidence_room_stages.sql','utf8'));
if(process.env.TNO_QA_NEW_FLOW==='true'){
 await fixture.db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>'20261028205344_evidence_room_stages.sql').sort())await fixture.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await fixture.db.query("insert into private.raf_quiz_bank values('raf-general-v1',$1,'QA only: estimate a whole number',100,'[]')",[JSON.stringify([{id:'a',prompt:'Synthetic RAF question A',answers:['alpha']},{id:'b',prompt:'Synthetic RAF question B',answers:['bravo']}])]);
}
const {id}=await fixture.cmd(0,'create',null,{title:'2427: Trust No One',groups:4,size:13,traitors:2});
if(process.env.TNO_PRIVATE_MISSION_PLAN_PATH){
 const pack=JSON.parse(await readFile(process.env.TNO_PRIVATE_MISSION_PLAN_PATH,'utf8'));
 const state=await fixture.snap(0,id);
 await fixture.cmd(0,'apply_mission_plan',id,{plan_id:'2026-11-02-archive-evidence',confirm:state.title,revision:state.timetable_revision,mission_revision:state.mission_revision,private_material:pack.private_material});
}
await fixture.cmd(0,'joining',id,{open:true});
for(let i=1;i<=50;i++)await fixture.cmd(i,'join');
await fixture.cmd(0,'assign_staff',id,{name:'Person 51',groups:[(await fixture.snap(0,id)).groups[0].id]});
await fixture.cmd(0,'prepare_roles',id);await fixture.cmd(0,'release_roles',id);await fixture.cmd(0,'mission',id,{mission:0});
if(process.env.TNO_QA_NEW_FLOW==='true'){
 await fixture.cmd(0,'discussion',id);await fixture.cmd(0,'open_vote',id);await fixture.cmd(0,'close_vote',id);
 for(const g of (await fixture.snap(0,id)).groups)await fixture.cmd(0,'skip_ballot',id,{group:g.id});
 await fixture.cmd(0,'open_murder',id,{slot:0});
 if(process.env.TNO_QA_FIRST_MURDER!=='true'){
 await fixture.queryAs(-1,"update private.first_murder_rounds set chat_until=clock_timestamp()-interval '1 second' where event_id=$1",[id]);
 for(const r of (await fixture.snap(0,id)).first_murder){await fixture.cmd(0,'first_manual',id,{opportunity:r.opportunity,target:'',reason:'QA no-murder setup'});await fixture.cmd(0,'first_publish_quiz',id,{opportunity:r.opportunity});}
 for(const r of (await fixture.snap(0,id)).reveals.filter(r=>!r.published))await fixture.cmd(0,'publish',id,{group:r.group_id,reveal:r.id});
 await fixture.cmd(0,'mission',id,{mission:1});await fixture.cmd(0,'discussion',id);await fixture.cmd(0,'open_vote',id);
 const state=await fixture.snap(0,id);
 for(const g of state.groups){await fixture.cmd(0,'plain_save',id,{group:g.id,task:'Synthetic QA: show a paper raven to your proposed victim and explain their response.',explanation:'required',photo:'required',nco:true});const task=(await fixture.snap(0,id)).plain_tasks.find(t=>t.group===g.id);await fixture.cmd(0,'plain_send',id,{group:g.id,revision:task.revision});await fixture.cmd(0,'plain_open',id,{group:g.id});}
 console.log('New flow QA actors: '+state.players.filter(p=>p.role==='Traitor').map(p=>p.account_name+' ('+state.groups.find(g=>g.id===p.group).name+')').join(', '));
 }else{
  const state=await fixture.snap(0,id);console.log('First-murder QA Traitors: '+state.players.filter(p=>p.role==='Traitor').map(p=>p.account_name+' ('+state.groups.find(g=>g.id===p.group).name+')').join(', '));
  console.log('First-murder QA board: http://127.0.0.1:'+ports[0]+'/projector.html#'+state.display_token);
  await fixture.cmd(0,'room_control',id,{group:state.groups[0].id,enabled:true});
 }
}
const practice=await fixture.cmd(0,'create',null,{title:'Separate NCO rehearsal',practice:true,groups:4,size:13,traitors:2});
await fixture.cmd(0,'joining',practice.id,{open:true});
if(process.env.TNO_QA_NEW_FLOW==='true')await fixture.cmd(0,'plain_save',practice.id,{group:(await fixture.snap(0,practice.id)).groups[0].id,task:'REVIEW DRAFT: complete the physical action with the proposed victim.',explanation:'required',photo:'optional',nco:false});
const projector=await fixture.cmd(0,'create',null,{title:'Projector animation check',practice:true});
await fixture.cmd(0,'add_test_players',projector.id,{target_total:24});
await fixture.cmd(0,'prepare_roles',projector.id);await fixture.cmd(0,'release_roles',projector.id);
await fixture.cmd(0,'mission',projector.id,{mission:0});await fixture.cmd(0,'discussion',projector.id);await fixture.cmd(0,'open_vote',projector.id);
await fixture.cmd(0,'test_votes',projector.id,{expected_ballots:Object.fromEntries((await fixture.snap(0,projector.id)).groups.map(g=>[g.id,g.ballot.id]))});
await fixture.cmd(0,'close_vote',projector.id);
const tokens=new Map();
const qaPhotos=new Map();
const session=(index)=>{
 const uid=fixture.users[index];const now=Math.floor(Date.now()/1000);const token=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',role:'authenticated',session_id:uid,iat:now,exp:now+3600},'LOCAL_QA_ONLY'].map((v,i)=>i===2?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 tokens.set(token,index);return {access_token:token,refresh_token:'local-'+uid,expires_in:3600,expires_at:now+3600,token_type:'bearer',user:{id:uid,aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{provider:'anonymous'},user_metadata:{},identities:[],created_at:new Date().toISOString()}};
};
const handler=async(req,res)=>{
 const origin=req.headers.origin;if(origin&&ports.some(port=>origin==='http://127.0.0.1:'+port||origin==='http://localhost:'+port))res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,'http://127.0.0.1');
 try{
  if(process.env.TNO_QA_NEW_FLOW==='true'&&url.pathname.startsWith('/storage/v1/object/')){
   const index=tokens.get((req.headers.authorization||'').replace(/^Bearer /,''));if(index===undefined)throw new Error('Sign in required');
   const path=url.pathname.split('/').at(-1);
   if(req.method==='POST'){
    const chunks=[];let size=0;for await(const chunk of req){chunks.push(chunk);size+=chunk.length;if(size>5242880)throw new Error('Photo exceeds 5 MB');}
    if(req.headers['content-type']!=='image/jpeg')throw new Error('JPEG required');
    await fixture.queryAs(index,"insert into storage.objects(bucket_id,name,metadata) values('murder-evidence',$1,$2)",[path,JSON.stringify({size,mimetype:'image/jpeg'})]);qaPhotos.set(path,Buffer.concat(chunks));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({Key:'murder-evidence/'+path}));return;
   }
   if(req.method==='GET'){
    const rows=(await fixture.queryAs(index,"select name from storage.objects where bucket_id='murder-evidence' and name=$1",[path])).rows;if(!rows.length||!qaPhotos.has(path))throw new Error('Photo unavailable');res.setHeader('Content-Type','image/jpeg');res.end(qaPhotos.get(path));return;
   }
   throw new Error('Unsupported evidence operation');
  }
  if(url.pathname.startsWith('/auth/v1/')||url.pathname.startsWith('/rest/v1/rpc/')){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw new Error('Request too large');}const args=body?JSON.parse(body):{};
   const index=tokens.get((req.headers.authorization||'').replace(/^Bearer /,''));
   let value;
   if(url.pathname==='/auth/v1/signup'){
    const uid=crypto.randomUUID();const i=fixture.users.length;fixture.users.push(uid);
    await fixture.queryAs(-1,'insert into auth.users values($1,null,null)',[uid]);await fixture.queryAs(-1,'insert into auth.sessions values($1,$1)',[uid]);value=session(i);
   }else if(url.pathname==='/auth/v1/token'){
    const i=fixture.users.indexOf(String(args.refresh_token).replace('local-',''));if(i<0)throw new Error('Invalid session');value=session(i);
   }else if(url.pathname==='/auth/v1/user'){if(index===undefined)throw new Error('Sign in required');value=session(index).user;
   }else if(url.pathname==='/auth/v1/logout'){if(index!==undefined)await fixture.queryAs(-1,'delete from auth.sessions where user_id=$1',[fixture.users[index]]);value={};
   }else{
    const name=url.pathname.split('/').pop();if(!['tno_login','tno_logout','tno_snapshot','tno_command','tno_board','tno_export','tno_recover','tno_roster'].includes(name))throw new Error('Unknown API');
    value=await fixture.rpc(index===undefined?null:index,name,args);
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
  }
  const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/'))throw new Error('Invalid path');
  let data=await readFile(path);const ext=extname(path);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[ext]||'application/octet-stream');
  // Only the QA copy is allowed to reach the fixture on the other local origin.
  if(ext==='.html')data=Buffer.from(data.toString().replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:4175"));
  res.end(data);
 }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:error.message,error:error.message}));}
};
for(const port of ports)createServer(handler).listen(port,'127.0.0.1');
console.log('QA ONLY: '+ports.map(port=>'http://127.0.0.1:'+port).join(', '));
console.log('Fixture logins: Host / 0123; Person 1..52 / 0123. Rehearsal '+practice.id+'. No real Supabase accounts used.');

// Optional timed fixture publication lets the board be observed without browser dialogs.
const revealDelay=Number(process.env.TNO_QA_REVEAL_DELAY||0);
console.log('Projector fixture: http://127.0.0.1:'+ports[0]+'/projector.html#'+(await fixture.snap(0,projector.id)).display_token);
if(revealDelay>0)setTimeout(async()=>{
 const state=await fixture.snap(0,projector.id);const reveal=state.reveals.find(r=>!r.published);
 await fixture.cmd(0,'publish',projector.id,{group:reveal.group_id,reveal:reveal.id});
 console.log('QA elimination published once.');
},revealDelay);

// Optional local-only input for repeatable animation inspection.
if(process.env.TNO_QA_INTERACTIVE==='true'){
 const {createInterface}=await import('node:readline');
 createInterface({input:process.stdin}).on('line',async line=>{
  if(line.trim()==='first-expire'){await fixture.queryAs(-1,"update private.first_murder_rounds set chat_until=clock_timestamp()-interval '1 second' where event_id=$1",[id]);console.log('QA private chat advanced.');return;}
  if(line.trim()!=='reveal')return;
  const state=await fixture.snap(0,projector.id),reveal=state.reveals.find(r=>!r.published);
  if(!reveal){console.log('No pending fixture outcome.');return;}
  await fixture.cmd(0,'publish',projector.id,{group:reveal.group_id,reveal:reveal.id});
  console.log('QA fixture reveal published once.');
 });
}
