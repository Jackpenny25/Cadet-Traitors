import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {missionPlan,missionTimetable} from '../src/mission-plan.js';

test('revised defaults preserve existing events and create the full break order with current mission lengths',async()=>{
 const t=await eventDatabase(3);try{
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457').sort();
  const update=files.find(f=>f.endsWith('_break_2010_2030.sql'));
  for(const f of files.filter(f=>f<update))await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Preserved rehearsal',practice:true});
  const before=await t.snap(0,id);
  await t.db.exec('reset role');for(const f of files.filter(f=>f>=update))await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  const preserved=await t.snap(0,id);
  for(const key of ['timetable','timetable_revision','mission_revision','missions','players','groups','scores','reveals','windows'])assert.deepEqual(preserved[key],before[key],key);
  const {id:next}=await t.cmd(0,'create',null,{title:'New break plan',practice:true});
  const after=await t.snap(0,next);
  assert.deepEqual(after.timetable,missionTimetable);
  assert.deepEqual(after.missions.map(m=>[m.idx,m.minutes,m.max_points]),missionPlan.map(m=>[m.idx,m.minutes,m.max_points]));
  assert.match(after.missions[0].instructions,/access slip/);
  assert.match(after.missions[1].equipment,/envelope is optional/);
  assert.match(after.missions[2].equipment,/envelope is optional/);
  assert.doesNotMatch(after.missions[0].instructions,/envelope inside/);
  const row=id=>after.timetable.find(r=>r.id===id);
  assert.deepEqual([row('break').time,row('break').minutes],['20:10',20]);
  assert.deepEqual([row('murder1').time,row('murder1').minutes],['19:45',2]);
  assert.equal(row('first-results').time,'19:47');
  assert.ok(row('round2').time<row('task-reveal').time);
  assert.ok(row('task-close').time<'20:30');
  assert.equal(row('transmission').time,'20:43');
  assert.equal(row('parade').time,'21:15');
  await assert.rejects(()=>t.queryAs(1,'select private.default_timetable()'),/permission denied/);
 }finally{await t.close();}
});
