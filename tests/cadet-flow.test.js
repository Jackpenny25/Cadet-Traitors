import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {cadetSummary,cadetMission,currentTask,eventUpdates,controlIsCurrent,ballotProgress} from '../src/event-presentation.js';
import {sortSchedule} from '../src/event-theatre.js';
import {actionableError} from '../src/event-errors.js';
import {orderGroups,flightNames} from '../src/group-order.js';

const migrations=['20261023203457_dramatic_four_group_schedule.sql','20261023211459_guard_event_admin_actions.sql','20261028164351_clarify_cadet_flow_and_joining.sql'];
test('open rehearsal discovery, joining after release, scoped cadet snapshots and persistent stage identity',async()=>{
 const t=await eventDatabase(19);
 try{
  for(const name of migrations)await t.db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Rehearsal',practice:true,traitors:1});
  assert.deepEqual((await t.snap(1)).rehearsals,[]);
  await assert.rejects(()=>t.cmd(1,'joining',id,{open:true}),/main host/);
  await t.cmd(0,'joining',id,{open:true});
  assert.equal((await t.snap(1)).rehearsals[0].id,id);
  await assert.rejects(()=>t.cmd(1,'join',id),/separate rehearsal link/);
  for(let i=1;i<=12;i++)await t.cmd(i,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);
  await assert.rejects(()=>t.cmd(0,'joining',id,{open:true}),/unreleased roles/);
  await t.cmd(0,'release_roles',id);let host=await t.snap(0,id);const originalRoles=host.players.map(p=>[p.id,p.role]);
  await assert.rejects(()=>t.cmd(0,'open_murder',id,{slot:0}),/first round table.*open voting.*reveal the outcome/i);
  await assert.rejects(()=>t.cmd(13,'join',id,{practice_event:id}),/closed/);
  await t.cmd(0,'joining',id,{open:true});
  await t.cmd(13,'join',id,{practice_event:id});await t.cmd(13,'join',id,{practice_event:id});
  host=await t.snap(0,id);assert.equal(host.players.length,13);
  const late=await t.snap(13,id);assert.equal(late.me.role,'Faithful');assert.equal(late.me.name,'Person 13');
  assert.deepEqual(host.players.filter(p=>p.id!==late.me.id).map(p=>[p.id,p.role]),originalRoles);
  const rows=host.timetable;await t.cmd(0,'start_task',id,{row:'archive',revision:host.timetable_revision});
  let cadet=await t.snap(1,id);host=await t.snap(0,id);
  assert.equal(cadet.groups.length,1);assert.ok(cadet.players.every(p=>p.group===cadet.me.group));assert.equal(cadet.missions.length,1);assert.equal(cadet.missions[0].idx,0);assert.deepEqual(cadet.timetable,[]);
  assert.equal(host.groups.length,4);assert.equal(host.missions.length,3);assert.equal(host.timetable.length,rows.length);
  assert.equal(currentTask(cadet.groups[0],host.timetable),'archive');
  const moved=[...host.timetable];[moved[2],moved[3]]=[moved[3],moved[2]];
  assert.equal(currentTask(cadet.groups[0],moved),'archive');
  const reordered=sortSchedule(host.timetable.map(row=>row.id==='archive'?{...row,time:'19:05'}:row));
  await t.cmd(0,'timetable',id,{rows:reordered,revision:host.timetable_revision});
  host=await t.snap(0,id);assert.equal(host.timetable[1].id,'archive');assert.ok(host.groups.every(g=>g.active_task==='archive'));
  await t.cmd(0,'assign_staff',id,{name:'Person 14',groups:[host.groups[0].id]});
  await t.cmd(0,'permissions',id,{permissions:['discussion']});
  await t.cmd(14,'discussion',id,{group:host.groups[0].id});
  host=await t.snap(0,id);assert.equal(host.groups.filter(g=>g.active_task==='round1').length,1);
  for(const g of host.groups.filter(g=>g.phase==='Mission'))await t.cmd(0,'discussion',id,{group:g.id});cadet=await t.snap(1,id);assert.deepEqual(cadet.missions,[]);
  assert.equal(controlIsCurrent(cadet.groups[0],'discussion'),true);
  await t.cmd(0,'joining',id,{open:false});await assert.rejects(()=>t.cmd(15,'join',id,{practice_event:id}),/closed/);
  await assert.rejects(()=>t.queryAs(1,'select private.game_command_before_cadet_flow($1,$2,$3)',['joining',id,JSON.stringify({open:true})]),/permission denied/);
 }finally{await t.close();}
});

