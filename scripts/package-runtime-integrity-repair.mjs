import {readFile,writeFile,readdir} from 'node:fs/promises';
import {eventDatabase} from '../tests/runtime-helpers.js';
import {schemaQuery} from './runtime-schema.mjs';
const t=await eventDatabase(1);let schema;
try{await t.db.exec("set search_path=''");schema=(await t.db.query(schemaQuery)).rows[0].schema_audit;}finally{await t.close();}
const links=schema.constraints.filter(c=>c.schema==='private'&&c.type==='f'&&c.definition.includes('REFERENCES public.'));
if(links.length!==42)throw new Error('Unexpected table link count: '+links.length);
const file=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restore_runtime_table_integrity.sql'));
if(!file)throw new Error('Create the restore_runtime_table_integrity migration with Supabase CLI first.');
const status=schema.constraints.find(c=>c.name==='players_status_check').definition;
const sql=`-- Restore runtime additions and table links lost when foundation tables were recreated.
-- Existing accounts, rehearsals and player records are preserved.
-- Old orphan records are never deleted: affected foreign keys enforce new writes immediately,
-- while validation of those older rows is deferred and reported for administrator review.
lock table public.players in share row exclusive mode;
alter table public.players add column if not exists player_number integer;
with numbers as (
 select p.id,coalesce((select max(x.player_number) from public.players x where x.event_id=p.event_id),0)
  +row_number() over(partition by p.event_id order by p.id) as number
 from public.players p where p.player_number is null
)
update public.players p set player_number=n.number from numbers n where p.id=n.id;
alter table public.players drop constraint if exists players_status_check;
alter table public.players add constraint players_status_check ${status};
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.players'::regclass and conname='unique_player_number') then
  alter table public.players add constraint unique_player_number unique(event_id,player_number);
 end if;
end $$;
do $$ begin
${links.map(c=>` if not exists(select 1 from pg_constraint where conrelid='${c.schema}.${c.table}'::regclass and conname='${c.name}') then
  alter table ${c.schema}.${c.table} add constraint ${c.name} ${c.definition} not valid;
 end if;
 begin
  alter table ${c.schema}.${c.table} validate constraint ${c.name};
 exception when foreign_key_violation then
  raise notice '${c.name}: historical orphan records preserved; new writes remain checked.';
 end;`).join('\n')}
end $$;
notify pgrst,'reload schema';
`;
await writeFile('supabase/migrations/'+file,sql);console.log('Packaged '+file+' ('+links.length+' table links)');
