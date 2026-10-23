-- Four flights and an owner-wide, versioned running order. Private state stays private.
create table private.host_preferences(
 account_id uuid primary key references private.accounts(id) on delete cascade,
 timetable jsonb not null, revision bigint not null default 1
);
alter table private.host_preferences enable row level security;
revoke all on private.host_preferences from public,anon,authenticated;
alter table private.event_settings add column timetable_revision bigint not null default 1;
-- The application authorises through fixed RPCs; legacy direct-read policies are obsolete.
drop policy if exists "Owner reads event" on public.events;
drop policy if exists "Owner reads groups" on public.event_groups;
drop policy if exists "Owner or player reads profile" on public.players;
drop policy if exists "Owner or player reads own role" on public.player_secrets;
revoke all on public.events,public.event_groups,public.players,public.player_secrets from anon,authenticated;

do $$ begin execute replace(pg_get_functiondef('private.default_timetable()'::regprocedure),'private.default_timetable()','private.default_timetable_v4()'); end $$;
create function private.decorate_timetable(rows jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(value || jsonb_build_object(
 'id',coalesce(value->>'id',(array['briefing','roles','archive','round1','murder1','vault','round2','break','transmission','round3','results','clearup','parade'])[ordinality::int],'activity'||ordinality),
 'action',coalesce(value->>'action',(array['activity','release_roles','mission','discussion','open_murder','mission','discussion','activity','mission','discussion','finish','activity','activity'])[ordinality::int],'activity'),
 'mission',coalesce(value->'mission',case ordinality when 3 then '0'::jsonb when 6 then '1'::jsonb when 9 then '2'::jsonb else 'null'::jsonb end),
 'slot',coalesce(value->'slot',case when ordinality=5 then '0'::jsonb else 'null'::jsonb end)) order by ordinality),'[]'::jsonb)
 from jsonb_array_elements(rows) with ordinality;
$$;
create or replace function private.default_timetable() returns jsonb language sql immutable set search_path='' as $$
 select private.decorate_timetable(private.default_timetable_v4());
$$;
insert into private.host_preferences(account_id,timetable)
 select distinct on(e.owner_id) e.owner_id,private.decorate_timetable(s.timetable)
 from public.events e join private.event_settings s on s.event_id=e.id order by e.owner_id,e.created_at,e.id;
update private.event_settings s set timetable=p.timetable,timetable_revision=p.revision
 from public.events e join private.host_preferences p on p.account_id=e.owner_id where e.id=s.event_id;

