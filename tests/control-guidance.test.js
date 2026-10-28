import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {controlAvailability} from '../src/event-controls.js';
import {eliminationScene,eliminationDuration} from '../src/event-theatre.js';
import {installNotifications} from '../src/event-notifications.js';

const migrations=['20261023203457_dramatic_four_group_schedule.sql','20261023211459_guard_event_admin_actions.sql','20261028164351_clarify_cadet_flow_and_joining.sql','20261028173202_actionable_group_controls_and_role_labels.sql'];
test('state-aware controls prevent repeat rounds, explain empty ballots, keep batches atomic and preserve already-running groups',async()=>{
 const t=await eventDatabase(3);
 try{
  for(const name of migrations)await t.db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Control rehearsal',practice:true});
  await t.cmd(0,'add_test_players',id,{target_total:24});await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  await t.cmd(0,'mission',id,{mission:0});await t.cmd(0,'discussion',id);let s=await t.snap(0,id);const first=s.groups[0];
  await t.cmd(0,'open_vote',id,{group:first.id});s=await t.snap(0,id);const ballot=s.groups.find(g=>g.id===first.id).ballot.id;const deadline=s.groups.find(g=>g.id===first.id).deadline;
  const result=await t.cmd(0,'open_vote',id);assert.equal(result.groups_advanced,3);assert.equal(result.groups_unchanged,1);
  s=await t.snap(0,id);assert.equal(s.groups.find(g=>g.id===first.id).ballot.id,ballot);assert.equal(s.groups.find(g=>g.id===first.id).deadline,deadline);
  assert.equal(s.groups.find(g=>g.id===first.id).control_checks.open_vote_3.allowed,false);
  await assert.rejects(()=>t.cmd(0,'close_vote',id,{round:3}),/round table 3/);
  await t.cmd(0,'close_vote',id,{group:first.id});s=await t.snap(0,id);
  assert.equal(s.groups.find(g=>g.id===first.id).control_checks.open_murder_0.code,'ballot_empty');
  assert.equal(s.groups.find(g=>g.id===first.id).next_step.next,'reopen_ballot');assert.match(s.groups.find(g=>g.id===first.id).next_step.reason,/no votes.*Reopen empty ballot.*Skip empty ballot/i);
  const before=s.groups.map(g=>[g.id,g.phase,g.ballot.id]).sort();
  await assert.rejects(()=>t.cmd(0,'open_murder',id,{slot:0}),/Nothing has changed.*[\s\S]*no votes/);
  s=await t.snap(0,id);assert.deepEqual(s.groups.map(g=>[g.id,g.phase,g.ballot.id]).sort(),before);
  assert.equal(controlAvailability(s,'open_murder',{slot:0}).allowed,false);
  assert.match(controlAvailability(s,'open_murder',{slot:0}).reason,/no votes/);
  await t.cmd(0,'reopen_ballot',id,{group:first.id});s=await t.snap(0,id);
  await t.cmd(0,'test_votes',id,{expected_ballots:Object.fromEntries(s.groups.map(g=>[g.id,g.ballot.id]))});await t.cmd(0,'close_vote',id);s=await t.snap(0,id);
  assert.ok(s.groups.every(g=>g.next_step.next==='publish'));
  await assert.rejects(()=>t.cmd(0,'publish_ready',id,{kind:'ballot',round:1,expected_reveals:[]}),/pending outcomes changed/);
  assert.ok((await t.snap(0,id)).groups.every(g=>g.banishments===0));
  await t.cmd(0,'publish_ready',id,{kind:'ballot',round:1,expected_reveals:s.reveals.filter(r=>!r.published).map(r=>r.id)});s=await t.snap(0,id);
  assert.ok(s.groups.every(g=>g.banishments===1));
  await assert.rejects(()=>t.cmd(0,'discussion',id,{round:1}),/already at this stage|completed it/);
  assert.equal((await t.snap(0,id)).groups[0].ballot.status,'resolved');
  assert.ok(s.groups.every(g=>!g.control_checks.discussion_1.allowed));
  await t.cmd(0,'open_murder',id,{slot:0});s=await t.snap(0,id);assert.ok(s.windows.every(w=>w.status==='open'));
  assert.ok(s.groups.every(g=>g.control_checks.lock_murder.allowed));
  await assert.rejects(()=>t.cmd(0,'open_murder',id,{slot:0}),/already at this stage|completed it/);
  assert.equal((await t.snap(0,id)).windows.length,4);
 }finally{await t.close();}
});

