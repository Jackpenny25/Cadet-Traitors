-- Default preserves Murder in Plain Sight. First-murder rounds and saved records are untouched.
alter table private.event_settings add column second_murder_standard boolean not null default false;

create function private.second_murder_pending(eid uuid,gid uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from private.group_state s where s.event_id=eid and s.group_id=gid and not s.done and s.banishments>=2
  and not exists(select 1 from private.murder_windows w where w.group_id=gid and w.slot=1 and w.status='published'));
$$;
revoke all on function private.second_murder_pending(uuid,uuid) from public,anon,authenticated;

do $$begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_second_mode(');end $$;
revoke all on function private.game_command_before_second_mode(text,uuid,jsonb) from public,anon,authenticated;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account();owner uuid;cfg private.event_settings;action text:=cmd;item jsonb;slot int;
 desired boolean;normal_second boolean:=false;wid uuid;result jsonb;w private.murder_windows;pid uuid;g record;before_ids uuid[];
begin
 if uid is null then raise exception 'Sign in with your name and PIN first.';end if;
 select owner_id into owner from public.events where id=eid for update;
 select * into cfg from private.event_settings where event_id=eid;
 if cmd='second_murder_mode' then
  if owner is distinct from uid then raise exception 'Only FS Penny can choose the second-murder format.';end if;
  if (select ended from private.games where event_id=eid) then raise exception 'This event has finished. Choose the format in a new rehearsal or live event.';end if;
  desired:=coalesce((args->>'standard')::boolean,false);
  if desired=cfg.second_murder_standard then return jsonb_build_object('id',eid);end if;
  if args->>'expected' is null then raise exception 'Reload Setup and save the selected second-murder format before changing it.';end if;
  if (args->>'expected')::boolean is distinct from cfg.second_murder_standard then raise exception 'The second-murder format changed on another device. Reload Setup before changing it.';end if;
  if exists(select 1 from private.murder_windows where event_id=eid and slot=1) or exists(select 1 from private.plain_tasks where event_id=eid and state<>'draft') then
   raise exception 'The second-murder format is locked because a physical task was sent or a second-murder opportunity opened. Finish this format; saved instructions, targets and evidence cannot be replaced. Use a new rehearsal to test the other format.';
  end if;
  update private.event_settings set second_murder_standard=desired,plain_slot=case when desired then null else 1 end where event_id=eid;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('standard',desired,'text',case when desired then 'Standard second murder; no quiz or timed chat' else 'Murder in Plain Sight' end));
  return jsonb_build_object('id',eid);
 end if;
 if cmd='configure' then
  result:=private.game_command_before_second_mode(cmd,eid,args);
  update private.event_settings set
   second_murder_standard=coalesce((args->>'second_murder_standard')::boolean,false),
   plain_slot=case when coalesce((args->>'second_murder_standard')::boolean,false) then null else 1 end
   where event_id=eid;
  return result;
 end if;
 if not coalesce(cfg.second_murder_standard,false) then return private.game_command_before_second_mode(cmd,eid,args);end if;
 if cmd like 'plain_%' then raise exception 'Standard second murder is selected. Use its private target choices, Lock second murder choices and Reveal outcome. To use physical tasks, FS Penny must switch the format in Setup before anything is sent or opened.';end if;
 if cmd='start_task' then
  select value into item from jsonb_array_elements(cfg.timetable) where value->>'id'=args->>'row';action:=item->>'action';
 end if;
 if (action='mission' and coalesce((case when cmd='start_task' then item->>'mission' else args->>'mission' end)::int,-1)=2) or action in ('finale','finish') then
  for g in select s.* from private.group_state s where s.event_id=eid and (not(args ? 'group') or s.group_id=(args->>'group')::uuid)
   and (owner=uid or exists(select 1 from private.staff st where st.event_id=eid and st.account_id=uid and st.group_id=s.group_id)) loop
   if private.second_murder_pending(eid,g.group_id) then raise exception 'Finish this flight standard second murder before Final Review: complete round table 2, open second murder during the break, collect private choices, lock them and publish the outcome. No quiz is required.';end if;
  end loop;
 end if;
 if action='open_murder' then slot:=(case when cmd='start_task' then item->>'slot' else args->>'slot' end)::int;normal_second:=slot=1;
 elsif cmd='publish_ready' and args->>'kind'='murder' then normal_second:=(args->>'slot')::int=1;
 elsif cmd='propose' then normal_second:=exists(select 1 from private.murder_windows where id=(args->>'opportunity')::uuid and event_id=eid and slot=1 and mode='standard');
 elsif cmd='lock_murder' then
  normal_second:=exists(select 1 from private.group_state s join private.murder_windows w on w.id=s.opportunity where s.event_id=eid and w.slot=1 and w.mode='standard'
   and (not(args ? 'group') or s.group_id=(args->>'group')::uuid) and (owner=uid or exists(select 1 from private.staff st where st.event_id=eid and st.account_id=uid and st.group_id=s.group_id)));
 end if;
 if normal_second then
  if owner is distinct from uid and cmd in ('open_murder','lock_murder','publish_ready') then raise exception 'Only FS Penny may open, lock or publish the standard second murder. Flight NCO controls remain unchanged.';end if;
  if cmd='publish' and owner is distinct from uid and exists(select 1 from private.reveals r join private.murder_windows w on w.id=r.opportunity where r.id=(args->>'reveal')::uuid and w.event_id=eid and w.slot=1) then raise exception 'Only FS Penny may reveal the second murder. Its result remains private.';end if;
  if action='open_murder' then
   select coalesce(array_agg(id),'{}') into before_ids from private.murder_windows where event_id=eid;
  end if;
  if cmd='lock_murder' and args ? 'target' then
   if owner is distinct from uid then raise exception 'Only FS Penny can record a manual victim. Flight NCOs can lock the Traitors saved choices.';end if;
   if not(args ? 'group') then raise exception 'Choose one flight before recording a manual second-murder victim.';end if;
   pid:=(args->>'target')::uuid;
   if not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=pid and p.event_id=eid and p.group_id=(args->>'group')::uuid and p.status='Active' and s.role='Faithful') then raise exception 'Choose an active Faithful in this flight. No replacement victim has been selected.';end if;
  end if;
  -- This established dispatcher retains eligibility, permission, stale-request,
  -- shield and publication checks, without entering the first-murder quiz handler.
  result:=private.game_command_before_raf_quiz(cmd,eid,args);
  if action='open_murder' then
   update private.group_state s set planning_until=null from private.murder_windows w
    where w.id=s.opportunity and w.event_id=eid and w.slot=1 and not(w.id=any(before_ids));
  end if;
  return result;
 end if;
 return private.game_command_before_second_mode(cmd,eid,args);
