import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {boardCues,PresenterCues,presenterScene} from '../src/presenter-cues.js';
import {flightBoard,selectedFlights,flightPicker} from '../src/presenter-flights.js';
import {quizPopup,firstTraitor,firstMessages} from '../src/raf-quiz.js';

async function fixture(){
 const t=await eventDatabase(28);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457').sort())await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await t.queryAs(-1,`insert into private.raf_quiz_bank values('raf-general-v1',$1,'Synthetic numerical estimate',100,'[]')`,[JSON.stringify([{id:'a',prompt:'Synthetic question A',answers:['private alpha']},{id:'b',prompt:'Synthetic question B',answers:['private bravo']}])]);
 const {id}=await t.cmd(0,'create',null,{title:'RAF quiz QA',practice:true,size:10,traitors:2});
 await t.cmd(0,'joining',id,{open:true});for(let i=1;i<=24;i++)await t.cmd(i,'join',id,{practice_event:id});
 let s=await t.snap(0,id);const group=s.groups[0].id;
 await t.cmd(0,'assign_staff',id,{name:'Person 25',groups:[group]});
 await t.cmd(0,'room_control',id,{group,enabled:true});
 await assert.rejects(()=>t.cmd(25,'mission',id,{group,mission:0}),/permitted|roles|release/i);
 await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
 await t.cmd(0,'mission',id,{mission:0});await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await t.cmd(0,'close_vote',id);await t.cmd(0,'skip_ballot',id);
 s=await t.snap(0,id);
 const actor=p=>Number(p.account_name.replace('Person ',''));
 return {t,id,s,group,actor};
}

test('first murder has private 90-second chat, one durable decider, independent quiz scoring and shield-before-murder resolution',async()=>{
 const {t,id,s,group,actor}=await fixture();try{
  await t.cmd(25,'start_task',id,{group,row:'murder1',revision:s.timetable_revision});
  let host=await t.snap(0,id),round=host.first_murder[0];const wid=round.opportunity;
  const faithful=host.players.filter(p=>p.group===group&&p.role==='Faithful'),traitors=host.players.filter(p=>p.group===group&&p.role==='Traitor');
  const a=actor(faithful[0]),b=actor(faithful[1]),ta=actor(traitors[0]);
  const quiz=(await t.snap(a,id)).first_murder[0];assert.equal(quiz.questions.length,2);assert.equal(quiz.closed,false);
  assert.ok(!JSON.stringify(quiz).includes('private alpha'));assert.equal(quiz.decider,undefined);assert.equal(quiz.tie_answer,undefined);
  assert.equal((await t.snap(ta,id)).first_murder[0].questions,undefined);
  await assert.rejects(()=>t.queryAs(a,'select * from private.raf_quiz_bank'),/permission denied/);
  await assert.rejects(()=>t.queryAs(a,'select private.first_score($1)',[wid]),/permission denied/);
  await assert.rejects(()=>t.cmd(a,'message',id,{opportunity:wid,text:'Forbidden'}),/active Traitors/);
  await t.cmd(ta,'message',id,{opportunity:wid,text:'Coordinate privately'});
  assert.ok((await t.snap(actor(traitors[1]),id)).messages.some(m=>m.body==='Coordinate privately'));
  assert.equal((await t.snap(a,id)).messages.length,0);
  await assert.rejects(()=>t.cmd(ta,'first_choose',id,{opportunity:wid,target:faithful[0].id}),/90-second/);
  await assert.rejects(()=>t.cmd(0,'lock_murder',id),/automatically/);
  await t.cmd(a,'raf_answer',id,{opportunity:wid,tie:105});await t.cmd(b,'raf_answer',id,{opportunity:wid,tie:120});
  for(const index of [a,b])for(const [question,answer] of [['a','PRIVATE  alpha!'],['b','private bravo']])await t.cmd(index,'raf_answer',id,{opportunity:wid,question,answer});
  await assert.rejects(()=>t.cmd(ta,'raf_answer',id,{opportunity:wid,tie:100}),/only for active Faithful/);
  await t.queryAs(-1,"update private.first_murder_rounds set chat_until=clock_timestamp()-interval '1 second' where window_id=$1",[wid]);
  round=(await t.snap(0,id)).first_murder[0];assert.ok(round.decider);const selected=traitors.find(p=>p.id===round.decider),other=traitors.find(p=>p.id!==round.decider);
  assert.equal((await t.snap(actor(selected),id)).first_murder[0].can_choose,true);
  await assert.rejects(()=>t.cmd(actor(selected),'first_choose',id,{opportunity:wid,target:traitors[0].id}),/active Faithful/);
  await assert.rejects(()=>t.cmd(actor(selected),'first_choose',id,{opportunity:wid,target:host.players.find(p=>p.group!==group).id}),/active Faithful/);
  await assert.rejects(()=>t.cmd(actor(other),'first_choose',id,{opportunity:wid,target:faithful[0].id}),/randomly selected/);
  await assert.rejects(()=>t.cmd(actor(selected),'message',id,{opportunity:wid,text:'Too late'}),/chat has closed/);
  await t.queryAs(-1,'delete from private.sessions where auth_user=$1',[t.users[actor(selected)]]);
  await t.rpc(actor(selected),'tno_login',{display_name:selected.account_name,pin:'0123',register:false});
  assert.equal((await t.snap(actor(selected),id)).first_murder[0].selected,true);
  await t.cmd(actor(selected),'first_choose',id,{opportunity:wid,target:faithful[0].id});
  await t.cmd(actor(selected),'first_choose',id,{opportunity:wid,target:faithful[0].id});
  host=await t.snap(0,id);round=host.first_murder[0];assert.equal(round.closed,true);assert.equal(round.winner,faithful[0].id);assert.equal(round.score,2);
  assert.ok(host.players.every(p=>p.status==='Active'));assert.equal(host.windows.find(w=>w.id===wid).reason,'Shield blocked this attempt');
  assert.equal(host.reveals.filter(r=>r.opportunity===wid).length,1);assert.equal(host.reveals.find(r=>r.opportunity===wid).target,null);
  assert.equal((await t.snap(actor(selected),id)).first_murder[0].winner,undefined);
  const reveal=host.reveals.find(r=>r.opportunity===wid);
  await assert.rejects(()=>t.cmd(25,'publish',id,{group,reveal:reveal.id}),/quiz winner first/);
  await assert.rejects(()=>t.cmd(25,'first_manual',id,{opportunity:wid,target:faithful[1].id,reason:'Not authorised'}),/Only FS Penny/);
  await assert.rejects(()=>t.cmd(a,'raf_answer',id,{opportunity:wid,tie:100}),/has closed/);
  let board=await t.board(host.display_token);assert.equal(board.quiz_results.length,0);assert.equal(board.reveals.length,0);
  await t.cmd(25,'first_publish_quiz',id,{opportunity:wid});await t.cmd(25,'publish',id,{group,reveal:reveal.id});
  board=await t.board(host.display_token);assert.equal(board.quiz_results[0].winner,faithful[0].id);
  assert.deepEqual(boardCues(board).map(c=>c.type),['quiz','outcome']);assert.match(presenterScene(boardCues(board)[0]),/Protected from this murder/);
  assert.equal(board.quiz_results[0].answers,undefined);assert.equal(board.quiz_results[0].tie_answer,undefined);
  assert.equal((await t.snap(0,id)).groups.find(g=>g.id!==group).phase,'Closed');
 }finally{await t.close();}
});

