import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {missionPlan,missionTimetable,missionPlanId} from '../src/mission-plan.js';
import {missionCards,missionPlanReview,privateMissionPack} from '../src/mission-review.js';
import {cadetMission} from '../src/event-presentation.js';
const previous=['20261023203457_dramatic_four_group_schedule.sql','20261023211459_guard_event_admin_actions.sql','20261028164351_clarify_cadet_flow_and_joining.sql','20261028173202_actionable_group_controls_and_role_labels.sql'];
const migration='20261028205344_evidence_room_stages.sql';
// Synthetic sentinels, never the real private answer pack.
const material=[0,1,2].map(idx=>({idx,notes:`PRIVATE CLUES AND HINTS ${idx} `+'synthetic long pack '.repeat(300),answer:`PRIVATE SOLUTION ${idx}`,scoring:`PRIVATE MARKING ${idx}`}));
const apply=(s)=>({plan_id:missionPlanId,confirm:s.title,revision:s.timetable_revision,mission_revision:s.mission_revision,private_material:material});
async function setup(t){for(const name of previous)await t.db.exec(await readFile('supabase/migrations/'+name,'utf8'));}
async function install(t){await t.db.exec('reset role');await t.db.exec(await readFile('supabase/migrations/'+migration,'utf8'));}
async function invariant(t,id){return (await t.queryAs(-1,`select jsonb_build_object(
 'accounts',(select jsonb_agg(to_jsonb(a) order by id) from private.accounts a),
 'sessions',(select jsonb_agg(to_jsonb(s) order by auth_user) from private.sessions s),
 'players',(select jsonb_agg(to_jsonb(p) order by id) from public.players p where event_id=$1),
 'roles',(select jsonb_agg(to_jsonb(r) order by player_id) from public.player_secrets r join public.players p on p.id=r.player_id where p.event_id=$1),
 'groups',(select jsonb_agg(to_jsonb(g) order by id) from public.event_groups g where event_id=$1),
 'states',(select jsonb_agg(to_jsonb(g) order by group_id) from private.group_state g where event_id=$1),
 'ballots',(select jsonb_agg(to_jsonb(b) order by id) from private.ballots_v2 b where event_id=$1),
 'votes',(select jsonb_agg(to_jsonb(v) order by voter) from private.votes_v2 v join private.ballots_v2 b on b.id=v.ballot_id where b.event_id=$1),
 'scores',(select jsonb_agg(to_jsonb(s) order by group_id,mission) from private.mission_scores s where event_id=$1),
 'windows',(select jsonb_agg(to_jsonb(w) order by id) from private.murder_windows w where event_id=$1),
 'shields',(select jsonb_agg(to_jsonb(s) order by player_id,slot) from private.shields s where event_id=$1),
 'staff',(select jsonb_agg(to_jsonb(s) order by group_id,account_id) from private.staff s where event_id=$1),
 'game',(select to_jsonb(g) from private.games g where event_id=$1)) as data`,[id])).rows[0].data;}

test('mission migration is inert; applying is host-only, revision checked, atomic and limited to the selected event',async()=>{
 const t=await eventDatabase(28);try{
  await setup(t);const {id}=await t.cmd(0,'create',null,{title:'Preserved live',date:'2026-11-02',traitors:1});
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=24;i++)await t.cmd(i,'join');
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);await t.cmd(0,'mission',id,{mission:0});
  let s=await t.snap(0,id);await t.cmd(0,'assign_staff',id,{name:'Person 25',groups:[s.groups[0].id]});
  await t.cmd(0,'score',id,{group:s.groups[0].id,mission:0,points:40,reason:'Existing work'});
  await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);s=await t.snap(1,id);
  await t.cmd(1,'vote',id,{ballot:s.groups[0].ballot.id,target:s.players.find(p=>p.id!==s.me.id).id});
  const other=await t.cmd(0,'create',null,{title:'Other rehearsal',practice:true});const otherBefore=await t.snap(0,other.id);
  const before=await invariant(t,id);const cardsBefore=(await t.snap(0,id)).missions;
  await install(t);assert.deepEqual(await invariant(t,id),before);assert.deepEqual((await t.snap(0,id)).missions,cardsBefore);
  s=await t.snap(0,id);const args=apply(s);
  await assert.rejects(()=>t.cmd(25,'apply_mission_plan',id,args),/main host/);
  await assert.rejects(()=>t.cmd(26,'apply_mission_plan',id,args),/main host/);
  await assert.rejects(()=>t.cmd(0,'apply_mission_plan',id,{...args,revision:0}),/running order changed/);
  await assert.rejects(()=>t.cmd(0,'apply_mission_plan',id,{...args,mission_revision:0}),/mission cards changed/);
  await assert.rejects(()=>t.cmd(0,'apply_mission_plan',id,{...args,private_material:[material[0],material[0],material[2]]}),/Each stage/);
  assert.deepEqual(await invariant(t,id),before);
  await t.cmd(0,'apply_mission_plan',id,args);s=await t.snap(0,id);
  assert.deepEqual(await invariant(t,id),before);assert.deepEqual(s.timetable,missionTimetable);
  assert.deepEqual(s.missions.map(m=>[m.idx,m.title,m.minutes,m.max_points]),missionPlan.map(m=>[m.idx,m.title,m.minutes,m.max_points]));
  assert.equal(s.mission_plan_id,missionPlanId);
  const otherAfter=await t.snap(0,other.id);assert.deepEqual(otherAfter.timetable,otherBefore.timetable);assert.deepEqual(otherAfter.missions,otherBefore.missions);
  await assert.rejects(()=>t.cmd(0,'apply_mission_plan',id,args),/running order changed/);
  const changed=s.timetable.map(r=>r.id==='archive'?{...r,label:'Local archive time'}:r);
  await t.cmd(0,'timetable',id,{rows:changed,revision:s.timetable_revision});
  assert.deepEqual((await t.snap(0,other.id)).timetable,otherBefore.timetable);
  await assert.rejects(()=>t.cmd(0,'timetable',id,{rows:changed,revision:s.timetable_revision}),/running order changed/);
 }finally{await t.close();}
});

