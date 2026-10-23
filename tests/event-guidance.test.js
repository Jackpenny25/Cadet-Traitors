import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {roleReadiness} from '../src/event-readiness.js';
import {commandHelp,missionHelp,taskHelp} from '../src/event-help.js';
import {btn} from '../src/event-ui.js';
const schedule='supabase/migrations/20261023203457_dramatic_four_group_schedule.sql';
const guidance='supabase/migrations/20261023211459_guard_event_admin_actions.sql';
async function currentDatabase(n=4){const t=await eventDatabase(n);await t.db.exec(await readFile(schedule,'utf8'));await t.db.exec(await readFile(guidance,'utf8'));return t;}

test('control notes explain the saved activity and never include private mission answers',()=>{
 for(const cmd of ['discussion','open_vote','close_vote','runoff','random_draw','skip_ballot','reopen_ballot','planning','open_murder','lock_murder','pause','resume','extend','finale','joining','prepare_roles','release_roles','finish','announce','reset_roles','rotate_board','export','delete','add_test_players','test_votes'])assert.ok(commandHelp(cmd).length>40,cmd);
 const mission={idx:0,title:'Changed archive',instructions:'Find the paper clues.',equipment:'Envelope and padlock',minutes:17,answer:'PRIVATE ANSWER',notes:'PRIVATE STAFF NOTES'};
 const description=taskHelp({id:'archive',action:'mission',mission:0,label:'Custom task',minutes:12},[mission]);
 assert.match(description,/Changed archive/);assert.match(description,/paper clues/);assert.match(description,/12 minutes/);assert.ok(!description.includes('PRIVATE'));
 assert.match(taskHelp({id:'break',action:'activity',minutes:10}),/publish.*separately/);
 assert.match(commandHelp('joining',{open:true}),/Let registered/);assert.match(commandHelp('joining',{open:false}),/Stop new/);
 const html=btn('mission','Start',{},'disabled','A "quote" <script>');assert.match(html,/data-note="A &quot;quote&quot; &lt;script&gt;"/);assert.match(html,/About Start/);assert.match(html,/disabled/);
 assert.ok(!missionHelp(mission).includes('PRIVATE'));
});

test('readiness separates missing players, partial assignment and a released set of roles',()=>{
 const e={groups:[{id:'g',name:'Flight',traitors:2}],players:[],roles_released:false};
 assert.equal(roleReadiness(e).groups[0].needed,3);assert.equal(roleReadiness(e).canPrepare,false);
 e.players=[{id:'1',group:'g',status:'Active',role:'Traitor'}];assert.equal(roleReadiness(e).hasPrepared,true);assert.equal(roleReadiness(e).canRelease,false);
 e.players.push({id:'2',group:'g',status:'Active',role:'Traitor'},{id:'3',group:'g',status:'Active',role:'Faithful'});assert.equal(roleReadiness(e).canRelease,true);
 e.roles_released=true;assert.equal(roleReadiness(e).canRelease,false);assert.equal(roleReadiness(e).canPrepare,false);
});