do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_v4('); end $$;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 uid uuid:=private.current_account(); owner uuid; result jsonb; item jsonb; rows jsonb; cfg private.event_settings;
 prefs private.host_preferences; oldtime text:=''; action text; ids uuid[]; gid uuid; n integer; seen text[]:='{}';
begin
 if uid is null then raise exception 'Sign in with your name and PIN first.'; end if;
 if cmd='create' then
  if coalesce((args->>'groups')::int,4)<>4 then raise exception 'This event uses exactly four groups.'; end if;
  result:=private.game_command_v4(cmd,eid,args||jsonb_build_object('groups',4,'size',coalesce((args->>'size')::int,13)));
  eid:=(result->>'id')::uuid;
  with ordered as(select id,row_number() over(order by array_position(array['Raven','Ember','Thorn','Ash'],name),id)::int as n from public.event_groups where event_id=eid)
  update public.event_groups g set name=(array['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'])[o.n] from ordered o where g.id=o.id;
  insert into private.host_preferences(account_id,timetable) values(uid,private.default_timetable()) on conflict do nothing;
  select * into prefs from private.host_preferences where account_id=uid;
  update private.event_settings set timetable=prefs.timetable,timetable_revision=prefs.revision where event_id=eid;
  return result;
 end if;
 if cmd not in ('timetable','start_task') then
  if cmd='configure' and jsonb_array_length(args->'groups')<>4 then raise exception 'This event uses exactly four groups.'; end if;
  return private.game_command_v4(cmd,eid,args);
 end if;
 select owner_id into owner from public.events where id=eid;
 if owner is null then raise exception 'Event not found.'; end if;
 -- Lock the shared owner template before any event; all timetable writers use this order.
 if cmd='timetable' then
  if owner<>uid then raise exception 'Only the main host can edit the timetable.'; end if;
  select * into prefs from private.host_preferences where account_id=owner for update;
 end if;
 perform 1 from public.events where id=eid for update;
 select * into cfg from private.event_settings where event_id=eid;
 if args ? 'revision' and (args->>'revision')::bigint is distinct from cfg.timetable_revision then raise exception 'The running order changed on another device. Reload the timetable before continuing.'; end if;
 if cmd='timetable' then
  rows:=args->'rows';
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 3 and 20 then raise exception 'Enter 3 to 20 timetable rows.'; end if;
  -- Old clients without action IDs can still save the standard running order.
  if not ((rows->0) ? 'id') then rows:=private.decorate_timetable(rows); end if;
  for item in select value from jsonb_array_elements(rows) loop
   if coalesce(item->>'id','')!~'^[a-zA-Z0-9_-]{1,40}$' or item->>'id'=any(seen)
    or coalesce(item->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'time'<=oldtime
    or coalesce((item->>'minutes')::int,0) not between 1 and 60 or coalesce(length(trim(item->>'label')),0) not between 1 and 80
    or coalesce(item->>'action','') not in ('activity','mission','discussion','open_murder','release_roles','finish')
    or (item->>'action'='mission' and coalesce((item->>'mission')::int,-1) not between 0 and 2)
    or (item->>'action'='open_murder' and coalesce((item->>'slot')::int,-1) not between 0 and 1)
   then raise exception 'Check unique activity IDs, increasing times, durations and activity types.'; end if;
   seen:=array_append(seen,item->>'id');oldtime:=item->>'time';
  end loop;
  update private.host_preferences set timetable=rows,revision=revision+1 where account_id=owner returning * into prefs;
  update private.event_settings s set timetable=rows,timetable_revision=prefs.revision
   from public.events e where e.id=s.event_id and e.owner_id=owner;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('revision',prefs.revision,'scope','all owned events'));
 else
  if not (args ? 'revision') then raise exception 'Reload the timetable before starting an activity.'; end if;
  select value into item from jsonb_array_elements(cfg.timetable) where value->>'id'=args->>'row';
  if item is null then raise exception 'Activity not found. Reload the timetable.'; end if;
  action:=item->>'action';
  -- Resolve actions from the saved server row, never from browser-supplied commands.
  if action='activity' then
   if owner<>uid then raise exception 'Only the main host can start a whole-event activity.'; end if;
   if (select ended from private.games where event_id=eid) and item->>'id' not in ('clearup','parade') then raise exception 'The event has ended.'; end if;
   if exists(select 1 from private.group_state s where s.event_id=eid and (not (args ? 'group') or s.group_id=(args->>'group')::uuid)
    and (s.phase='Voting' or exists(select 1 from private.murder_windows w where w.group_id=s.group_id and w.status='open'))) then raise exception 'Resolve the open ballot or murder opportunity first.'; end if;
   update private.games set announcement=item->>'label' where event_id=eid;
   update private.group_state set phase='Briefing',paused=false,remaining=(item->>'minutes')::int*60,deadline=now()+make_interval(mins=>(item->>'minutes')::int)
    where event_id=eid and (not (args ? 'group') or group_id=(args->>'group')::uuid);
   insert into private.audit(event_id,actor,action,details) values(eid,uid,'start_task',jsonb_build_object('row',item->>'id','text',item->>'label'));
  else
   result:=private.game_command_v4(action,eid,args||jsonb_build_object('mission',item->'mission','slot',item->'slot'));
   if action in ('mission','discussion','open_murder') then
    select array_agg(s.group_id) into ids from private.group_state s where s.event_id=eid
     and (not (args ? 'group') or s.group_id=(args->>'group')::uuid)
     and (owner=uid or exists(select 1 from private.staff a where a.event_id=eid and a.account_id=uid and a.group_id=s.group_id));
    update private.group_state set remaining=(item->>'minutes')::int*60,deadline=now()+make_interval(mins=>(item->>'minutes')::int),paused=false where group_id=any(ids);
    update private.murder_windows set deadline=now()+make_interval(mins=>(item->>'minutes')::int) where group_id=any(ids) and status='open';
   end if;
  end if;
 end if;
 return jsonb_build_object('id',eid);
end $$;

do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_v4('); end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.snapshot_v4(eid);
 if eid is not null then result:=result||jsonb_build_object('timetable_revision',(select timetable_revision from private.event_settings where event_id=eid)); end if;
 return result;
end $$;
revoke all on function private.game_command_v4(text,uuid,jsonb), private.snapshot_v4(uuid),private.default_timetable_v4(),private.decorate_timetable(jsonb),private.default_timetable(),private.game_command(text,uuid,jsonb),private.snapshot(uuid) from public,anon,authenticated;
grant execute on function private.snapshot(uuid) to authenticated;

-- Consolidate only unstarted events. Retain every player, role, assignment and decision.
do $$
#variable_conflict use_column
declare ev record; removable uuid; n int; g record;
begin
 for ev in select e.id from public.events e join private.event_settings s on s.event_id=e.id
  where not s.roles_released and not exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.event_id=e.id)
  and (select count(*) from public.event_groups where event_id=e.id)=5
  and not exists(select 1 from private.ballots_v2 where event_id=e.id)
  and not exists(select 1 from private.murder_windows where event_id=e.id)
  and not exists(select 1 from private.mission_scores where event_id=e.id)
 loop
  select g.id into removable from public.event_groups g where g.event_id=ev.id
   and not exists(select 1 from public.players p where p.group_id=g.id)
   and not exists(select 1 from private.staff s where s.group_id=g.id)
   order by g.name desc,g.id limit 1;
  if removable is null then continue; end if;
  delete from public.event_groups where id=removable;
  n:=0;
  for g in select id,name from public.event_groups where event_id=ev.id order by name,id loop
   n:=n+1;
   if g.name=any(array['Raven','Ember','Thorn','Ash','Vesper']) then update public.event_groups set name=(array['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'])[n] where id=g.id; end if;
  end loop;
  update private.group_state set capacity=greatest(capacity,13) where event_id=ev.id;
  update private.games set capacity=(select sum(capacity) from private.group_state where event_id=ev.id) where event_id=ev.id;
 end loop;
end $$;
notify pgrst,'reload schema';