test('editing target times sorts rows without changing their times, durations or identities',()=>{
 const rows=[{id:'a',time:'19:00',minutes:10},{id:'b',time:'19:10',minutes:20},{id:'c',time:'19:05',minutes:5}];
 const sorted=sortSchedule(rows);assert.deepEqual(sorted.map(r=>r.id),['a','c','b']);assert.equal(sorted[1].time,'19:05');assert.equal(sorted[1].minutes,5);assert.equal(rows[1].id,'b');
 assert.deepEqual(sortSchedule([{id:'a',time:'19:00'},{id:'b',time:'19:00'}]).map(r=>r.id),['a','b']);
 const groups=flightNames.map((name,i)=>({id:String(i),name}));assert.deepEqual(orderGroups([...groups].reverse()),groups);
});

test('blocked controls explain concrete recovery steps without exposing organiser data to cadets',()=>{
 const error=new Error('Check this opportunity, phase and group eligibility.');
 const state={organiser:true,roles_released:true,groups:[{id:'g',name:'Phantom Flight',phase:'Mission',mission:0,banishments:0}],timetable:[{id:'murder1',action:'open_murder',slot:0}]};
 assert.match(actionableError(error,'start_task',{row:'murder1'},state),/complete the first round table.*close voting and reveal/i);
 assert.match(actionableError(error,'open_murder',{slot:1},state),/start The Evidence Room/i);
 assert.match(actionableError(error,'open_murder',{slot:1},{...state,roles_released:false}),/release the private envelopes/i);
 const voting={...state,groups:[{...state.groups[0],ballot:{status:'tie',runoff:false}}]};
 assert.match(actionableError(error,'open_murder',{slot:0},voting),/Start tied runoff/);
 assert.equal(actionableError(error,'open_murder',{}, {...state,organiser:false}),error.message);
 assert.match(actionableError(new Error('Failed to fetch'),'mission'),/try the same action again/i);
});

test('cadet presentation includes its current team and mission, omits clocks and keeps update popups stable',()=>{
 const state={id:'event',organiser:false,roles_released:true,me:{id:'p',group:'mine',status:'Active'},groups:[{id:'mine',name:'My team',mission:1,phase:'Mission',remaining:0,paused:false,deadline:'2026-01-01T00:00:00Z'},{id:'other',name:'Other team'}],missions:[{idx:0,title:'Future secret',instructions:'Not now'},{idx:1,title:'Current task',instructions:'Solve <clue>'}],messages:[],players:[],reveals:[]};
 assert.doesNotMatch(cadetSummary(state,Date.now()),/Other team|awaiting|data-clock|Paused|00:00/i);
 assert.match(cadetMission(state),/Current task/);assert.match(cadetMission(state),/Solve &lt;clue&gt;/);assert.doesNotMatch(cadetMission(state),/Future secret/);
 assert.deepEqual(eventUpdates(state,{...state,server_now:'later'}),[]);
 const next={...state,announcement:'Check your device',groups:[{...state.groups[0],phase:'Voting',ballot:{id:'b',status:'open'}}]};
 assert.deepEqual(eventUpdates(state,next).map(u=>u.title),['Announcement','Voting is open']);
 assert.equal(cadetMission(next),'');
 assert.deepEqual(eventUpdates(null,state),[]);
 const privateUpdate=eventUpdates(state,{...state,messages:[{id:1,body:'secret target',sender:'secret partner'}]});
 assert.doesNotMatch(JSON.stringify(privateUpdate),/secret target|secret partner/);
 const results={...state,ended:true,groups:[{...state.groups[0],phase:'Results',winner:'Traitors'},state.groups[1]]};
 assert.match(cadetSummary(results,Date.now()),/Traitors win/);
 assert.doesNotMatch(cadetSummary({...results,ended:false},Date.now()),/Traitors win/);
 assert.doesNotMatch(cadetSummary(results,Date.now()),/Other team/);
 assert.equal(currentTask({...results.groups[0],active_task:'archive'},[{id:'archive',action:'mission'},{id:'results',action:'finish'}]),'results');
 assert.equal(ballotProgress({ballot:{status:'open'},votes_received:6,eligible:6}),'6/6 votes received');
 assert.equal(ballotProgress({ballot:{status:'resolved'},votes_received:6,eligible:5}),'6 votes received');
 assert.equal(ballotProgress({ballot:null,votes_received:0,active:6}),'');
});
