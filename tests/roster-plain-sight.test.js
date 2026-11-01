import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {fellowTraitors,plainPlayer,plainHost,plainTimetableControls,prepareEvidence} from '../src/plain-sight.js';
import {eventUpdates} from '../src/event-presentation.js';
const update='20261101212601_roster_and_plain_sight.sql';
async function previous(t){for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457'&&f<update).sort())await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));}
async function install(t){await t.db.exec('reset role');await t.db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);await t.db.exec(await readFile('supabase/migrations/'+update,'utf8'));await t.db.exec(await readFile('supabase/migrations/20261101221116_restrict_roster_rpc_privileges.sql','utf8'));}
async function invariant(t,id){return (await t.queryAs(-1,`select jsonb_build_object(
 'accounts',(select jsonb_agg(to_jsonb(a)-'roster_id' order by id) from private.accounts a),
 'players',(select jsonb_agg(to_jsonb(p) order by id) from public.players p where event_id=$1),
 'roles',(select jsonb_agg(to_jsonb(s) order by player_id) from public.player_secrets s join public.players p on p.id=s.player_id where p.event_id=$1),
 'votes',(select jsonb_agg(to_jsonb(v) order by voter) from private.votes_v2 v join private.ballots_v2 b on b.id=v.ballot_id where b.event_id=$1),
 'ballots',(select jsonb_agg(to_jsonb(b) order by id) from private.ballots_v2 b where event_id=$1),
 'scores',(select jsonb_agg(to_jsonb(s) order by group_id,mission) from private.mission_scores s where event_id=$1),
 'stage',(select jsonb_agg(jsonb_build_object('group',group_id,'phase',phase,'mission',mission,'banishments',banishments,'ballot',ballot,'opportunity',opportunity) order by group_id) from private.group_state where event_id=$1),
 'answers',(select jsonb_agg(jsonb_build_array(idx,answer,scoring,max_points) order by idx) from private.missions where event_id=$1)) as data`,[id])).rows[0].data;}