end $$;
revoke all on function private.game_command(text,uuid,jsonb) from public,anon,authenticated;

-- The physical-task router normally blocks every second-murder entry point.
-- Permit only the standard-selection equivalents in standard mode. First
-- murder still passes through the quiz layer above it.
do $$declare def text:=pg_get_functiondef('private.game_command_before_raf_quiz(text,uuid,jsonb)'::regprocedure);
begin
 def:=replace(def,
  'if cmd=''open_murder'' and (args->>''slot'')::int=1 then',
  'if cmd=''open_murder'' and (args->>''slot'')::int=1 and not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) then');
 def:=replace(def,
  'if cmd=''start_task'' and exists(select 1 from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) row where row->>''id''=args->>''row'' and row->>''action''=''open_murder'' and row->>''slot''=''1'') then',
  'if cmd=''start_task'' and not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) and exists(select 1 from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) row where row->>''id''=args->>''row'' and row->>''action''=''open_murder'' and row->>''slot''=''1'') then');
 def:=replace(def,
  'if cmd=''publish_ready'' and args->>''kind''=''murder'' and (args->>''slot'')::int=1 then',
  'if cmd=''publish_ready'' and args->>''kind''=''murder'' and (args->>''slot'')::int=1 and not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) then');
 if position('not coalesce((select second_murder_standard' in def)=0 then raise exception 'Could not safely relax the standard second-murder guards.';end if;
 execute def;
end $$;

-- The original murder resolver also constrained opportunity 2 to the Vault
-- mission. In standard mode it is opened during the break after round table 2.
do $$declare def text:=pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure);
begin
 def:=replace(def,
  'if number=1 and gs.phase<>''Mission'' then raise exception ''Open the supervised objective during its physical mission.''; end if;',
  'if number=1 and not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) and gs.phase<>''Mission'' then raise exception ''Open the supervised objective during its physical mission.''; end if;');
 def:=replace(def,
  'textval:=case when number=1 then ''plain'' else ''standard'' end;',
  'textval:=case when number=1 and not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) then ''plain'' else ''standard'' end;');
 if position('not coalesce((select second_murder_standard' in def)=0 or position('textval:=case when number=1 and not coalesce' in def)=0 then raise exception 'Could not safely update the standard second-murder checks.';end if;
 execute def;
