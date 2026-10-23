import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {EliminationQueue,moveSchedule,flightNames,roleEnvelope} from '../src/event-theatre.js';
const migration='supabase/migrations/20261023203457_dramatic_four_group_schedule.sql';

test('published eliminations queue once, hold their crosses, and survive a reload',()=>{
 const q=new EliminationQueue();q.update([{id:'old',status:'Murdered'},{id:'a',status:'Active'},{id:'b',status:'Active'}]);
 assert.ok(q.presented.has('old'));assert.equal(q.next(),undefined);
 q.update([{id:'old',status:'Murdered'},{id:'a',status:'Banished'},{id:'b',status:'Murdered'}]);
 assert.equal(q.presented.has('a'),false);assert.equal(q.next().id,'a');q.complete('a');assert.ok(q.presented.has('a'));
 q.update([{id:'a',status:'Banished'},{id:'b',status:'Murdered'}]);assert.equal(q.next().id,'b');assert.equal(q.next(),undefined);
 const reload=new EliminationQueue();reload.update([{id:'a',status:'Banished'}]);assert.ok(reload.presented.has('a'));assert.equal(reload.next(),undefined);
 const rows=[{id:'a',time:'19:00',minutes:10},{id:'b',time:'19:10',minutes:20},{id:'c',time:'19:30',minutes:5}];
 const moved=moveSchedule(rows,2,-1);assert.deepEqual(moved.map(r=>r.id),['a','c','b']);assert.deepEqual(moved.map(r=>r.time),['19:00','19:10','19:15']);assert.equal(rows[1].time,'19:10');
 assert.ok(!roleEnvelope({role:'Traitor',number:1},true,false).includes('Traitor'));
 assert.ok(roleEnvelope({role:'<script>',number:1},true,true).includes('&lt;script&gt;'));
});

test('four flight defaults, owner-wide saved order, stale protection and authorised task starts',async()=>{
 const t=await eventDatabase(16);
 try{
  await t.db.exec(await readFile(migration,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Night operations'});let s=await t.snap(0,id);
  assert.deepEqual(s.groups.map(g=>g.name).sort(),[...flightNames].sort());assert.ok(s.groups.every(g=>g.capacity===13));
  await assert.rejects(()=>t.cmd(0,'create',null,{practice:true,title:'Five',groups:5}),/four groups/);
  const practice=await t.cmd(0,'create',null,{practice:true,title:'Rehearsal'});
  const rows=moveSchedule(s.timetable,2,-1);await t.cmd(0,'timetable',id,{rows,revision:s.timetable_revision});
  s=await t.snap(0,id);assert.equal(s.timetable[1].id,'archive');assert.equal(s.timetable_revision,2);
  assert.deepEqual((await t.snap(0,practice.id)).timetable,rows);
  const future=await t.cmd(0,'create',null,{practice:true,title:'Future'});assert.deepEqual((await t.snap(0,future.id)).timetable,rows);
  await assert.rejects(()=>t.cmd(0,'start_task',id,{row:'archive',revision:1}),/changed on another device/);
  await assert.rejects(()=>t.cmd(1,'timetable',id,{rows,revision:2}),/main host/);
  await assert.rejects(()=>t.cmd(1,'start_task',id,{row:'briefing',revision:2}),/main host/);
  await t.cmd(0,'start_task',id,{row:'briefing',revision:2,action:'finish'});
  s=await t.snap(0,id);assert.equal(s.announcement,rows.find(r=>r.id==='briefing').label);assert.equal(s.ended,false);
  await assert.rejects(()=>t.cmd(0,'start_task',id,{row:'archive',revision:2}),/roles|role/i);
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=12;i++)await t.cmd(i,'join');
  await t.cmd(0,'assign_staff',id,{name:'Person 13',groups:[s.groups[0].id]});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'start_task',id,{row:'roles',revision:2});
  await t.cmd(0,'start_task',id,{row:'archive',revision:2});s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.phase==='Mission'&&g.mission===0));
  await assert.rejects(()=>t.cmd(13,'start_task',id,{row:'round1',revision:2}),/not permitted/);
  await t.cmd(0,'permissions',id,{permissions:['discussion']});
  await t.cmd(13,'start_task',id,{row:'round1',revision:2});s=await t.snap(0,id);
  assert.equal(s.groups.filter(g=>g.phase==='Discussion').length,1);
  const cadet=await t.snap(1,id);assert.ok(cadet.players.filter(p=>p.id!==cadet.me.id).every(p=>!p.account_name));
  const board=await t.board(s.display_token);assert.ok(board.players.every(p=>!p.role&&!p.account_name));
  await assert.rejects(()=>t.queryAs(1,'select * from private.host_preferences'),/permission denied/);
 }finally{await t.close();}
});

test('existing five-group rehearsal keeps players and assigned groups during consolidation',async()=>{
 const t=await eventDatabase(4);
 try{
  const {id}=await t.cmd(0,'create',null,{title:'Existing rehearsal',practice:true,groups:5,size:10,traitors:1});
  await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});let old=await t.snap(0,id);const player=old.players[0];
  await t.cmd(0,'assign_staff',id,{name:'Person 2',groups:[old.groups.find(g=>g.id!==player.group).id]});
  old=await t.snap(0,id);
  await t.queryAs(-1,'reset role');await t.db.exec(await readFile(migration,'utf8'));
  const next=await t.snap(0,id);assert.equal(next.groups.length,4);assert.deepEqual(next.players,old.players);assert.deepEqual(next.staff,old.staff);
  assert.ok(next.groups.some(g=>g.id===player.group));assert.ok(next.groups.every(g=>g.capacity>=13));
 }finally{await t.close();}
});
