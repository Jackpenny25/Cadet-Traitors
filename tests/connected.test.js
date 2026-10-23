import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('connected lifecycle, permissions, private roles and persistence',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;`);
 await db.exec(await readFile('supabase/001-foundation.sql','utf8'));
 await db.exec(await readFile('supabase/002-connected.sql','utf8'));
 const ids=Array.from({length:8},()=>crypto.randomUUID());
 for(let i=0;i<ids.length;i++)await db.query('insert into auth.users values($1,$2,now())',[ids[i],`user${i}@example.test`]);
 for(let i=0;i<6;i++){
  await db.query("insert into private.accounts(id,name,name_key,pin_hash) values($1,$2,$2,extensions.crypt('1234',extensions.gen_salt('bf',4)))",[ids[i],'user'+i]);
  await db.query('insert into private.sessions(auth_user,account_id) values($1,$1)',[ids[i]]);
 }
 await db.query('insert into private.hosts values($1)',[ids[0]]);
 async function as(i){await db.exec('reset role');await db.query("select set_config('request.uid',$1,false)",[i===null?'':ids[i]]);await db.exec(`set role ${i===null?'anon':'authenticated'}`);}
 async function cmd(c,eid=null,args={}){return (await db.query('select public.tno_command($1,$2,$3) as data',[c,eid,JSON.stringify(args)])).rows[0].data;}
 async function snap(id=null){return (await db.query('select public.tno_snapshot($1) as data',[id])).rows[0].data;}
 await as(null);await assert.rejects(()=>snap(),/permission denied/);
 await as(1);await assert.rejects(()=>cmd('create',null,{title:'Forbidden',groups:1,capacity:5,traitors:1}),/host access/);
 await as(0);const {id}=await cmd('create',null,{title:'Live game',groups:1,capacity:6,traitors:1});
 const code=(await snap(id)).code;
 for(let i=1;i<=5;i++){await as(i);await cmd('join',null,{code,name:'Cadet '+i});}
 await as(6);await assert.rejects(()=>snap(id),/Sign in first/);
 await as(1);await assert.rejects(()=>cmd('assign',id),/Only this game/);
 await assert.rejects(()=>db.exec('select * from private.games'),/permission denied/);
 await assert.rejects(()=>db.exec("update public.players set status='Banished'"),/permission denied/);
 assert.equal((await snap(id)).players.length,5);
 await as(0);await cmd('assign',id);let s=await snap(id);
 assert.equal(s.players.filter(p=>p.role==='Traitor').length,1);
 const traitor=s.players.find(p=>p.role==='Traitor');
 const faithful=s.players.filter(p=>p.role==='Faithful');
 const indexFor=p=>Number(p.name.split(' ')[1]);
 await as(indexFor(faithful[0]));const privateView=await snap(id);
 assert.equal(privateView.me.role,'Faithful');assert.ok(privateView.players.every(p=>p.role===null));
 await assert.rejects(()=>db.query('select * from public.player_secrets'),/permission denied/);
 await assert.rejects(()=>cmd('propose',id,{target:faithful[1].id}),/not permitted/);
 await as(0);await cmd('stage',id,{stage:'Round table'});await cmd('open_vote',id);
 for(let i=1;i<=5;i++){await as(i);let v=await snap(id);let target=v.me.id===traitor.id?faithful[0].id:traitor.id;await cmd('vote',id,{target});}
 await as(0);await cmd('close_vote',id);s=await snap(id);const ban=s.outcomes.find(o=>o.kind==='Banished');
 assert.equal(ban.target,traitor.id);
 await as(1);assert.equal((await snap(id)).outcomes.length,0);
 await as(0);await assert.rejects(()=>cmd('stage',id,{stage:'Night'}),/pending outcomes/);
 await cmd('publish',id,{outcome:ban.id});await cmd('reveal',id,{outcome:ban.id});
 await as(indexFor(traitor));await assert.rejects(()=>cmd('vote',id,{target:faithful[0].id}),/active players/);
 await as(0);await cmd('score',id,{group:s.groups[0].id,delta:100,reason:'Mission completed'});
 await cmd('finish',id);s=await snap(id);assert.equal(s.groups[0].score,100);assert.equal(s.groups[0].winner,'Faithful');
 await as(1);assert.ok((await snap(id)).players.every(p=>p.role));
 // Independent second event: roles cannot be read by participants in the first.
 await as(0);const second=await cmd('create',null,{title:'Another event',groups:1,capacity:4,traitors:1});
 const secondCode=(await snap(second.id)).code;
 const boardToken=(await snap(second.id)).display_token;
 await as(1);await assert.rejects(()=>snap(second.id),/not a member/);
 for(let i=1;i<=4;i++){await as(i);await cmd('join',null,{code:secondCode,name:'Cadet '+i});}
 await as(0);await cmd('assign',second.id);s=await snap(second.id);
 const secondTraitor=s.players.find(p=>p.role==='Traitor');const secondFaithful=s.players.filter(p=>p.role==='Faithful');
 await as(null);let board=(await db.query('select public.tno_board($1) as data',[boardToken])).rows[0].data;
 assert.ok(board.players.every(p=>p.role===null));assert.equal(board.code,undefined);assert.equal(board.objective,undefined);
 await assert.rejects(()=>db.query('select public.tno_board($1)',[crypto.randomUUID()]),/not found/);
 await as(0);await cmd('stage',second.id,{stage:'Night'});
 await as(indexFor(secondFaithful[0]));await assert.rejects(()=>cmd('propose',second.id,{target:secondFaithful[1].id}),/not permitted/);
 await as(indexFor(secondTraitor));await cmd('propose',second.id,{target:secondFaithful[0].id});
 await as(0);await cmd('confirm_murder',second.id,{target:secondFaithful[0].id});
 s=await snap(second.id);const murder=s.outcomes.find(o=>o.kind==='Murdered');
 await assert.rejects(()=>cmd('confirm_murder',second.id,{target:secondFaithful[0].id}),/unique constraint/);
 await as(null);board=(await db.query('select public.tno_board($1) as data',[boardToken])).rows[0].data;
 assert.ok(board.players.every(p=>p.status==='Active'));
 await as(0);await cmd('publish',second.id,{outcome:murder.id});
 await cmd('stage',second.id,{stage:'Round table'});await cmd('open_vote',second.id);
 const alive=s.players.filter(p=>p.id!==secondFaithful[0].id);
 // Three active voters produce a three-way tie with no self votes.
 for(let i=0;i<alive.length;i++){await as(indexFor(alive[i]));await cmd('vote',second.id,{target:alive[(i+1)%alive.length].id});}
 await as(0);await cmd('close_vote',second.id);await cmd('resolve_tie',second.id,{target:secondFaithful[1].id});
 s=await snap(second.id);const tie=s.outcomes.find(o=>o.kind==='Banished');assert.equal(tie.target,secondFaithful[1].id);
 await cmd('publish',second.id,{outcome:tie.id});await cmd('finish',second.id);
 assert.equal((await snap(second.id)).groups[0].winner,'Traitors');
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from public.players')).rows[0].n,9);
 // Name/PIN registration, recovery on a fresh Auth session, durable rate limits.
 await as(6);
 await assert.rejects(()=>snap(),/Sign in first/);
 const login=async(name,pin,register=false)=>(await db.query('select public.tno_login($1,$2,$3) as data',[name,pin,register])).rows[0].data;
 assert.ok((await login('New Player','123',true)).error);
 assert.equal((await login('New Player','0314',true)).name,'New Player');
 await db.query('select public.tno_logout()');await assert.rejects(()=>snap(),/Sign in first/);
 await as(7);assert.ok((await login('New Player','0000')).error);
 assert.equal((await login(' new player ','0314')).name,'New Player');
 assert.equal((await snap()).name,'New Player');
 await db.query('select public.tno_logout()');
 for(let i=0;i<5;i++)assert.ok((await login('New Player','0000')).error);
 assert.match((await login('New Player','0314')).error,/15 minutes/);
 await assert.rejects(()=>db.exec('select * from private.accounts'),/permission denied/);
 await db.exec('reset role');
 const grant=await readFile('supabase/003-grant-host.sql','utf8');
 await db.exec(grant.replace('REPLACE_WITH_YOUR_NAME','New Player'));
 const reset=await readFile('supabase/004-reset-pin.sql','utf8');
 await db.exec(reset.replace('REPLACE_WITH_NEW_FOUR_DIGIT_PIN','0271').replace('REPLACE_WITH_ACCOUNT_NAME','New Player'));
 await as(7);await assert.rejects(()=>snap(),/Sign in first/);
 assert.equal((await login('New Player','0271')).name,'New Player');
 assert.equal((await snap()).can_host,true);
 await db.exec('reset role');
 await db.exec("update private.sessions set expires_at=now()-interval '1 second'");
 await as(7);await assert.rejects(()=>snap(),/Sign in first/);
 }finally{await db.close();}
});
