import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
test('versioned deployment migrations install an empty, protected runtime on a fresh project',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
   create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();assert.equal(files.length,10);
  const runtime=files.find(f=>f.endsWith('_single_event_runtime.sql'));
  const normalize=sql=>sql.replace(/\r\n/g,'\n');
  const strip=sql=>normalize(sql).replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,'');
  assert.equal(normalize(await readFile('supabase/migrations/'+runtime,'utf8')),strip(await readFile('supabase/event-runtime.sql','utf8')),'Packaged runtime must match tested source');
  for(const file of files)await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const version=(await db.query('select public.tno_connection_check() as data')).rows[0].data;
  assert.equal(version.schema_version,4);
  assert.equal((await db.query('select count(*)::integer as n from public.players')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::integer as n from public.events')).rows[0].n,0);
  const unsecured=(await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and not c.relrowsecurity")).rows;
  assert.deepEqual(unsecured,[]);
 }finally{await db.close();}
});