test('stage payloads protect notes and future evidence; scores replace safely within NCO group permissions',async()=>{
 const t=await eventDatabase(28);try{
  await setup(t);await install(t);const {id}=await t.cmd(0,'create',null,{title:'Permission fixture',traitors:1});
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=24;i++)await t.cmd(i,'join');
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  let s=await t.snap(0,id);await t.cmd(0,'apply_mission_plan',id,apply(s));s=await t.snap(0,id);
  await t.cmd(0,'assign_staff',id,{name:'Person 25',groups:[s.groups[0].id]});
  assert.deepEqual((await t.snap(1,id)).missions,[]);
  await t.cmd(0,'start_task',id,{row:'archive',revision:s.timetable_revision,group:s.groups[0].id});
  let cadet=await t.snap(1,id);assert.equal(cadet.missions.length,1);assert.equal(cadet.missions[0].idx,0);assert.equal(cadet.groups[0].remaining,1500);
  assert.ok(cadet.missions[0].equipment);assert.doesNotMatch(JSON.stringify(cadet),/PRIVATE|Final Review|new report/);
  for(const k of ['notes','answer','scoring'])assert.equal(k in cadet.missions[0],false);
  assert.deepEqual((await t.board(s.display_token)).missions,[]);
  await assert.rejects(()=>t.queryAs(1,'select * from private.missions'),/permission denied/);
  await assert.rejects(()=>t.queryAs(null,'select private.board_before_mission_plan($1)',[s.display_token]),/permission denied/);
  await assert.rejects(()=>t.queryAs(1,'select private.snapshot_before_mission_plan($1)',[id]),/permission denied/);
  const score={group:s.groups[0].id,mission:1,points:125,completed:true,reason:'Verified physical response'};
  for(const points of [-1,126,1.5,'1.2',null])await assert.rejects(()=>t.cmd(25,'score',id,{...score,points}),/points|limit|whole/);
  await assert.rejects(()=>t.cmd(1,'score',id,score),/permitted/);
  await assert.rejects(()=>t.cmd(25,'score',id,{...score,group:s.groups[1].id}),/permitted/);
  const request={cmd:'score',eid:id,args:{...score,request_id:crypto.randomUUID()}};
  await t.rpc(25,'tno_command',request);await t.rpc(25,'tno_command',request);await t.cmd(25,'score',id,score);
  s=await t.snap(0,id);assert.equal(s.groups[0].score,125);assert.equal(s.scores.filter(r=>r.group_id===score.group&&r.mission===1).length,1);
  assert.match(missionCards(s,score.group),/value="125"/);assert.match(missionCards(s,score.group),/replaces the saved total/);
  await t.cmd(0,'score',id,{...score,mission:2,points:100});assert.equal((await t.snap(0,id)).groups.find(g=>g.id===score.group).score,225);
  await t.cmd(0,'permissions',id,{permissions:[]});await assert.rejects(()=>t.cmd(25,'score',id,score),/permitted/);
  const first=s.missions[0];await t.cmd(0,'edit_mission',id,{...first,mission:0,mission_revision:s.mission_revision,answer:'Updated private marker'});
  await assert.rejects(()=>t.cmd(0,'edit_mission',id,{...first,mission:0,mission_revision:s.mission_revision}),/mission cards changed/);
  assert.equal((await t.snap(1,id)).missions[0].answer,undefined);
 }finally{await t.close();}
});

