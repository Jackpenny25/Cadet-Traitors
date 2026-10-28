-- Keep cadets focused on their own team, and make an open rehearsal discoverable.
alter table private.group_state add column active_task text;

-- Preserve the existing authorisation, locks, balanced allocation and capacity checks.
do $$
declare definition text; old_guard text; new_guard text;
begin
 definition:=replace(pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 old_guard:=$old$if not ev.joining_open or cfg.roles_released or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Joining is closed. Ask your NCO about late arrival.'; end if;$old$;
 new_guard:=$new$if not ev.joining_open or (not cfg.roles_released and exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid)) then raise exception 'Joining is closed. Ask your NCO to open joining.'; end if;
  if (select ended from private.games where event_id=eid) then raise exception 'The event has finished.'; end if;$new$;
 if position(old_guard in definition)=0 then raise exception 'Expected joining guard not found'; end if;
 definition:=replace(definition,old_guard,new_guard);
 old_guard:=$old$if cfg.roles_released or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Joining remains locked after role preparation. Reset unreleased roles first.'; end if;$old$;
 if position(old_guard in definition)=0 then raise exception 'Expected host joining guard not found'; end if;
 definition:=replace(definition,old_guard,$new$if not cfg.roles_released and exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Reset unreleased roles before reopening joining.'; end if;
   if (select ended from private.games where event_id=eid) then raise exception 'The event has finished.'; end if;$new$);
 definition:=replace(definition,'where g.event_id=eid group by g.group_id,g.capacity having count(p.id)<g.capacity','where g.event_id=eid and not g.done group by g.group_id,g.capacity having count(p.id)<g.capacity');
 old_guard:=$old$insert into public.players(event_id,group_id,user_id,display_name,player_number) values(eid,gid,uid,textval,number);$old$;
 if position(old_guard in definition)=0 then raise exception 'Expected join insertion not found'; end if;
 definition:=replace(definition,old_guard,old_guard||E'\n  if cfg.roles_released then insert into public.player_secrets(player_id,role) select id,''Faithful'' from public.players where event_id=eid and user_id=uid; end if;');
 execute definition;
end $$;

