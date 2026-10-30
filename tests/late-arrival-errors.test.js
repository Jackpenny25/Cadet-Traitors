import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';

test('late-arrival errors identify the remedy without changing admission rules or leaking account existence to cadets',async()=>{
 const t=await eventDatabase(8);
 try{
  const migration='20261030140717_clarify_late_arrival_errors.sql';
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457'&&f<migration).sort();
  for(const file of files)await t.db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Late arrival QA',practice:true,size:3,traitors:1});
  await t.cmd(0,'add_test_players',id,{target_total:8});
  const before=await t.snap(0,id);const group=before.groups[0].id;
  await t.db.exec('reset role');await t.db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
  const after=await t.snap(0,id);
  assert.deepEqual(after.players,before.players);assert.deepEqual(after.groups,before.groups);
  await t.cmd(0,'assign_staff',id,{name:'Person 1',groups:[group]});
  const approve=(name,g=group,reason='NCO admitted late')=>t.cmd(0,'late_join',id,{name,group:g,reason});
  await assert.rejects(()=>approve('Unknown account'),/No registered account.*Create account/);
  await assert.rejects(()=>t.cmd(1,'late_join',id,{name:'Unknown account',group,reason:'Attempt'}),/Only the (main )?host/);
  await assert.rejects(()=>approve('Person 2',crypto.randomUUID()),/group belonging to this event/);
  await assert.rejects(()=>approve('Person 2',group,''),/reason between 1 and 200/);
  await assert.rejects(()=>approve('Person 1'),/assigned as an NCO.*remove its NCO assignments/);
  await assert.rejects(()=>approve('Host'),/host account cannot also be a player/);
  await approve('Person 2');
  await assert.rejects(()=>approve('Person 2'),/already has a player.*existing dashboard/);
  await assert.rejects(()=>approve('Person 3'),/is full \(3 players\).*another group with space/);
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  const released=await t.snap(0,id);const other=released.groups[1].id;
  await approve('Person 3',other);
  const admitted=await t.snap(0,id);
  assert.equal(admitted.players.find(p=>p.account_name==='Person 3').role,'Faithful');
  for(const p of released.players)assert.equal(admitted.players.find(a=>a.id===p.id).role,p.role);
  await t.queryAs(-1,'update private.group_state set done=true where group_id=$1',[other]);
  await assert.rejects(()=>approve('Person 4',other),/completed deduction.*still playing/);
  await assert.rejects(()=>t.queryAs(1,"select private.game_command_v4('late_join',$1,$2)",[id,JSON.stringify({name:'Person 4',group,reason:'Attempt'})]),/permission denied/);
 }finally{await t.close();}
});
