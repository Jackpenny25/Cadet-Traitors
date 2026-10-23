import {readFile,writeFile,readdir} from 'node:fs/promises';
import {sqlFunctions} from './sql-functions.mjs';
const definitions=new Map();
for(const file of ['002-connected.sql','005-security.sql','event-runtime.sql']){
 for(const fn of sqlFunctions(await readFile('supabase/'+file,'utf8'))){
  if(fn.name.startsWith('public.tno_')||['private.current_account','private.login_core','private.login','private.logout','private.command'].includes(fn.name))definitions.set(fn.name,fn.sql);
 }
}
if(definitions.size!==13)throw new Error('Unexpected repair function count: '+definitions.size);
const file=(await readdir('supabase/migrations')).find(n=>n.endsWith('_restore_runtime_routing.sql'));
if(!file)throw new Error('Create the restore_runtime_routing migration with Supabase CLI first.');
const sql=`-- Repair a mixed installation where older setup SQL replaced current entry points.
-- Requires the single-event runtime tables. Preserves accounts, PIN hashes and all game records.
-- Restores the protected dispatcher and live Auth-session checks; does not grant new host access.
do $$ begin
 if to_regclass('private.live_event') is null or to_regclass('private.receipts') is null
  or to_regprocedure('private.legacy_game_command(text,uuid,jsonb)') is null
  or not exists(select 1 from information_schema.columns where table_schema='private' and table_name='sessions' and column_name='auth_session')
 then raise exception 'Install the security and single-event runtime migrations before this repair.'; end if;
end $$;

${[...definitions.values()].join('\n\n')}

-- Keep browser clients behind the fixed RPC entry points.
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on public.events,public.event_groups,public.players,public.player_secrets from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.login(text,text,boolean),private.logout(),private.command(text,uuid,jsonb),private.snapshot(uuid),private.recovery_export(uuid),private.recover_player(uuid,uuid,text) to authenticated;
grant execute on function private.board(uuid) to anon,authenticated;
revoke all on function public.tno_login(text,text,boolean),public.tno_logout(),public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid),public.tno_export(uuid),public.tno_recover(uuid,uuid,text),public.tno_board(uuid),public.tno_connection_check() from public,anon,authenticated;
grant execute on function public.tno_login(text,text,boolean),public.tno_logout(),public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid),public.tno_export(uuid),public.tno_recover(uuid,uuid,text) to authenticated;
grant execute on function public.tno_board(uuid),public.tno_connection_check() to anon,authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from anon,authenticated;
notify pgrst,'reload schema';
`;
await writeFile('supabase/migrations/'+file,sql);
console.log('Packaged '+file);