test('all-groups skipping resolves only the remaining empty ballots without repeating completed rounds',async()=>{
 const t=await eventDatabase(2);
 try{
  for(const name of migrations)await t.db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Empty ballot rehearsal',practice:true});
  await t.cmd(0,'add_test_players',id,{target_total:24});await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);await t.cmd(0,'mission',id,{mission:0});await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await t.cmd(0,'close_vote',id);
  let s=await t.snap(0,id);await t.cmd(0,'skip_ballot',id,{group:s.groups[0].id,round:1});s=await t.snap(0,id);
  assert.equal(controlAvailability(s,'skip_ballot',{round:1}).allowed,true);
  const result=await t.cmd(0,'skip_ballot',id,{round:1});assert.equal(result.groups_advanced,3);assert.equal(result.groups_unchanged,1);
  s=await t.snap(0,id);assert.ok(s.groups.every(g=>g.banishments===1));assert.ok(s.groups.every(g=>g.next_step.next==='open_murder'));
 }finally{await t.close();}
});

test('role labels backfill and follow roster edits; database role changes remain private',async()=>{
 const t=await eventDatabase(2);
 try{
  for(const name of migrations.slice(0,3))await t.db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Named rehearsal',practice:true});await t.cmd(0,'joining',id,{open:true});await t.cmd(1,'join',id,{practice_event:id});
  await t.cmd(0,'add_test_players',id,{target_total:24});await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  let s=await t.snap(0,id);const player=s.players.find(p=>p.name==='Person 1');
  const roles=s.players.map(p=>[p.id,p.role]).sort();await t.queryAs(-1,'reset role');await t.db.exec(await readFile('supabase/migrations/'+migrations[3],'utf8'));
  s=await t.snap(0,id);assert.deepEqual(s.players.map(p=>[p.id,p.role]).sort(),roles);
  let row=(await t.queryAs(-1,'select * from public.player_secrets where player_id=$1',[player.id])).rows[0];
  assert.equal(row.player_name,'Person 1');assert.equal(row.player_number,player.number);assert.equal(row.event_name,'Named rehearsal');
  await t.cmd(0,'callsign',id,{group:player.group,player:player.id,name:'Harry',reason:'Use actual name'});
  row=(await t.queryAs(-1,'select * from public.player_secrets where player_id=$1',[player.id])).rows[0];assert.equal(row.player_name,'Harry');
  await t.queryAs(-1,"update public.event_groups set name='Ghost Flight' where id=$1",[player.group]);
  await t.queryAs(-1,"update public.player_secrets set role='Faithful' where player_name='Harry'");
  row=(await t.queryAs(-1,'select * from public.player_secrets where player_id=$1',[player.id])).rows[0];assert.equal(row.group_name,'Ghost Flight');assert.equal(row.role,'Faithful');
  const cadet=await t.snap(1,id);assert.equal(cadet.me.role,'Faithful');assert.ok(cadet.groups.every(g=>!g.control_checks&&!g.next_step));assert.ok(cadet.players.every(p=>!p.player_name));
  await assert.rejects(()=>t.queryAs(1,'select * from public.player_secrets'),/permission denied/);
  await assert.rejects(()=>t.queryAs(1,'select private.control_check($1,$2,$3,$4)',[id,player.group,'mission','{}']),/permission denied/);
 }finally{await t.close();}
});

test('dramatic reveal uses two complete crossing paths and escapes displayed names',()=>{
 const scene=eliminationScene({name:'<script>',status:'Banished'},{name:'Ghost Flight'});
 assert.match(scene,/&lt;script&gt;/);assert.doesNotMatch(scene,/class="verdict-cross"|<script>/);assert.match(scene,/M3 3 L97 27/);assert.match(scene,/M3 27 L97 3/);assert.ok(eliminationDuration>7000);
});

test('popups expire, deduplicate, pause for reading and dismiss immediately',()=>{
 class Element{
  constructor(){this.children=[];this.dataset={};this.events={};}
  setAttribute(){} append(...els){for(const el of els){el.parent=this;this.children.push(el);}} addEventListener(name,fn){this.events[name]=fn;}
  remove(){this.parent.children=this.parent.children.filter(el=>el!==this);} contains(el){return this===el||this.children.includes(el);}
 }
 const body=new Element(),doc={body,createElement:()=>new Element()};let time=0,serial=0;const jobs=new Map();
 const schedule=(fn,ms)=>{const id=++serial;jobs.set(id,{at:time+ms,fn});return id;},cancel=id=>jobs.delete(id);
 const tick=ms=>{time+=ms;for(const [id,job] of [...jobs])if(job.at<=time){jobs.delete(id);job.fn();}};
 const notifications=installNotifications(doc,{schedule,cancel}),region=body.children[0];
 notifications.show('Saved','Done');notifications.show('Saved','Done');assert.equal(region.children.length,1);tick(7000);assert.equal(region.children.length,0);
 notifications.show('Error','Read this',true);const card=region.children[0];tick(6000);card.events.pointerenter();tick(20000);assert.equal(region.children.length,1);card.events.pointerleave();tick(14000);assert.equal(region.children.length,0);
 notifications.show('Update','Ready');region.children[0].children[2].events.click();assert.equal(region.children.length,0);
});
