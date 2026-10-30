import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {eventSnapshot,boardSnapshot} from '../src/event-contract.js';

test('timer removal preserves active voting and timetable times, then supports a complete manual four-group run',async()=>{
 const t=await eventDatabase(3);
 try{
  const migration='20261030142116_remove_game_countdowns.sql';
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457'&&f<migration).sort();
  for(const file of files)await t.db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Manual stages QA',practice:true,size:8,traitors:1});
  await t.cmd(0,'add_test_players',id,{target_total:24});
  await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  await t.cmd(0,'start_task',id,{row:'archive',revision:(await t.snap(0,id)).timetable_revision});
  await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await t.cmd(0,'pause',id);
  const before=await t.snap(0,id);
  await t.db.exec('reset role');await t.db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
  let s=eventSnapshot(await t.snap(0,id));
  assert.deepEqual(s.players,before.players);assert.deepEqual(s.timetable,before.timetable);
  assert.deepEqual(Object.fromEntries(s.groups.map(g=>[g.id,g.ballot.id])),Object.fromEntries(before.groups.map(g=>[g.id,g.ballot.id])));
  assert.ok(s.groups.every(g=>g.phase==='Voting'&&!('remaining' in g)&&!('paused' in g)&&!('deadline' in g)));
  assert.ok(!s.nco_permissions.includes('timer'));
  for(const cmd of ['pause','resume','extend'])await assert.rejects(()=>t.cmd(0,cmd,id),/timers have been removed/);
  await assert.rejects(()=>t.cmd(0,'permissions',id,{permissions:['timer']}),/Timer permissions have been removed/);
  await assert.rejects(()=>t.queryAs(1,'select private.game_command_before_timer_removal($1,$2,$3)',['resume',id,'{}']),/permission denied/);
  const targetFor=(state,g)=>state.players.find(p=>p.group===g&&p.status==='Active'&&p.role==='Faithful'&&p.account_name!=='Person 1');
  async function publishReady(){
   const state=await t.snap(0,id);
   for(const r of state.reveals.filter(r=>!r.published))await t.cmd(0,'publish',id,{group:r.group_id,reveal:r.id});
  }
  async function closeRound(){
   // A real round takes minutes. Advance only this local fixture's rate-limit
   // window so compressing a whole event into seconds does not exhaust it.
   await t.queryAs(-1,"update private.request_limits set started=now()-interval '2 minutes' where account_id=$1",[t.users[0]]);
   const state=await t.snap(0,id);
   for(const g of state.groups){
    const target=targetFor(state,g.id);const voter=state.players.find(p=>p.group===g.id&&p.status==='Active'&&p.id!==target.id);
    await t.cmd(0,'proxy_vote',id,{group:g.id,ballot:g.ballot.id,voter:voter.id,target:target.id,reason:'QA manual paper vote'});
   }
   const cadet=eventSnapshot(await t.snap(1,id));const g=cadet.groups[0];
   await t.cmd(1,'vote',id,{ballot:g.ballot.id,target:targetFor(await t.snap(0,id),g.id).id});
   await t.cmd(0,'close_vote',id);await publishReady();
  }
  await closeRound();await t.cmd(0,'open_murder',id,{slot:0});
  s=await t.snap(0,id);
  for(const w of s.windows.filter(w=>w.slot===0))await t.cmd(0,'lock_murder',id,{group:w.group_id,opportunity:w.id,target:targetFor(s,w.group_id).id,reason:'QA offline decision'});
  await publishReady();
  await t.cmd(0,'start_task',id,{row:'vault',revision:s.timetable_revision});
  await t.cmd(0,'open_murder',id,{slot:1});s=await t.snap(0,id);
  assert.ok(s.groups.every(g=>g.planning));
  for(const w of s.windows.filter(w=>w.slot===1)){
   await t.cmd(0,'objective',id,{group:w.group_id,opportunity:w.id,target:targetFor(s,w.group_id).id,text:'QA physical check'});
  }
  // Even a legacy write attempting to set an expired cutoff becomes inert.
  await t.queryAs(-1,"update private.murder_windows set deadline='2000-01-01' where event_id=$1",[id]);
  await t.queryAs(-1,"update private.group_state set paused=true,deadline='2000-01-01',remaining=5 where event_id=$1",[id]);
  assert.ok((await t.queryAs(-1,'select deadline from private.murder_windows where event_id=$1',[id])).rows.every(w=>w.deadline===null));
  for(const w of s.windows.filter(w=>w.slot===1))await t.cmd(0,'confirm_objective',id,{group:w.group_id,opportunity:w.id,success:true,reason:'Verified physically without a cutoff'});
  assert.ok((await t.snap(0,id)).windows.filter(w=>w.slot===1).every(w=>w.success===true&&!('deadline' in w)));
  await publishReady();
  await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await closeRound();
  await t.cmd(0,'start_task',id,{row:'transmission',revision:s.timetable_revision});
  await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await closeRound();
  await t.cmd(0,'finale',id);await t.cmd(0,'finish',id);
  s=eventSnapshot(await t.snap(0,id));assert.ok(s.ended);assert.ok(s.groups.every(g=>g.winner==='Traitors'));
  const board=boardSnapshot(await t.board(s.display_token));
  assert.ok(board.groups.every(g=>!('deadline' in g)&&!('remaining' in g)&&!('paused' in g)));
  assert.deepEqual(s.timetable,before.timetable);
  assert.ok((await t.queryAs(-1,'select deadline,remaining,paused from private.group_state where event_id=$1',[id])).rows.every(g=>g.deadline===null&&g.remaining===0&&g.paused===false));
 }finally{await t.close();}
});
