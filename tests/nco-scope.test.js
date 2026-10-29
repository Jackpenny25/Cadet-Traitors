import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';

test('NCO snapshots exclude other flights published outcomes and identify test actors without exposing helper access',async()=>{
 const t=await eventDatabase(3);
 try{
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457').sort();
  for(const file of files)await t.db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'NCO scope',practice:true,traitors:1});
  await t.cmd(0,'add_test_players',id,{target_total:24});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  let host=await t.snap(0,id);const group=host.groups[0].id;
  await t.cmd(0,'assign_staff',id,{name:'Person 1',groups:[group]});
  await t.cmd(0,'mission',id,{mission:0});await t.cmd(0,'discussion',id);
  await t.cmd(0,'open_vote',id);host=await t.snap(0,id);
  await t.cmd(0,'test_votes',id,{expected_ballots:Object.fromEntries(host.groups.map(g=>[g.id,g.ballot.id]))});
  await t.cmd(0,'close_vote',id);
  host=await t.snap(0,id);
  for(const reveal of host.reveals)await t.cmd(0,'publish',id,{group:reveal.group_id,reveal:reveal.id});
  host=await t.snap(0,id);const nco=await t.snap(1,id);
  assert.equal(host.reveals.length,4);assert.equal(nco.reveals.length,1);
  assert.ok(nco.reveals.every(r=>r.group_id===group));
  assert.ok(nco.players.every(p=>p.group===group&&p.test_player===true));
  const other=host.reveals.find(r=>r.group_id!==group);
  await assert.rejects(()=>t.cmd(1,'reveal_role',id,{group:other.group_id,reveal:other.id}),/permitted|assigned/);
  await assert.rejects(()=>t.queryAs(1,'select private.snapshot_before_nco_scope($1)',[id]),/permission denied/);
  await assert.rejects(()=>t.snap(2,id),/not a member/);
 }finally{await t.close();}
});