test('rehearsal actors need no accounts, use normal role and vote rules, and stay out of live events',async()=>{
 const t=await currentDatabase();
 try{
  const live=await t.cmd(0,'create',null,{title:'Live'});const {id}=await t.cmd(0,'create',null,{title:'Solo rehearsal',practice:true});
  await assert.rejects(()=>t.cmd(0,'add_test_players',live.id,{count:12}),/separate rehearsal/);
  await assert.rejects(()=>t.cmd(1,'add_test_players',id,{count:12}),/main host/);
  await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});
  await t.cmd(0,'add_test_players',id,{minimum:true});let s=await t.snap(0,id);
  assert.equal(s.players.length,12);assert.equal(s.players.filter(p=>p.test_player).length,11);assert.ok(s.groups.every(g=>s.players.filter(p=>p.group===g.id).length===3));
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from auth.users')).rows[0].n,4);
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.accounts')).rows[0].n,4);
  await assert.rejects(()=>t.cmd(0,'add_test_players',id,{count:100}),/enough space/);
  await t.cmd(0,'prepare_roles',id);await assert.rejects(()=>t.cmd(0,'add_test_players',id,{count:1}),/Reset unreleased/);
  await t.cmd(0,'release_roles',id);s=await t.snap(0,id);assert.ok(s.roles_released);assert.ok(roleReadiness(s).groups.every(g=>g.ready));
  await assert.rejects(()=>t.rpc(0,'tno_recover',{eid:id,pid:s.players.find(p=>p.test_player).id,new_pin:'0456'}),/no login or PIN/);
  await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);s=await t.snap(0,id);
  const ballots=Object.fromEntries(s.groups.map(g=>[g.id,g.ballot.id]));
  const real=s.players.find(p=>!p.test_player),choice=s.players.find(p=>p.group===real.group&&p.id!==real.id);
  await t.cmd(1,'vote',id,{ballot:ballots[real.group],target:choice.id});
  await assert.rejects(()=>t.cmd(0,'test_votes',id,{expected_ballots:{}}),/ballot has changed/);
  await t.cmd(0,'test_votes',id,{expected_ballots:ballots});s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.votes_received===3));
  assert.equal((await t.snap(1,id)).me.vote,choice.id,'Generating test votes must preserve a real player’s saved choice');
  await t.cmd(0,'close_vote',id);s=await t.snap(0,id);const reveal=s.reveals[0];
  assert.ok((await t.board(s.display_token)).players.every(p=>p.status==='Active'));
  await t.cmd(0,'publish',id,{group:reveal.group_id,reveal:reveal.id});assert.ok((await t.board(s.display_token)).players.some(p=>p.status==='Banished'));
  await assert.rejects(()=>t.cmd(0,'delete',id,{}),/Type the event title/);
  await assert.rejects(()=>t.cmd(1,'delete',id,{confirm:'Solo rehearsal'}),/main host/);
  await assert.rejects(()=>t.cmd(0,'delete',id,{confirm:'Wrong event'}),/Type the event title/);
  await t.cmd(0,'delete',id,{confirm:'Solo rehearsal'});assert.ok((await t.snap(0)).live.id===live.id);assert.equal((await t.queryAs(-1,'select count(*)::int as n from public.players where event_id=$1',[id])).rows[0].n,0);
  assert.equal((await t.queryAs(-1,'select count(*)::int as n from private.accounts')).rows[0].n,4);
  await assert.rejects(()=>t.queryAs(1,"select private.game_command_with_schedule('create',null,'{}')"),/permission denied/);
 }finally{await t.close();}
});

test('registered names replace only placeholders, future joins use names, and manual all-Traitor files cannot be released',async()=>{
 const t=await eventDatabase(4);
 try{
  await t.db.exec(await readFile(schedule,'utf8'));
  await t.queryAs(-1,"update private.accounts set name='Harry',name_key='harry' where id=$1",[t.users[1]]);
  const {id}=await t.cmd(0,'create',null,{title:'Named players',practice:true});await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});await t.cmd(2,'join',id,{practice_event:id});
  let s=await t.snap(0,id);const custom=s.players.find(p=>p.account_name==='Person 2');await t.cmd(0,'callsign',id,{group:custom.group,player:custom.id,name:'Falcon',reason:'Approved callsign'});
  await t.queryAs(-1,'select 1');await t.db.exec(await readFile(guidance,'utf8'));s=await t.snap(0,id);
  assert.equal(s.players.find(p=>p.account_name==='Harry').name,'Harry');assert.equal(s.players.find(p=>p.id===custom.id).name,'Falcon');
  await t.cmd(3,'join',id,{practice_event:id});assert.equal((await t.snap(0,id)).players.find(p=>p.account_name==='Person 3').name,'Person 3');
  const broken=await t.cmd(0,'create',null,{title:'Manual roles',practice:true});await t.cmd(0,'add_test_players',broken.id,{count:8});s=await t.snap(0,broken.id);
  for(const p of s.players)await t.cmd(0,'manual_role',broken.id,{player:p.id,role:'Traitor'});
  await assert.rejects(()=>t.cmd(0,'release_roles',broken.id),/more active players/);
  await assert.rejects(()=>t.cmd(0,'start_task',broken.id,{row:'roles',revision:s.timetable_revision}),/more active players/);
 }finally{await t.close();}
});