test('register review preserves identities and PINs, rejects unknown/duplicate variants, and maps the approved flight',async()=>{
 const t=await eventDatabase(7);try{
  await previous(t);await install(t);
  await t.queryAs(-1,"update private.accounts set name='Example J',name_key='example j' where id=$1",[t.users[1]]);
  const before=(await t.queryAs(-1,"select id,pin_hash from private.accounts where id=$1",[t.users[1]])).rows[0];
  let report=await t.rpc(0,'tno_roster',{action:'import',args:{confirm:'IMPORT CHECKED REGISTER',rows:[1,2,3,4].map(f=>({name:f===1?'Example J':'Register '+f,rank:f===1?'Cpl':'Cdt',flight:f,order:1}))}});
  assert.equal(report.enabled,false);assert.equal(report.accounts.length,6);
  await assert.rejects(()=>t.rpc(0,'tno_roster',{action:'activate'}),/Review every existing account/);
  await assert.rejects(()=>t.rpc(2,'tno_roster',{action:'report'}),/authorised host/);
  const rid=report.roster.find(r=>r.name==='Example J').id;
  await t.rpc(0,'tno_roster',{action:'link',args:{account:t.users[1],roster:rid,reason:'Confirmed existing test identity'}});
  await assert.rejects(()=>t.rpc(0,'tno_roster',{action:'link',args:{account:t.users[2],roster:rid,reason:'Duplicate attempt'}}),/Another account/);
  for(let i=2;i<7;i++)await t.rpc(0,'tno_roster',{action:'exclude',args:{account:t.users[i],reason:'Non-playing fixture account'}});
  await t.rpc(0,'tno_roster',{action:'activate'});
  assert.deepEqual((await t.queryAs(-1,'select id,pin_hash from private.accounts where id=$1',[t.users[1]])).rows[0],before);
  for(const variant of [' example  j ','EXAMPLE.J','Example-J']){
   await assert.rejects(()=>t.rpc(2,'tno_login',{display_name:variant,pin:'0123',register:true}),/An account already exists for this name. Please sign in or speak to your flight NCO./);
   assert.equal((await t.rpc(2,'tno_login',{display_name:variant,pin:'0123'})).name,'Example J');
  }
  await assert.rejects(()=>t.rpc(3,'tno_login',{display_name:'Unknown Z',pin:'0123',register:true}),/Name not found on the approved register/);
  // Independent incoming requests plus a unique roster FK and per-name advisory
  // lock guarantee a single claim. PGlite executes SQL on a single engine.
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  for(const uid of ids){t.users.push(uid);await t.queryAs(-1,'insert into auth.users values($1,null,null)',[uid]);await t.queryAs(-1,'insert into auth.sessions values($1,$1)',[uid]);}
  const attempts=await Promise.allSettled([t.rpc(7,'tno_login',{display_name:'Register.2',pin:'0123',register:true}),t.rpc(8,'tno_login',{display_name:' register 2 ',pin:'0123',register:true})]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.match(attempts.find(r=>r.status==='rejected').reason.message,/already exists/);
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.accounts where roster_id=(select id from private.master_roster where flight=2)')).rows[0].n,1);
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.hosts')).rows[0].n,1);
  const {id}=await t.cmd(0,'create',null,{title:'Register map',practice:true,traitors:1});await t.cmd(0,'joining',id,{open:true});
  await t.cmd(2,'join',id,{practice_event:id});const s=await t.snap(2,id);
  assert.equal(s.me.name,'Example J');assert.equal(s.groups[0].registered_flight,1);
  const oldPlayer=s.me.id;await t.cmd(2,'join',id,{practice_event:id});assert.equal((await t.snap(2,id)).me.id,oldPlayer);
  await assert.rejects(()=>t.queryAs(2,'select * from private.master_roster'),/permission denied/);
 }finally{await t.close();}
});

test('complete four-flight break sequence keeps voting/progress, private drafts, evidence, eligibility and reveals separate',async()=>{
 const t=await eventDatabase(36);try{
  await previous(t);
  const {id}=await t.cmd(0,'create',null,{title:'Break sequence fixture',practice:true,size:8,traitors:2});
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=32;i++)await t.cmd(i,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);await t.cmd(0,'mission',id,{mission:0});
  async function host(cmd,args={}){await t.queryAs(-1,"update private.request_limits set started=now()-interval '2 minutes' where account_id=$1",[t.users[0]]);return t.cmd(0,cmd,id,args);}
  async function emptyRound(){await host('discussion');await host('open_vote');await host('close_vote');for(const g of (await t.snap(0,id)).groups)await host('skip_ballot',{group:g.id});}
  await emptyRound();await host('open_murder',{slot:0});
  for(const w of (await t.snap(0,id)).windows)await host('lock_murder',{group:w.group_id,opportunity:w.id});
  for(const r of (await t.snap(0,id)).reveals.filter(r=>!r.published))await host('publish',{group:r.group_id,reveal:r.id});
  await host('mission',{mission:1});await host('discussion');await host('open_vote');
  const before=await invariant(t,id);await install(t);assert.deepEqual(await invariant(t,id),before);
  let s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.phase==='Voting'));assert.ok(s.groups.every(g=>g.next_step.next!=='open_murder'));
  const groups=s.groups;const actorFor=g=>Number(s.players.find(p=>p.group===g.id&&p.role==='Traitor').account_name.split(' ')[1]);
  const faithfulFor=g=>s.players.find(p=>p.group===g.id&&p.role==='Faithful');
  const first=groups[0],actor=actorFor(first),victim=faithfulFor(first);
  await host('assign_staff',{name:'Person 33',groups:[first.id]});
  for(const [i,g] of groups.entries()){
   await host('plain_save',{group:g.id,task:'PRIVATE TASK '+i,explanation:i===0?'required':'optional',photo:i===0?'required':'disabled',nco:i===0});
  }
  assert.equal((await t.snap(actor,id)).plain_tasks.length,0);assert.equal((await t.snap(33,id)).plain_tasks.length,0);
  s=await t.snap(0,id);const task=s.plain_tasks.find(t=>t.group===first.id);
  await host('plain_save',{group:first.id,revision:task.revision,task:'PRIVATE TASK revised',explanation:'required',photo:'required',nco:true});
  await assert.rejects(()=>host('plain_save',{group:first.id,revision:task.revision,task:'Stale overwrite',explanation:'required',photo:'required'}),/draft changed/);
  const saved=(await t.snap(0,id)).plain_tasks.find(t=>t.group===first.id);
  assert.equal(saved.draft,'PRIVATE TASK revised');
  for(const task of (await t.snap(0,id)).plain_tasks){await host('plain_send',{group:task.group,revision:task.revision});await host('plain_send',{group:task.group,revision:task.revision});}
  assert.deepEqual(await invariant(t,id),before);
  let a=await t.snap(actor,id);assert.equal(a.plain_tasks.length,1);assert.equal(a.plain_tasks[0].task,'PRIVATE TASK revised');assert.ok(!('draft' in a.plain_tasks[0]));
  assert.equal((await t.snap(Number(victim.account_name.split(' ')[1]),id)).plain_tasks.length,0);
  assert.ok(!JSON.stringify(await t.board(s.display_token)).includes('PRIVATE TASK'));
  assert.equal((await t.snap(33,id)).plain_tasks.length,1);
  assert.equal((await t.snap(33,id)).plain_tasks[0].group,first.id);
  const fellows=a.fellows;assert.equal(fellows.length,1);assert.ok(fellows.every(p=>a.players.find(x=>x.id===p.id).group===first.id));
  for(const g of groups)await host('plain_open',{group:g.id});
  assert.deepEqual(await invariant(t,id),before);
  a=await t.snap(actor,id);assert.equal(a.plain_tasks[0].state,'open');
  await assert.rejects(()=>t.cmd(actor,'plain_submit',id,{group:first.id,target:victim.id,explanation:'Physical action'}),/requires a photograph/);
  await assert.rejects(()=>t.cmd(actor,'plain_submit',id,{group:first.id,target:a.me.id,explanation:'Wrong victim'}),/active Faithful/);
  await assert.rejects(()=>t.cmd(actor,'plain_submit',id,{group:first.id,target:faithfulFor(groups[1]).id,explanation:'Wrong flight'}),/active Faithful/);
  const upload=await t.cmd(actor,'plain_upload',id,{group:first.id,target:victim.id});
  await assert.rejects(()=>t.queryAs(Number(victim.account_name.split(' ')[1]),"insert into storage.objects(bucket_id,name,metadata) values('murder-evidence',$1,'{}')",[upload.path]),/row-level security/);
  await t.queryAs(actor,"insert into storage.objects(bucket_id,name,metadata) values('murder-evidence',$1,'{\"size\":900,\"mimetype\":\"image/jpeg\"}')",[upload.path]);
  const submission={group:first.id,target:victim.id,explanation:'Physical task completed with this named person',photos:[upload.upload]};
  await t.cmd(actor,'plain_submit',id,submission);await t.cmd(actor,'plain_submit',id,submission);
  assert.equal((await t.snap(0,id)).players.find(p=>p.id===victim.id).status,'Active');
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.plain_submissions')).rows[0].n,1);
  assert.equal((await t.queryAs(33,"select count(*)::int as n from storage.objects where name=$1",[upload.path])).rows[0].n,1);
  assert.equal((await t.queryAs(Number(victim.account_name.split(' ')[1]),"select count(*)::int as n from storage.objects where name=$1",[upload.path])).rows[0].n,0);
  assert.equal((await t.queryAs(actorFor(groups[1]),"select count(*)::int as n from storage.objects where name=$1",[upload.path])).rows[0].n,0);
  await host('plain_close',{group:first.id});await host('plain_close',{group:first.id});
  await assert.rejects(()=>t.cmd(actor,'plain_upload',id,{group:first.id,target:victim.id}),/closed/);
  await t.cmd(33,'plain_verify',id,{group:first.id,reason:'Confirmed physical action'});
  await assert.rejects(()=>t.cmd(33,'plain_review',id,{group:first.id,decision:'approved',reason:'NCO cannot approve'}),/Only FS Penny/);
  await host('plain_review',{group:first.id,decision:'approved',reason:'Host checked the task, person and photo'});await host('plain_review',{group:first.id,decision:'approved',reason:'Retry'});
  const privateReceipt=(await t.snap(actor,id)).plain_tasks[0];assert.equal(privateReceipt.outcome,null);assert.ok(!('decision' in privateReceipt.submission));assert.ok(!('decision_reason' in privateReceipt.submission));
  const reviewState=await t.snap(0,id);let r=reviewState.reveals.find(r=>r.opportunity===reviewState.plain_tasks.find(t=>t.group===first.id).opportunity);
  await assert.rejects(()=>host('publish',{group:first.id,reveal:r.id}),/Finish round table 2/);
  // Remaining flights exercise optional, disabled and missing evidence paths.
  for(const g of groups.slice(1)){
   if(g!==groups[3])await t.cmd(actorFor(g),'plain_submit',id,{group:g.id,target:faithfulFor(g).id,explanation:''});
   await host('plain_close',{group:g.id});await host('plain_review',{group:g.id,decision:'rejected',reason:'Reject fixture attempt / no valid report'});
  }
  await host('close_vote');for(const g of groups)await host('skip_ballot',{group:g.id});
  s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.banishments===2));
  await assert.rejects(()=>host('mission',{mission:2}),/Finish the break task/);
  await assert.rejects(()=>host('start_task',{row:'transmission',revision:s.timetable_revision}),/Finish the break task/);
  const prior=await t.board(s.display_token);assert.equal(prior.players.find(p=>p.id===victim.id).status,'Active');
  for(const task of s.plain_tasks){const reveal=s.reveals.find(r=>r.opportunity===task.opportunity);await host('publish',{group:task.group,reveal:reveal.id});await host('publish',{group:task.group,reveal:reveal.id});}
  s=await t.snap(0,id);assert.equal(s.players.find(p=>p.id===victim.id).status,'Murdered');
  assert.equal(s.reveals.filter(r=>r.kind==='Murdered'&&r.target===victim.id).length,1);
  await host('start_task',{row:'transmission',revision:s.timetable_revision});assert.ok((await t.snap(0,id)).groups.every(g=>g.mission===2));
  await t.queryAs(-1,"update public.players set status='Banished' where id=$1",[fellows[0].id]);
  a=await t.snap(actor,id);assert.equal(a.fellows[0].status,'Banished');
  await t.queryAs(-1,"update public.players set status='Banished' where user_id=$1",[t.users[actor]]);
  assert.deepEqual((await t.snap(actor,id)).fellows,[]);assert.deepEqual((await t.snap(actor,id)).plain_tasks,[]);
  assert.equal((await t.queryAs(actor,"select count(*)::int as n from storage.objects where name=$1",[upload.path])).rows[0].n,0);
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.group_state where deadline is not null or remaining<>0 or paused')).rows[0].n,0);
  const recovery=await t.rpc(0,'tno_export',{eid:id});assert.equal(recovery.plain_tasks.length,4);assert.ok(recovery.plain_submissions.length);assert.equal(recovery.private_evidence_metadata.length,1);
  const helpers=(await t.queryAs(-1,"select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('roster_report','plain_can_read','plain_valid_target','game_command_before_plain_tasks','snapshot_before_plain_tasks','recovery_export_before_tasks','board_before_register') and has_function_privilege('authenticated',p.oid,'execute')")).rows;assert.deepEqual(helpers,[]);
 }finally{await t.close();}
});