async function round(t,id){
 await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);let s=await t.snap(0,id);
 for(const g of s.groups.filter(g=>!g.done)){
  const candidate=s.players.find(p=>p.group===g.id&&p.status==='Active'&&p.role==='Faithful');
  for(const p of s.players.filter(p=>p.group===g.id&&p.status==='Active'&&p.id!==candidate.id)){
   const index=Number(p.account_name.replace('Person ',''));await t.cmd(index,'vote',id,{ballot:g.ballot.id,target:candidate.id});
  }
 }
 await t.cmd(0,'close_vote',id);s=await t.snap(0,id);
 for(const r of s.reveals.filter(r=>!r.published&&r.kind==='Banished'))await t.cmd(0,'publish',id,{group:r.group_id,reveal:r.id});
}
test('all timetable stage mappings work for one group and all groups; three rounds and two private murders remain',async()=>{
 const t=await eventDatabase(26);try{
  await setup(t);await install(t);const {id}=await t.cmd(0,'create',null,{title:'Schedule fixture',traitors:1});
  await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=24;i++)await t.cmd(i,'join');
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);let s=await t.snap(0,id);
  await t.cmd(0,'apply_mission_plan',id,apply(s));s=await t.snap(0,id);const revision=s.timetable_revision;
  await t.cmd(0,'start_task',id,{row:'archive',revision,group:s.groups[0].id});
  await t.cmd(0,'start_task',id,{row:'archive',revision});s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.mission===0&&g.remaining===1500&&g.active_task==='archive'));
  await round(t,id);await t.cmd(0,'start_task',id,{row:'murder1',revision});
  await t.cmd(0,'lock_murder',id);s=await t.snap(0,id);assert.equal((await t.board(s.display_token)).reveals.filter(r=>r.kind==='Murdered').length,0);
  for(const r of s.reveals.filter(r=>!r.published))await t.cmd(0,'publish',id,{group:r.group_id,reveal:r.id});
  await t.cmd(0,'start_task',id,{row:'vault',revision,group:s.groups[0].id});await t.cmd(0,'start_task',id,{row:'vault',revision});s=await t.snap(0,id);
  assert.ok(s.groups.every(g=>g.mission===1&&g.remaining===1200&&g.active_task==='vault'));
  assert.equal((await t.snap(1,id)).missions[0].idx,1);assert.doesNotMatch(JSON.stringify(await t.snap(1,id)),/Final Review|PRIVATE/);
  await t.cmd(0,'open_murder',id,{slot:1});s=await t.snap(0,id);
  assert.equal(s.windows.filter(w=>w.slot===1&&w.mode==='plain').length,4);
  for(const w of s.windows.filter(w=>w.slot===1)){
   const target=s.players.find(p=>p.group===w.group_id&&p.status==='Active'&&p.role==='Faithful');
   await t.cmd(0,'objective',id,{group:w.group_id,opportunity:w.id,target:target.id,text:'Synthetic supervised task'});
   await t.cmd(0,'confirm_objective',id,{group:w.group_id,opportunity:w.id,success:false,reason:'Not physically verified'});
  }
  const boardBefore=await t.board(s.display_token);assert.equal(boardBefore.reveals.filter(r=>r.kind==='Murdered').length,4);
  await round(t,id);s=await t.snap(0,id);
  for(const r of s.reveals.filter(r=>!r.published))await t.cmd(0,'publish',id,{group:r.group_id,reveal:r.id});
  await t.cmd(0,'start_task',id,{row:'break',revision});
  await t.cmd(0,'start_task',id,{row:'transmission',revision,group:s.groups[0].id});await t.cmd(0,'start_task',id,{row:'transmission',revision});s=await t.snap(0,id);
  assert.ok(s.groups.every(g=>g.mission===2&&g.remaining===900&&g.active_task==='transmission'));
  const review=await t.snap(1,id);assert.equal(review.missions[0].idx,2);assert.match(cadetMission(review),/Reopen the same case/);assert.doesNotMatch(JSON.stringify(review),/PRIVATE/);
  await round(t,id);s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.banishments===3));assert.equal(s.windows.length,8);assert.equal(s.scores.length,0);
 }finally{await t.close();}
});

test('private packs validate three unique complete stages and never appear in public plan code',async()=>{
 assert.deepEqual(privateMissionPack({private_material:material}),material);
 assert.throws(()=>privateMissionPack({private_material:[material[0],material[0],material[2]]}));
 assert.doesNotMatch(JSON.stringify(missionPlan),/PRIVATE SOLUTION|PRIVATE MARKING/);
 assert.equal(missionPlanReview({host:false}), '');
 const sql=await readFile('supabase/migrations/'+migration,'utf8');assert.doesNotMatch(sql,/PRIVATE SOLUTION|PRIVATE MARKING/);
});
