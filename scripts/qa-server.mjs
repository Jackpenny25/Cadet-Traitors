// Local QA only. Real embedded Postgres, mocked Supabase Auth, no remote project writes.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {eventDatabase} from '../tests/runtime-helpers.js';
const root=resolve('work-before-simplify/qa-site');await mkdir(root,{recursive:true});
const fixture=await eventDatabase(53);
const ports=(process.env.TNO_QA_PORTS||'4185,4186').split(',').map(Number);
await fixture.db.exec(await readFile('supabase/migrations/20261023203457_dramatic_four_group_schedule.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261023211459_guard_event_admin_actions.sql','utf8'));
await fixture.db.exec(await readFile('supabase/migrations/20261028164351_clarify_cadet_flow_and_joining.sql','utf8'));
const {id}=await fixture.cmd(0,'create',null,{title:'2427: Trust No One',groups:4,size:13,traitors:2});
await fixture.cmd(0,'joining',id,{open:true});
for(let i=1;i<=50;i++)await fixture.cmd(i,'join');
await fixture.cmd(0,'assign_staff',id,{name:'Person 51',groups:[(await fixture.snap(0,id)).groups[0].id]});
await fixture.cmd(0,'prepare_roles',id);await fixture.cmd(0,'release_roles',id);await fixture.cmd(0,'mission',id,{mission:0});
const practice=await fixture.cmd(0,'create',null,{title:'Separate NCO rehearsal',practice:true,groups:4,size:13,traitors:2});
await fixture.cmd(0,'joining',practice.id,{open:true});
const projector=await fixture.cmd(0,'create',null,{title:'Projector animation check',practice:true});
await fixture.cmd(0,'add_test_players',projector.id,{target_total:24});
await fixture.cmd(0,'prepare_roles',projector.id);await fixture.cmd(0,'release_roles',projector.id);
await fixture.cmd(0,'mission',projector.id,{mission:0});await fixture.cmd(0,'discussion',projector.id);await fixture.cmd(0,'open_vote',projector.id);
await fixture.cmd(0,'test_votes',projector.id,{expected_ballots:Object.fromEntries((await fixture.snap(0,projector.id)).groups.map(g=>[g.id,g.ballot.id]))});
await fixture.cmd(0,'close_vote',projector.id);
const tokens=new Map();
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
    const name=url.pathname.split('/').pop();if(!['tno_login','tno_logout','tno_snapshot','tno_command','tno_board','tno_export','tno_recover'].includes(name))throw new Error('Unknown API');
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
