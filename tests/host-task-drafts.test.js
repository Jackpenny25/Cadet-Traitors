import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {hostTaskDrafts} from '../src/plain-sight.js';

test('host-only drafts persist before an event, copy without sending or overwriting, and stay out of cadet/projector data',async()=>{
 const t=await eventDatabase(3);try{
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457').sort())await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  await assert.rejects(()=>t.rpc(1,'tno_task_drafts',{action:'report'}),/Only the main host/);
  let drafts;
  for(const flight of [1,2,3,4])drafts=await t.rpc(0,'tno_task_drafts',{action:'save',args:{flight,task:'PRIVATE SYNTHETIC FLIGHT '+flight,explanation:'required',photo:'optional',nco:false}});
  assert.equal(drafts.drafts.length,4);
  assert.match(hostTaskDrafts(drafts),/PRIVATE SYNTHETIC FLIGHT 1/);
  await assert.rejects(()=>t.rpc(0,'tno_task_drafts',{action:'save',args:{flight:1,revision:0,task:'Stale change',explanation:'required',photo:'optional'}}),/changed on another device/);
  const refreshed=await t.rpc(0,'tno_task_drafts',{action:'report'});assert.deepEqual(refreshed.drafts,drafts.drafts);
  const {id}=await t.cmd(0,'create',null,{title:'Draft copy fixture',practice:true,size:5,traitors:1});await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});
  const before=await t.snap(0,id);
  assert.equal((await t.rpc(0,'tno_task_drafts',{action:'copy',args:{event:id}})).copied,4);
  const after=await t.snap(0,id);assert.deepEqual(after.players,before.players);assert.deepEqual(after.groups,before.groups);assert.deepEqual(after.windows,before.windows);assert.deepEqual(after.reveals,before.reveals);
  assert.equal(after.plain_tasks.length,4);assert.ok(after.plain_tasks.every(t=>t.state==='draft'&&!t.sent_at));
  await t.rpc(0,'tno_task_drafts',{action:'save',args:{flight:1,revision:drafts.drafts[0].revision,task:'Changed host template',explanation:'disabled',photo:'disabled'}});
  assert.equal((await t.rpc(0,'tno_task_drafts',{action:'copy',args:{event:id}})).copied,0);
  assert.equal((await t.snap(0,id)).plain_tasks.find(t=>t.group===after.groups.find(g=>g.registered_flight===1).id).draft,'PRIVATE SYNTHETIC FLIGHT 1');
  assert.doesNotMatch(JSON.stringify(await t.snap(1,id)),/PRIVATE SYNTHETIC|Changed host template/);
  assert.doesNotMatch(JSON.stringify(await t.board(after.display_token)),/PRIVATE SYNTHETIC|Changed host template/);
  await assert.rejects(()=>t.queryAs(1,'select * from private.host_task_drafts'),/permission denied/);
 }finally{await t.close();}
});
