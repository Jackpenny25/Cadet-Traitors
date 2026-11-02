import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {secondModeSettings,standardSecondControls} from '../src/second-murder.js';

async function fixture(){
 const t=await eventDatabase(28);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457').sort())await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await t.queryAs(-1,`insert into private.raf_quiz_bank values('raf-general-v1',$1,'Synthetic numerical estimate',100,'[]')`,[JSON.stringify([{id:'a',prompt:'Synthetic question A',answers:['private alpha']}])]);
 const {id}=await t.cmd(0,'create',null,{title:'Mode QA',practice:true,size:10,traitors:2});
 let s=await t.snap(0,id);
 await t.cmd(0,'configure',id,{title:'Mode QA',date:'2026-11-02',groups:s.groups.map(g=>({name:g.name,size:10,traitors:2})),chat:true,shields:true,second_murder_standard:true});
 s=await t.snap(0,id);
 await t.cmd(0,'joining',id,{open:true});
 for(let i=1;i<=24;i++)await t.cmd(i,'join',id,{practice_event:id});
 s=await t.snap(0,id);const group=s.groups[0].id;await t.cmd(0,'assign_staff',id,{name:'Person 25',groups:[group]});await t.cmd(0,'room_control',id,{group,enabled:true});
 assert.equal((await t.queryAs(-1,"select position('cmd=''publish'' and owner is distinct from uid and exists(select 1 from private.reveals r join private.murder_windows w' in pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure))>0 present")).rows[0].present,true);
 await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
 return {t,id,group};
}

test('normal second murder is selected in setup, preserves first quiz, and uses private target flow without task submission',async()=>{
 const {t,id,group}=await fixture();try{
  let state=await t.snap(0,id);assert.equal(state.second_murder_standard,true);assert.equal(state.second_mode_locked,false);assert.equal((await t.queryAs(-1,'select plain_slot from private.event_settings where event_id=$1',[id])).rows[0].plain_slot,null);
  assert.match(secondModeSettings(state),/first murder always keeps its RAF quiz/i);
  assert.match(standardSecondControls(state),/no RAF quiz or automatic chat window/i);
  await t.cmd(0,'second_murder_mode',id,{standard:false,expected:true});assert.equal((await t.snap(0,id)).second_murder_standard,false);
  await t.cmd(0,'second_murder_mode',id,{standard:true,expected:false});assert.equal((await t.snap(0,id)).second_murder_standard,true);
  await t.cmd(0,'mission',id,{group,mission:0});await t.cmd(0,'discussion',id,{group});await t.cmd(0,'open_vote',id,{group});await t.cmd(0,'close_vote',id,{group});await t.cmd(0,'skip_ballot',id,{group});
  await t.cmd(0,'open_murder',id,{group,slot:0});
  state=await t.snap(0,id);const first=state.first_murder?.find(r=>r.group===group);assert.ok(first);assert.equal(first.total,1);
  await t.queryAs(-1,"update private.first_murder_rounds set chat_until=clock_timestamp()-interval '1 second' where window_id=$1",[first.opportunity]);
  await t.snap(0,id);
  await t.cmd(0,'first_manual',id,{group,opportunity:first.opportunity,target:'',reason:'Close first murder quiz for test'});
  await t.cmd(0,'first_publish_quiz',id,{group,opportunity:first.opportunity});
  state=await t.snap(0,id);await t.cmd(0,'publish',id,{group,reveal:state.reveals.find(r=>r.opportunity===first.opportunity).id});
  await t.cmd(0,'mission',id,{group,mission:1});await t.cmd(0,'discussion',id,{group});await t.cmd(0,'open_vote',id,{group});await t.cmd(0,'close_vote',id,{group});await t.cmd(0,'skip_ballot',id,{group});
  await t.cmd(0,'open_murder',id,{group,slot:1});
  state=await t.snap(0,id);const second=state.windows.find(w=>w.group_id===group&&w.slot===1);assert.equal(second.mode,'standard',JSON.stringify({slot:second,settings:(await t.queryAs(-1,'select plain_slot,second_murder_standard from private.event_settings where event_id=$1',[id])).rows[0]}));assert.ok(state.first_murder.some(r=>r.group===group&&r.opportunity===first.opportunity));assert.equal(state.second_mode_locked,true);
  await assert.rejects(()=>t.cmd(25,'lock_murder',id,{group,opportunity:second.id}),/Only FS Penny/);
  const traitor=state.players.find(p=>p.group===group&&p.role==='Traitor');const faithful=state.players.find(p=>p.group===group&&p.role==='Faithful');
  await t.cmd(Number(traitor.account_name.replace('Person ','')),'propose',id,{opportunity:second.id,target:faithful.id});
  await t.cmd(0,'lock_murder',id,{group,opportunity:second.id});
  state=await t.snap(0,id);assert.equal(state.reveals.filter(r=>r.opportunity===second.id).length,1);assert.equal(state.reveals.find(r=>r.opportunity===second.id).target,faithful.id);
  const secondReveal=state.reveals.find(r=>r.opportunity===second.id);const guard=await t.queryAs(-1,"select (select owner_id from public.events where id=$1) owner,exists(select 1 from private.reveals r join private.murder_windows w on w.id=r.opportunity where r.id=$2 and w.slot=1 and w.mode='standard') matching",[id,secondReveal.id]);assert.ok(guard.rows[0].owner);assert.equal(guard.rows[0].matching,true);await assert.rejects(()=>t.cmd(25,'publish',id,{group,reveal:secondReveal.id}),/Only FS Penny/);await t.cmd(0,'publish',id,{group,reveal:secondReveal.id});
  await assert.rejects(()=>t.cmd(0,'second_murder_mode',id,{standard:false,expected:true}),/locked/i);
  assert.equal((await t.snap(Number(faithful.account_name.replace('Person ','')),id)).first_murder.some(r=>r.opportunity===second.id),false);
 }finally{await t.close();}
});

test('Murder in Plain Sight remains the default and its drafts remain unsent',()=>{
 const state={host:true,ended:false,second_murder_standard:false,second_mode_locked:false};
 assert.match(secondModeSettings(state),/Use a standard second murder/i);
 assert.doesNotMatch(standardSecondControls(state),/Open second murder/);
});
