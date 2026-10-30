-- Keep historical columns for migration/recovery compatibility. They are inert:
-- old clients and delegated legacy functions cannot restart a countdown.
create function private.clear_group_countdown() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.deadline:=null;new.remaining:=0;new.paused:=false;
 if tg_op='UPDATE' then
  if (new.phase is distinct from old.phase or new.mission is distinct from old.mission)
   and new.planning_until is not distinct from old.planning_until then new.planning_until:=null;end if;
 end if;
 if new.planning_until is not null then new.planning_until:='infinity'::timestamptz; end if;
 return new;
end $$;
revoke all on function private.clear_group_countdown() from public,anon,authenticated;

create function private.clear_opportunity_deadline() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.deadline:=null;return new;end $$;
revoke all on function private.clear_opportunity_deadline() from public,anon,authenticated;

-- Preserve whether private planning is currently open, then make future planning
-- end on an organiser's stage change rather than a clock.
update private.group_state set deadline=null,remaining=0,paused=false,
 planning_until=case when planning_until>now() then 'infinity'::timestamptz else null end;
update private.murder_windows set deadline=null;
create trigger remove_group_countdown before insert or update on private.group_state
 for each row execute function private.clear_group_countdown();
create trigger remove_opportunity_deadline before insert or update on private.murder_windows
 for each row execute function private.clear_opportunity_deadline();

update private.event_settings set nco_permissions=array_remove(nco_permissions,'timer');
do $$
declare defaults text;
begin
 select pg_get_expr(d.adbin,d.adrelid) into defaults from pg_attrdef d
 join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
 where d.adrelid='private.event_settings'::regclass and a.attname='nco_permissions';
 execute 'alter table private.event_settings alter column nco_permissions set default array_remove(('||defaults||'),''timer'')';
end $$;

do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_timer_removal(');end $$;
revoke all on function private.game_command_before_timer_removal(text,uuid,jsonb) from public,anon,authenticated;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if cmd in ('pause','resume','extend') then raise exception 'Game timers have been removed. Refresh the website and use the activity controls to move stages on manually.'; end if;
 if cmd='permissions' and coalesce(args->'permissions','[]'::jsonb) ? 'timer' then raise exception 'Timer permissions have been removed. Refresh Setup and save the remaining NCO permissions.'; end if;
 return private.game_command_before_timer_removal(cmd,eid,args);
end $$;
revoke all on function private.game_command(text,uuid,jsonb) from public,anon,authenticated;

-- A stage change may close an unverified objective, but elapsed time never does.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'Objective deadline passed without NCO confirmation','Stage advanced without NCO confirmation');
 execute definition;
end $$;

do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_timer_removal(');end $$;
revoke all on function private.snapshot_before_timer_removal(uuid) from public,anon,authenticated;
create or replace function private.snapshot(eid uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.snapshot_before_timer_removal(eid);
 if eid is null then return result; end if;
 result:=jsonb_set(result,'{groups}',coalesce((select jsonb_agg(
  (g-array['deadline','remaining','paused']) || case when g ? 'control_checks' then jsonb_build_object('control_checks',(g->'control_checks')-array['pause','resume','extend']) else '{}'::jsonb end)
  from jsonb_array_elements(result->'groups') g),'[]'::jsonb));
 result:=jsonb_set(result,'{windows}',coalesce((select jsonb_agg(w-'deadline') from jsonb_array_elements(result->'windows') w),'[]'::jsonb));
 if jsonb_typeof(result->'nco_permissions')='array' then result:=jsonb_set(result,'{nco_permissions}',coalesce((select jsonb_agg(p) from jsonb_array_elements(result->'nco_permissions') p where p<>'"timer"'::jsonb),'[]'::jsonb));end if;
 return result;
end $$;
revoke all on function private.snapshot(uuid) from public,anon;
grant execute on function private.snapshot(uuid) to authenticated;

do $$ begin execute replace(pg_get_functiondef('private.board(uuid)'::regprocedure),'private.board(','private.board_before_timer_removal(');end $$;
revoke all on function private.board_before_timer_removal(uuid) from public,anon,authenticated;
create or replace function private.board(token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.board_before_timer_removal(token);
 return jsonb_set(result,'{groups}',coalesce((select jsonb_agg(g-array['deadline','remaining','paused']) from jsonb_array_elements(result->'groups') g),'[]'::jsonb));
end $$;
revoke all on function private.board(uuid) from public;
grant execute on function private.board(uuid) to anon,authenticated;