test('private task UI and notifications show only authorised data; unsupported phone photos get a useful remedy',async()=>{
 const t={id:'t',group:'g',state:'sent',task:'Private action',sent_at:new Date().toISOString(),submission:null};
 const state={roles_released:true,organiser:false,me:{id:'p',group:'g',role:'Traitor',status:'Active'},fellows:[{name:'Other T',status:'Banished'}],plain_tasks:[t],players:[],groups:[],messages:[],reveals:[]};
 assert.match(fellowTraitors(state),/Meet your fellow Traitors/);assert.doesNotMatch(fellowTraitors(state),/Other T/);assert.match(fellowTraitors(state,true),/Banished/);
 assert.match(plainPlayer(state),/Private action/);assert.equal(plainPlayer({...state,me:{...state.me,role:'Faithful'}}),'');
 assert.equal(fellowTraitors({...state,me:{...state.me,status:'Murdered'}},true),'');assert.equal(plainHost(state),'');
 const hostState={...state,host:true,organiser:true,groups:[{id:'g',name:'1 Flight',mission:1}],plain_tasks:[{...t,state:'draft',revision:2}]};
 assert.match(plainTimetableControls(hostState,{id:'task-send'}),/Send private task: 1 Flight/);assert.doesNotMatch(plainTimetableControls(hostState,{id:'task-send'}),/start_task/);
 assert.ok(eventUpdates({...state,id:'e',plain_tasks:[]},{...state,id:'e'}).some(n=>n.title==='New private flight task'));
 await assert.rejects(()=>prepareEvidence({size:20000001,type:'image/jpeg'}),/smaller than 20 MB/);
 await assert.rejects(()=>prepareEvidence({size:12,type:'application/pdf'}),/Choose a photograph/);
});

