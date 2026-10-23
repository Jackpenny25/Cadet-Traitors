import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {sqlFunctions} from '../scripts/sql-functions.mjs';
import {lobbySnapshot,eventSnapshot,boardSnapshot} from '../src/event-contract.js';

test('complete repair restores legacy commands and read functions, preserves rehearsals and satisfies client response contracts',async()=>{
 const t=await eventDatabase(3);
 try{
  const practice=await t.cmd(0,'create',null,{title:'Existing rehearsal',practice:true,groups:1,size:3,traitors:1});
  await t.cmd(0,'joining',practice.id,{open:true});
  for(const i of [1,2])await t.cmd(i,'join',practice.id,{practice_event:practice.id});
  await t.cmd(0,'prepare_roles',practice.id);await t.cmd(0,'release_roles',practice.id);
  const before=await t.snap(0,practice.id);
  const credentials=(await t.queryAs(-1,'select id,pin_hash from private.accounts order by id')).rows;
  // Reproduce the full older setup, including the read functions missed by the first repair.
  const old=sqlFunctions(await readFile('supabase/002-connected.sql','utf8'));
  await t.db.exec(old.map(f=>f.sql).join('\n'));
  const args={practice:false,title:'2427: Trust No One',date:'2026-10-25',groups:'5',size:'10',traitors:'2',request_id:crypto.randomUUID()};
  await assert.rejects(()=>t.cmd(0,'create',null,args),/null value.*capacity|capacity.*null/i);
  await t.queryAs(-1,'select 1');
  const file=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restore_runtime_routing.sql'));
  const repair=await readFile('supabase/migrations/'+file,'utf8');
  await t.db.exec(repair);
  const legacyLobby=await t.snap(0);const legacyEvent=await t.snap(0,practice.id);
  const legacyBoard=await t.board(before.display_token);
  for(const [validate,value] of [[lobbySnapshot,legacyLobby],[eventSnapshot,legacyEvent],[boardSnapshot,legacyBoard]])assert.throws(()=>validate(value),{code:'TNO_RUNTIME_MISMATCH'});
  await t.queryAs(-1,'select 1');
  const completeFile=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restore_complete_runtime.sql'));
  const complete=await readFile('supabase/migrations/'+completeFile,'utf8');
  await t.db.exec(complete);await t.db.exec(complete);
  // Check every canonical function body, rather than just a version marker.
  const expected=new Map();
  for(const source of ['002-connected.sql','005-security.sql','event-runtime.sql'])for(const fn of sqlFunctions(await readFile('supabase/'+source,'utf8')))expected.set(fn.name,fn.sql.split('$$')[1].replace(/\r\n/g,'\n'));
  const bodies=(await t.db.query("select n.nspname||'.'||p.proname as name,p.prosrc as body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1::text[])",[[...expected.keys()]])).rows;
  assert.equal(bodies.length,23);for(const fn of bodies)assert.equal(fn.body.replace(/\r\n/g,'\n'),expected.get(fn.name),fn.name+' must match canonical source');
  assert.deepEqual((await t.db.query('select id,pin_hash from private.accounts order by id')).rows,credentials);
  const created=await t.cmd(0,'create',null,args);const repeated=await t.cmd(0,'create',null,args);
  assert.equal(created.id,repeated.id);
  const live=await t.snap(0,created.id);
  eventSnapshot(live);lobbySnapshot(await t.snap(0));boardSnapshot(await t.board(live.display_token));
  assert.equal(live.groups.length,5);assert.ok(live.groups.every(g=>g.capacity===10&&g.traitors===2));
  assert.equal(live.players.length,0);assert.equal(live.date,'2026-10-25');assert.equal(live.joining,false);
  const after=await t.snap(0,practice.id);
  eventSnapshot(after);eventSnapshot(await t.snap(1,practice.id));
  await t.queryAs(-1,'select 1');const staffId=crypto.randomUUID();
  await t.db.query('insert into auth.users values($1,null,null)',[staffId]);await t.db.query('insert into auth.sessions values($1,$1)',[staffId]);
  await t.db.query("insert into private.accounts(id,name,name_key,pin_hash) values($1,'Test NCO','test nco',extensions.crypt('0123',extensions.gen_salt('bf',4)))",[staffId]);
  await t.db.query('insert into private.sessions(auth_user,account_id,auth_session) values($1,$1,$1)',[staffId]);t.users.push(staffId);
  await t.cmd(0,'assign_staff',practice.id,{name:'Test NCO',groups:[after.groups[0].id]});
  eventSnapshot(await t.snap(3,practice.id));
  assert.deepEqual(after.players.map(p=>[p.id,p.role]),before.players.map(p=>[p.id,p.role]));
  assert.equal((await t.rpc(null,'tno_connection_check',{})).schema_version,4);
  const privileges=(await t.queryAs(-1,"select has_function_privilege('authenticated','private.game_command(text,uuid,jsonb)','EXECUTE') as helper, has_function_privilege('anon','public.tno_command(text,uuid,jsonb)','EXECUTE') as anonymous_command")).rows[0];
  assert.deepEqual(privileges,{helper:false,anonymous_command:false});
  await t.queryAs(-1,'delete from auth.sessions where user_id=$1',[t.users[2]]);
  await assert.rejects(()=>t.snap(2,practice.id),/Sign in first/);
 }finally{await t.close();}
});