test('flight presenter choices hide other flights, retain their unplayed cues, and cannot accidentally reveal from the selector',()=>{
 const board={groups:[{id:'a',name:'One'},{id:'b',name:'Two'}],players:[{id:'p',group:'b',status:'Murdered'}],reveals:[{id:'r',group:'b',target:'p',kind:'Murdered'}],quiz_results:[{id:'q',group:'b',winner:'p',name:'Winner',score:2,total:2}]};
 assert.deepEqual(selectedFlights(board,['missing']),['a','b']);assert.deepEqual(selectedFlights(board,['b','b']),['b']);
 const q=new PresenterCues();q.update(flightBoard(board,['a']));assert.equal(q.pending.length,0);
 q.update(flightBoard(board,['b']));assert.deepEqual(q.pending.map(c=>c.type),['quiz','elimination']);q.next();q.complete();
 q.update(flightBoard(board,['a']));assert.equal(q.pending.length,0);q.update(flightBoard(board,['b']));assert.equal(q.pending.length,1);
 assert.match(flightPicker(board,['a']),/type="checkbox"/);assert.match(flightPicker(board,['a']),/Choose at least one flight/);
 const faithful={me:{group:'a',role:'Faithful',status:'Active'},first_murder:[{group:'a',opportunity:'o',tie:null,tie_prompt:'Estimate',questions:[{id:'1',prompt:'Question'}],answers:{},closed:false}]};
 assert.match(quizPopup(faithful,-1),/required.*inputmode="numeric"/);assert.doesNotMatch(quizPopup(faithful,-1),/private alpha|tie_answer/);
 assert.equal(firstTraitor(faithful),'');assert.equal(quizPopup({...faithful,me:{...faithful.me,role:'Traitor'}}),'');
});