end $$;

do $$begin execute replace(pg_get_functiondef('private.control_check(uuid,uuid,text,jsonb)'::regprocedure),'private.control_check(','private.control_check_before_second_mode(');end $$;
create or replace function private.control_check(eid uuid,gid uuid,cmd text,args jsonb default '{}') returns jsonb
language plpgsql stable set search_path='' as $$
declare gs private.group_state;w private.murder_windows;
begin
 if not coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) then return private.control_check_before_second_mode(eid,gid,cmd,args);end if;
 select * into gs from private.group_state where event_id=eid and group_id=gid;
 select * into w from private.murder_windows where id=gs.opportunity;
 if cmd='open_murder' and (args->>'slot')::int=1 then
  if gs.done then return private.control_answer(false,'flight_finished','This flight has finished. Do not open another murder.');end if;
  if gs.banishments<2 then return private.control_answer(false,'second_round_needed','Complete and publish or skip round table 2 before opening the standard second murder during the break.','discussion','{"round":2}');end if;
  if exists(select 1 from private.ballots_v2 where group_id=gid and status in ('open','tie','empty')) or exists(select 1 from private.reveals where group_id=gid and not published) then
   return private.control_answer(false,'second_round_unresolved','Resolve this flight’s open ballot and reveal or skip its round table 2 result before opening the standard second murder.','page','{"page":"overview"}');
  end if;
  return private.control_answer(true,'standard_second_ready','Round table 2 is complete. Open the standard second murder during the break.','open_murder','{"slot":1}');
 end if;
 if ((cmd='mission' and (args->>'mission')::int=2) or cmd='finale') and private.second_murder_pending(eid,gid) then
  return private.control_answer(false,'second_murder_pending','Finish the standard second murder: open it during the break, collect private choices, lock them and publish the outcome before Final Review.','page','{"page":"overview"}');
 end if;
 if cmd='lock_murder' and w.slot=1 and w.mode='standard' then return private.control_check_before_raf_quiz(eid,gid,cmd,args);end if;
 return private.control_check_before_second_mode(eid,gid,cmd,args);
end $$;

do $$begin execute replace(pg_get_functiondef('private.group_next_step(uuid,uuid)'::regprocedure),'private.group_next_step(','private.group_next_step_before_second_mode(');end $$;
create or replace function private.group_next_step(eid uuid,gid uuid) returns jsonb language plpgsql stable set search_path='' as $$
begin
 if coalesce((select second_murder_standard from private.event_settings where event_id=eid),false) and private.second_murder_pending(eid,gid)
  and not exists(select 1 from private.murder_windows where group_id=gid and slot=1)
  and not exists(select 1 from private.ballots_v2 where group_id=gid and status<>'skipped' and not published)
  and not exists(select 1 from private.reveals where group_id=gid and not published) then
   return private.control_answer(true,'second_murder_ready','Round table 2 is complete. Open the standard second murder during the break.','open_murder','{"slot":1}');
 end if;
 return private.group_next_step_before_second_mode(eid,gid);
end $$;

do $$begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_second_mode(');end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;standard boolean;locked boolean;
begin
 result:=private.snapshot_before_second_mode(eid);if eid is null then return result;end if;
 select second_murder_standard into standard from private.event_settings where event_id=eid;
 locked:=exists(select 1 from private.murder_windows where event_id=eid and slot=1) or exists(select 1 from private.plain_tasks where event_id=eid and state<>'draft');
 result:=result||jsonb_build_object('second_murder_standard',standard,'second_mode_locked',locked);
 return result;
end $$;
revoke all on function private.snapshot_before_second_mode(uuid),private.control_check_before_second_mode(uuid,uuid,text,jsonb),private.group_next_step_before_second_mode(uuid,uuid),private.second_murder_pending(uuid,uuid) from public,anon,authenticated;
revoke all on function private.snapshot(uuid) from public,anon;
grant execute on function private.snapshot(uuid) to authenticated;
notify pgrst,'reload schema';