test('shielded, withdrawn and already eliminated victims never get silently replaced',async()=>{
 const t=await eventDatabase(20);try{
  await previous(t);await install(t);
  const {id}=await t.cmd(0,'create',null,{title:'Eligibility fixture',practice:true,size:5,traitors:1});
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=16;i++)await t.cmd(i,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  await t.queryAs(-1,"update private.group_state set mission=1,banishments=1,phase='Mission' where event_id=$1",[id]);
  assert.ok((await t.snap(0,id)).groups.every(g=>g.next_step.next==='discussion'),'Round table 2 does not require finishing the second objective first');
  // Focus this fixture on task eligibility after the second round table.
  await t.queryAs(-1,"update private.group_state set mission=1,banishments=2,phase='Closed' where event_id=$1",[id]);
  await t.queryAs(-1,'update private.event_settings set shields=true where event_id=$1',[id]);
  let s=await t.snap(0,id);const groups=s.groups;
  for(const [i,g] of groups.entries()){
   const actor=s.players.find(p=>p.group===g.id&&p.role==='Traitor');const victim=s.players.find(p=>p.group===g.id&&p.role==='Faithful');
   await t.cmd(0,'plain_save',id,{group:g.id,task:'Synthetic physical action',explanation:'disabled',photo:'disabled',nco:false});
   let task=(await t.snap(0,id)).plain_tasks.find(t=>t.group===g.id);
   await t.cmd(0,'plain_send',id,{group:g.id,revision:task.revision});await t.cmd(0,'plain_open',id,{group:g.id});
   const actorIndex=Number(actor.account_name.split(' ')[1]);
   await assert.rejects(()=>t.cmd(actorIndex,'plain_upload',id,{group:g.id,target:victim.id}),/Photo evidence is disabled/);
   await t.cmd(actorIndex,'plain_submit',id,{group:g.id,target:victim.id,explanation:'',photos:[]});
   await t.cmd(0,'plain_close',id,{group:g.id});
   if(i===0)await t.cmd(0,'shield',id,{group:g.id,player:victim.id,slot:1});
   if(i===1){await t.queryAs(-1,"update public.players set status='Withdrawn' where id=$1",[victim.id]);await assert.rejects(()=>t.cmd(0,'plain_review',id,{group:g.id,decision:'approved',reason:'Invalid withdrawn person'}),/no longer an active Faithful/);}
   await t.cmd(0,'plain_review',id,{group:g.id,decision:i===1?'rejected':'approved',reason:'Checked evidence and eligibility'});
   task=(await t.snap(0,id)).plain_tasks.find(t=>t.group===g.id);let r=(await t.snap(0,id)).reveals.find(r=>r.opportunity===task.opportunity);
   if(i===0){assert.equal(r.target,null);assert.equal((await t.queryAs(-1,'select consumed from private.shields where player_id=$1',[victim.id])).rows[0].consumed,true);}
   if(i===2){await t.queryAs(-1,"update public.players set status='Banished' where id=$1",[victim.id]);await assert.rejects(()=>t.cmd(0,'publish',id,{group:g.id,reveal:r.id}),/Void invalid outcome/);await t.cmd(0,'plain_void',id,{group:g.id,reason:'Victim was subsequently banished'});r=(await t.snap(0,id)).reveals.find(x=>x.id===r.id);assert.equal(r.target,null);}
   await t.cmd(0,'publish',id,{group:g.id,reveal:r.id});
   const after=await t.snap(0,id);assert.equal(after.players.filter(p=>p.group===g.id&&p.status==='Murdered').length,i===3?1:0);
   await t.queryAs(-1,"update private.request_limits set started=now()-interval '2 minutes' where account_id=$1",[t.users[0]]);
  }
 }finally{await t.close();}
});