test('scores outrank estimates, exact ties draw once, manual recovery stays host-only and NCO rooms stay scoped',async()=>{
 const {t,id,s,group,actor}=await fixture();try{
  await t.cmd(0,'open_murder',id,{slot:0});let host=await t.snap(0,id);
  await t.queryAs(-1,"update private.first_murder_rounds set chat_until=clock_timestamp()-interval '1 second' where event_id=$1",[id]);
  for(const [i,g] of host.groups.entries()){
   const round=host.first_murder.find(r=>r.group===g.id),wid=round.opportunity;
   const faithful=host.players.filter(p=>p.group===g.id&&p.role==='Faithful');
   if(i<2){
    for(const [j,p] of faithful.slice(0,2).entries()){
     await t.cmd(actor(p),'raf_answer',id,{opportunity:wid,tie:i===0?(j?100:999):(j?110:90)});
     await t.cmd(actor(p),'raf_answer',id,{opportunity:wid,question:'a',answer:'private alpha'});
     if(i===0&&!j)await t.cmd(actor(p),'raf_answer',id,{opportunity:wid,question:'b',answer:'private bravo'});
    }
   }
   await assert.rejects(()=>t.cmd(25,'first_manual',id,{opportunity:wid,target:faithful[1].id,reason:'Try unauthorised fallback'}),/Only FS Penny/);
   await t.cmd(0,'first_manual',id,{opportunity:wid,target:i===2?'':faithful[1].id,reason:'Synthetic offline recovery'});
   let result=(await t.snap(0,id)).first_murder.find(r=>r.group===g.id);
   if(i===0){assert.equal(result.winner,faithful[0].id);assert.equal(result.score,2);assert.equal(result.draw,false);}
   if(i===1){assert.ok(faithful.slice(0,2).some(p=>p.id===result.winner));assert.equal(result.draw,true);const chosen=result.winner;await t.cmd(0,'first_manual',id,{opportunity:wid,target:faithful[1].id,reason:'Synthetic offline recovery'});assert.equal((await t.snap(0,id)).first_murder.find(r=>r.group===g.id).winner,chosen);}
   if(i>=2)assert.equal(result.winner,null);
   await t.cmd(0,'first_publish_quiz',id,{opportunity:wid});
   const r=(await t.snap(0,id)).reveals.find(r=>r.opportunity===wid);await t.cmd(0,'publish',id,{group:g.id,reveal:r.id});
  }
  const mine=await t.snap(25,id);assert.equal(mine.groups.length,1);assert.equal(mine.first_murder.length,1);assert.equal(mine.first_murder[0].group,group);
  for(const [cmd,args] of [['room_control',{group,enabled:false}],['recover',{player:host.players[0].id}],['release_roles',{}],['finish',{}],['delete',{confirm:host.title}]])await assert.rejects(()=>t.cmd(25,cmd,id,args));
  const other=host.groups.find(g=>g.id!==group);await assert.rejects(()=>t.cmd(25,'mission',id,{group:other.id,mission:1}),/authorised|permitted|already/);
  await t.cmd(25,'mission',id,{group,mission:1});
  assert.equal((await t.snap(0,id)).groups.find(g=>g.id===group).mission,1);
  assert.equal((await t.snap(0,id)).groups.find(g=>g.id===other.id).mission,0);
  await t.cmd(25,'discussion',id,{group});await t.cmd(25,'open_vote',id,{group});await t.cmd(25,'close_vote',id,{group});
  await t.cmd(25,'reopen_ballot',id,{group});await t.cmd(25,'close_vote',id,{group});await t.cmd(25,'skip_ballot',id,{group});
  assert.equal((await t.snap(0,id)).groups.find(g=>g.id===group).banishments,2);
  await t.cmd(0,'room_control',id,{group,enabled:false});await assert.rejects(()=>t.cmd(25,'discussion',id,{group}),/permitted/);
 }finally{await t.close();}
});

test('installing the quiz preserves existing identities, roles, ballots, targets and stage progress',async()=>{
 const t=await eventDatabase(2);try{
  const update='20261102161051_first_murder_quiz_and_room_controls.sql';
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>='20261023203457'&&f<update).sort())await t.db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  const {id}=await t.cmd(0,'create',null,{title:'Existing first murder',practice:true,traitors:2});
  await t.cmd(0,'add_test_players',id,{target_total:24});await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  await t.cmd(0,'mission',id,{mission:0});await t.cmd(0,'discussion',id);await t.cmd(0,'open_vote',id);await t.cmd(0,'close_vote',id);await t.cmd(0,'skip_ballot',id);await t.cmd(0,'open_murder',id,{slot:0});
  const saved=async()=>{const all={};for(const table of ['private.accounts','public.players','public.player_secrets','private.ballots_v2','private.votes_v2','private.murder_windows','private.group_state','private.mission_scores'])all[table]=(await t.queryAs(-1,`select coalesce(jsonb_agg(row order by row::text),'[]') data from (select to_jsonb(t) row from ${table} t) data`)).rows[0].data;return all;};
  const before=await saved();await t.queryAs(-1,'reset role');await t.db.exec(await readFile('supabase/migrations/'+update,'utf8'));assert.deepEqual(await saved(),before);
  const host=await t.snap(0,id);assert.equal(host.first_murder.length,0);assert.equal(host.windows.length,4);
  await t.cmd(0,'lock_murder',id);assert.equal((await t.snap(0,id)).reveals.length,4);
  const messages=firstMessages({me:{group:'g'},first_murder:[{group:'g',chat_until:'2026-11-02T20:00:00Z'}],messages:[{group_id:'g',sender:'<svg>',body:'<script>',created_at:'2026-11-02T19:59:00Z'},{group_id:'other',body:'Forbidden',created_at:'2026-11-02T19:59:00Z'},{group_id:'g',body:'Old planning',created_at:'2026-11-02T19:50:00Z'}]});
  assert.match(messages,/&lt;script&gt;/);assert.doesNotMatch(messages,/<script>|Forbidden|Old planning/);
 }finally{await t.close();}
});
