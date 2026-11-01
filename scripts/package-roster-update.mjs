// Regenerate only the new, unapplied migration. No names or answers are included.
import {readFile,writeFile} from 'node:fs/promises';
import {missionPlan,missionTimetable} from '../src/mission-plan.js';
const path='supabase/migrations/20261101212601_roster_and_plain_sight.sql';
let sql=(await readFile(path,'utf8')).split('-- BEGIN REGISTER UPDATE PUBLIC CONTENT')[0];
sql+='-- BEGIN REGISTER UPDATE PUBLIC CONTENT\n';
for(const [name,value] of [['mission_plan_cards',missionPlan],['mission_plan_timetable',missionTimetable]]){
 sql+=`create or replace function private.${name}() returns jsonb language sql immutable set search_path='' as $$ select '${JSON.stringify(value).replaceAll("'","''")}'::jsonb; $$;\nrevoke all on function private.${name}() from public,anon,authenticated;\n`;
}
sql+=`-- Preserve private answers, marking, scores and existing target times.
update private.missions m set instructions=c->>'instructions',equipment=c->>'equipment'
 from jsonb_array_elements(private.mission_plan_cards()) c where m.idx=0 and c->>'idx'='0' and m.title='The Locked Archive';
create function private.break_running_order(rows jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'time'),'[]') from (
 select value||case when value->>'id'='break' and value->>'label' in ('Break and second murder reveal','Break and Murder in Plain Sight attempts') then jsonb_build_object('label','Break and Murder in Plain Sight attempts') else '{}'::jsonb end as item from jsonb_array_elements(rows)
 union all select value from jsonb_array_elements(private.mission_plan_timetable()) proposed
 where value->>'id' in ('task-send','task-close','task-reveal')
 and not exists(select 1 from jsonb_array_elements(rows) saved where saved->>'id'=proposed.value->>'id' or saved->>'time'=proposed.value->>'time')
 ) r;
$$;
revoke all on function private.break_running_order(jsonb) from public,anon,authenticated;
update private.event_settings set timetable=private.break_running_order(timetable),timetable_revision=timetable_revision+1;
update private.host_preferences set timetable=private.break_running_order(timetable),revision=revision+1;
do $$begin execute replace(pg_get_functiondef('private.default_timetable()'::regprocedure),'private.default_timetable()','private.default_timetable_before_break()');end $$;
revoke all on function private.default_timetable_before_break() from public,anon,authenticated;
create or replace function private.default_timetable() returns jsonb language sql immutable set search_path='' as $$ select private.break_running_order(private.default_timetable_before_break());$$;
revoke all on function private.default_timetable() from public,anon,authenticated;
-- Longer Unicode task explanations remain bounded; the existing receipts and
-- request quotas still wrap every task action.
do $$declare def text;begin
 def:=pg_get_functiondef('private.command(text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'then 250000 else 4096 end','then 250000 when cmd in (''plain_save'',''plain_submit'',''plain_review'',''plain_verify'') then 16000 else 4096 end');
 execute def;
end $$;
do $$begin execute replace(pg_get_functiondef('private.board(uuid)'::regprocedure),'private.board(','private.board_before_register(');end $$;
revoke all on function private.board_before_register(uuid) from public,anon,authenticated;
create or replace function private.board(token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.board_before_register(token);
 return jsonb_set(result,'{players}',coalesce((select jsonb_agg(value||jsonb_build_object('name',coalesce((select rr.name from public.players p join private.accounts a on a.id=p.user_id join private.master_roster rr on rr.id=a.roster_id where p.id=(value->>'id')::uuid),value->>'name'))) from jsonb_array_elements(result->'players')),'[]'));
end $$;
revoke all on function private.board(uuid) from public;
grant execute on function private.board(uuid) to anon,authenticated;
notify pgrst,'reload schema';
`;
await writeFile(path,sql);
