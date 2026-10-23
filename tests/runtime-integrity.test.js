import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {eventDatabase} from './runtime-helpers.js';
import {schemaQuery,schemaDifferences} from '../scripts/runtime-schema.mjs';
import {eventSnapshot} from '../src/event-contract.js';

test('table integrity repair restores player numbering and lost foreign keys without deleting historical orphan data',async()=>{
 const t=await eventDatabase(3);
 try{
  const {id}=await t.cmd(0,'create',null,{title:'Saved rehearsal',practice:true,groups:1,size:3,traitors:1});
  await t.queryAs(-1,'select 1');await t.db.exec("set search_path=''");
  const expected=(await t.db.query(schemaQuery)).rows[0].schema_audit;
  await t.db.exec(`do $$ declare r record; begin
   for r in select k.conrelid::regclass as target,k.conname from pg_constraint k join pg_class c on c.oid=k.confrelid join pg_namespace n on n.oid=c.relnamespace
    where k.contype='f' and k.connamespace='private'::regnamespace and n.nspname='public' loop
    execute format('alter table %s drop constraint %I',r.target,r.conname);
   end loop;
  end $$;
  alter table public.players drop column player_number cascade;
  alter table public.players drop constraint players_status_check;
  alter table public.players add constraint players_status_check check(status in ('Active','Banished','Murdered'));`);
  const orphan=crypto.randomUUID();await t.db.query("insert into private.games(event_id,code,capacity,traitors) values($1,'OLDRECORD',3,1)",[orphan]);
  await assert.rejects(()=>t.snap(0,id),/player_number/);
  await t.queryAs(-1,'select 1');await t.db.exec("set search_path=''");
  const file=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restore_runtime_table_integrity.sql'));
  const repair=await readFile('supabase/migrations/'+file,'utf8');await t.db.exec(repair);
  assert.equal((await t.db.query('select count(*)::int as n from private.games where event_id=$1',[orphan])).rows[0].n,1);
  assert.equal((await t.db.query("select count(*)::int as n from pg_constraint where connamespace='private'::regnamespace and not convalidated")).rows[0].n,1);
  await assert.rejects(()=>t.db.query("insert into private.games(event_id,code,capacity,traitors) values($1,'BADNEW',3,1)",[crypto.randomUUID()]),/foreign key/);
  eventSnapshot(await t.snap(0,id));await t.cmd(0,'joining',id,{open:true});
  for(const i of [1,2])await t.cmd(i,'join',id,{practice_event:id});
  await t.cmd(0,'prepare_roles',id);await t.cmd(0,'release_roles',id);
  const state=await t.snap(0,id);assert.deepEqual(state.players.map(p=>p.number).sort(),[1,2]);
  const faithful=state.players.find(p=>p.role==='Faithful');await t.cmd(0,'withdraw',id,{group:faithful.group,player:faithful.id,reason:'Testing a deliberate withdrawal'});
  assert.equal((await t.snap(0,id)).players.find(p=>p.id===faithful.id).status,'Withdrawn');
  await t.queryAs(-1,'select 1');await t.db.exec(repair);
  const after=await t.snap(0,id);assert.deepEqual(after.players.map(p=>[p.id,p.number,p.role]),state.players.map(p=>[p.id,p.number,p.role]));
  // Local fixture cleanup lets every restored constraint validate and match the canonical schema.
  await t.queryAs(-1,'delete from private.games where event_id=$1',[orphan]);await t.db.exec(repair);await t.db.exec("set search_path=''");
  const actual=(await t.db.query(schemaQuery)).rows[0].schema_audit;
  assert.deepEqual(schemaDifferences(expected,actual),{tables:[],columns:[],constraints:[],indexes:[]});
 }finally{await t.close();}
});