-- Record task identity separately from its editable time, label and running order.
do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_cadet_flow('); end $$;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare result jsonb; item jsonb; g record; selected_task text; uid uuid:=private.current_account();
begin
 result:=private.game_command_before_cadet_flow(cmd,eid,args);
 if cmd not in ('start_task','mission','discussion','release_roles','finish','open_murder') then return result; end if;
 for g in select * from private.group_state where event_id=eid and (not(args ? 'group') or group_id=(args->>'group')::uuid) loop
  -- The delegated command has already checked permissions; keep changes to its groups.
  if not ((select owner_id=uid from public.events where id=eid) or private.can_control(eid,g.group_id,'read')) then continue; end if;
  selected_task:=null;
  if cmd='start_task' then selected_task:=args->>'row';
  else
   select value into item from jsonb_array_elements((select timetable from private.event_settings where event_id=eid))
    where value->>'action'=cmd and (cmd<>'mission' or (value->>'mission')::int=g.mission)
     and (cmd<>'discussion' or value->>'id'='round'||(g.mission+1)::text)
     and (cmd<>'open_murder' or (value->>'slot')::int=(args->>'slot')::int) limit 1;
   selected_task:=item->>'id';
  end if;
  update private.group_state set active_task=selected_task where group_id=g.group_id;
 end loop;
 return result;
end $$;
revoke all on function private.game_command_before_cadet_flow(text,uuid,jsonb),private.game_command(text,uuid,jsonb) from public,anon,authenticated;

-- Public RPC still performs name/PIN-session checks before entering this wrapper.
do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_cadet_flow('); end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare result jsonb; uid uuid:=private.current_account(); gid uuid; mission_idx int; phase text;
begin
 result:=private.snapshot_before_cadet_flow(eid);
 if eid is null then
  return result||jsonb_build_object('rehearsals',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'joined',exists(select 1 from public.players p where p.event_id=e.id and p.user_id=uid)) order by e.created_at desc)
   from public.events e join private.event_settings c on c.event_id=e.id join private.games g on g.event_id=e.id
   where c.practice and not g.ended and e.owner_id<>uid and not exists(select 1 from private.staff s where s.event_id=e.id and s.account_id=uid)
    and (e.joining_open or exists(select 1 from public.players p where p.event_id=e.id and p.user_id=uid))),'[]'::jsonb));
 end if;
 result:=jsonb_set(result,'{groups}',coalesce((select jsonb_agg(value||jsonb_build_object('active_task',(select active_task from private.group_state where group_id=(value->>'id')::uuid))) from jsonb_array_elements(result->'groups')),'[]'::jsonb));
 if not (result->>'organiser')::boolean then
  gid:=(result->'me'->>'group')::uuid;
  select s.mission,s.phase into mission_idx,phase from private.group_state s where s.group_id=gid;
  result:=jsonb_set(result,'{groups}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'groups') where value->>'id'=gid::text),'[]'::jsonb));
  result:=jsonb_set(result,'{players}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'players') where value->>'group'=gid::text),'[]'::jsonb));
  result:=jsonb_set(result,'{scores}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'scores') where value->>'group_id'=gid::text),'[]'::jsonb));
  result:=jsonb_set(result,'{reveals}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'reveals') where value->>'group_id'=gid::text),'[]'::jsonb));
  result:=jsonb_set(result,'{missions}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'missions') where phase='Mission' and (value->>'idx')::int=mission_idx),'[]'::jsonb));
  result:=jsonb_set(result,'{timetable}','[]'::jsonb);
 end if;
 return result;
end $$;
revoke all on function private.snapshot_before_cadet_flow(uuid),private.snapshot(uuid) from public,anon,authenticated;
grant execute on function private.snapshot(uuid) to authenticated;
-- Report the exact blocked step without bypassing any gameplay checks.
do $$
declare definition text; old_guard text;
begin
 definition:=pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure);
 old_guard:=$old$if gs.done or not cfg.roles_released or number not in(0,1) or exists(select 1 from private.murder_windows where group_id=gid and slot=number) or (number=0 and gs.banishments<1) or (number=1 and gs.mission<>1) or gs.phase in ('Voting','Discussion') then raise exception 'Check this opportunity, phase and group eligibility.'; end if;$old$;
 if position(old_guard in definition)=0 then raise exception 'Expected opportunity guard not found'; end if;
 definition:=replace(definition,old_guard,$new$
    if not cfg.roles_released then raise exception 'Release the private envelopes in Main host before opening a murder opportunity.'; end if;
    if gs.done then raise exception '%: deduction is complete. Continue physical missions, then start the finale. No further murder is needed.',(select name from public.event_groups where id=gid); end if;
    if number is null or number not in(0,1) then raise exception 'Choose First murder or Second murder, then open that opportunity.'; end if;
    if exists(select 1 from private.murder_windows where group_id=gid and slot=number) then raise exception '%: murder opportunity % has already been opened. Finish its private decision and reveal its pending outcome instead of opening it again.',(select name from public.event_groups where id=gid),number+1; end if;
    if number=0 and gs.banishments<1 then raise exception '%: finish the first round table before the first murder. Start discussion, open voting, close voting, resolve any tie and reveal the outcome.',(select name from public.event_groups where id=gid); end if;
    if number=1 and gs.mission<>1 then raise exception '%: start The Vault mission before opening the second murder opportunity.',(select name from public.event_groups where id=gid); end if;
    if gs.phase in ('Voting','Discussion') then raise exception '%: finish this round table first. Open voting if needed, close it, resolve any tie and reveal the outcome before opening the murder.',(select name from public.event_groups where id=gid); end if;
 $new$);
 definition:=replace(definition,$old$raise exception 'Resolve the current murder opportunity before opening another.';$old$,$new$raise exception '%: another murder opportunity is still open. Lock its standard choices or verify its supervised objective, then reveal the outcome before opening another.',(select name from public.event_groups where id=gid);$new$);
 definition:=replace(definition,$old$raise exception 'This group cannot start another discussion yet.';$old$,$new$raise exception '%: cannot start discussion from %. Release envelopes first. If voting has started, close it, resolve any tie and reveal the outcome. A group with completed deduction needs physical missions or the finale instead.',(select name from public.event_groups where id=gid),gs.phase;$new$);
 definition:=replace(definition,$old$raise exception 'No open standard opportunity.';$old$,$new$raise exception '%: no standard murder is open. Open its murder opportunity first. For a supervised objective, use Assign objective and Resolve privately instead of Lock choices.',(select name from public.event_groups where id=gid);$new$);
 execute definition;
end $$;
notify pgrst,'reload schema';