test('an early private approval cannot deadlock round table 2 against its required later reveal',async()=>{
 const t=await eventDatabase(18);try{
  await previous(t);await install(t);
  const {id}=await t.cmd(0,'create',null,{title:'Early review fixture',practice:true,size:5,traitors:1});await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=16;i++)await t.cmd(i,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  await t.queryAs(-1,"update private.group_state set mission=1,banishments=1,phase='Mission' where event_id=$1",[id]);
  let state=await t.snap(0,id);const g=state.groups[0],actor=state.players.find(p=>p.group===g.id&&p.role==='Traitor'),victim=state.players.find(p=>p.group===g.id&&p.role==='Faithful');
  await t.cmd(0,'plain_save',id,{group:g.id,task:'Synthetic early attempt',explanation:'optional',photo:'disabled'});let task=(await t.snap(0,id)).plain_tasks[0];await t.cmd(0,'plain_send',id,{group:g.id,revision:task.revision});await t.cmd(0,'plain_open',id,{group:g.id});await t.cmd(Number(actor.account_name.split(' ')[1]),'plain_submit',id,{group:g.id,target:victim.id});await t.cmd(0,'plain_close',id,{group:g.id});await t.cmd(0,'plain_review',id,{group:g.id,decision:'approved',reason:'Early valid physical report'});
  state=await t.snap(0,id);assert.equal(state.groups.find(x=>x.id===g.id).next_step.next,'discussion');
  const reveal=state.reveals.find(r=>r.opportunity);await assert.rejects(()=>t.cmd(0,'publish',id,{group:g.id,reveal:reveal.id}),/Finish round table 2/);
  await t.cmd(0,'discussion',id,{group:g.id});await t.cmd(0,'open_vote',id,{group:g.id});await t.cmd(0,'close_vote',id,{group:g.id});await t.cmd(0,'skip_ballot',id,{group:g.id});
  await t.cmd(0,'publish',id,{group:g.id,reveal:reveal.id});await t.cmd(0,'mission',id,{group:g.id,mission:2});
  assert.equal((await t.snap(0,id)).players.find(p=>p.id===victim.id).status,'Murdered');
 }finally{await t.close();}
});

