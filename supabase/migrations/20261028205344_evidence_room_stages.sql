-- No event content is changed by installing this migration. Apply is a host action.
alter table private.event_settings add column mission_revision bigint not null default 1;
alter table private.event_settings add column mission_plan_id text;

-- Public cards and timetable are appended by scripts/package-mission-plan.mjs.

do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_mission_plan('); end $$;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account(); cfg private.event_settings; item jsonb; card jsonb; material jsonb; rows jsonb; result jsonb; seen text[]:='{}'; oldtime text:='';
begin
 if cmd='score' and coalesce(args->>'points','')!~'^[0-9]+$' then raise exception 'Enter whole stage points within its limit.'; end if;
 if cmd not in ('apply_mission_plan','timetable','edit_mission') then return private.game_command_before_mission_plan(cmd,eid,args); end if;
 if uid is null or not exists(select 1 from public.events where id=eid and owner_id=uid) then raise exception 'Only the main host can change this event plan.'; end if;
 perform 1 from public.events where id=eid for update;
 select * into cfg from private.event_settings where event_id=eid for update;
 if cmd in ('timetable','apply_mission_plan') and (args->>'revision')::bigint is distinct from cfg.timetable_revision then raise exception 'The running order changed on another device. Reload the timetable before continuing.'; end if;
 if cmd in ('edit_mission','apply_mission_plan') and (args->>'mission_revision')::bigint is distinct from cfg.mission_revision then raise exception 'The mission cards changed on another device. Reload before saving.'; end if;
 if cmd='edit_mission' then
  if exists(select 1 from private.mission_scores where event_id=eid and mission=(args->>'mission')::int and points>(args->>'max_points')::int) then raise exception 'The maximum cannot be below a saved stage score.'; end if;
  if exists(select 1 from unnest(array['notes','answer','scoring']) k where length(coalesce(args->>k,''))>24000) then raise exception 'Private mission text is too long.'; end if;
  if coalesce(length(args->>'title'),0) not between 1 and 80 or coalesce(length(args->>'instructions'),0) not between 1 and 1000
   or coalesce((args->>'max_points')::int,-1) not between 0 and 1000 or coalesce((args->>'minutes')::int,0) not between 1 and 60 then raise exception 'Check stage title, briefing, duration and maximum points.'; end if;
  update private.missions set title=args->>'title',instructions=args->>'instructions',equipment=coalesce(args->>'equipment',''),
   notes=coalesce(args->>'notes',''),answer=coalesce(args->>'answer',''),scoring=coalesce(args->>'scoring',''),max_points=(args->>'max_points')::int,minutes=(args->>'minutes')::int
   where event_id=eid and idx=(args->>'mission')::int;
  if not found then raise exception 'Stage not found.'; end if;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('mission',args->'mission','scope','selected event'));
  update private.event_settings set mission_revision=mission_revision+1 where event_id=eid;
  return jsonb_build_object('id',eid);
 end if;
 if cmd='apply_mission_plan' then
  if args->>'plan_id' is distinct from '2026-11-02-archive-evidence' or args->>'confirm' is distinct from (select title from public.events where id=eid) then raise exception 'Confirm the selected event title and mission plan.'; end if;
  if jsonb_typeof(args->'private_material') is distinct from 'array' or jsonb_array_length(args->'private_material')<>3 then raise exception 'Supply all three private stage packs through the protected host editor.'; end if;
  for card in select value from jsonb_array_elements(private.mission_plan_cards()) loop
   select value into material from jsonb_array_elements(args->'private_material') where value->>'idx'=card->>'idx';
   if material is null or (select count(*) from jsonb_array_elements(args->'private_material') where value->>'idx'=card->>'idx')<>1
    or exists(select 1 from unnest(array['notes','answer','scoring']) k where coalesce(length(trim(material->>k)),0) not between 1 and 24000) then raise exception 'Each stage needs its private clues, answers, hints and marking rules.'; end if;
   if exists(select 1 from private.mission_scores where event_id=eid and mission=(card->>'idx')::int and points>(card->>'max_points')::int) then raise exception 'A saved score exceeds the proposed stage maximum. No records have changed.'; end if;
   update private.missions set title=card->>'title',instructions=card->>'instructions',equipment=card->>'equipment',minutes=(card->>'minutes')::int,max_points=(card->>'max_points')::int,
    notes=material->>'notes',answer=material->>'answer',scoring=material->>'scoring' where event_id=eid and idx=(card->>'idx')::int;
   if not found then raise exception 'A stage record is missing. No records have changed.'; end if;
  end loop;
  rows:=private.mission_plan_timetable();
  update private.event_settings set mission_revision=mission_revision+1,mission_plan_id=args->>'plan_id' where event_id=eid;
 else
  rows:=args->'rows';
 end if;
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 3 and 20 then raise exception 'Enter 3 to 20 timetable rows.'; end if;
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
 update private.event_settings set timetable=rows,timetable_revision=timetable_revision+1 where event_id=eid;
 -- Audit metadata never copies private material into a general log.
 insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('scope','selected event','plan_id',args->>'plan_id'));
 return jsonb_build_object('id',eid);
end $$;

-- Permit larger private packs only for the host's two protected editor actions.
-- Existing request IDs, receipts and quotas continue to handle retries unchanged.
do $$ declare def text; begin
 def:=pg_get_functiondef('private.command(text,uuid,jsonb)'::regprocedure);
 if position('octet_length(args::text)>4096' in def)=0 then raise exception 'Expected request size guard is missing.'; end if;
 def:=replace(def,'octet_length(args::text)>4096',
  'octet_length(args::text)>(case when cmd in (''apply_mission_plan'',''edit_mission'') and exists(select 1 from public.events where id=eid and owner_id=uid) then 250000 else 4096 end)');
 execute def;
end $$;

do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_mission_plan('); end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; cards jsonb;
begin
 result:=private.snapshot_before_mission_plan(eid);
 if eid is null then return result; end if;
 if (result->>'organiser')::boolean then
  return result||jsonb_build_object('mission_revision',(select mission_revision from private.event_settings where event_id=eid),'mission_plan_id',(select mission_plan_id from private.event_settings where event_id=eid));
 end if;
 -- Whitelist public fields. In particular, marking rules may contain solutions.
 select coalesce(jsonb_agg(jsonb_build_object('idx',m.idx,'title',m.title,'instructions',m.instructions,'equipment',m.equipment,'minutes',m.minutes,'max_points',m.max_points)),'[]') into cards
 from private.missions m join private.group_state g on g.event_id=m.event_id and g.mission=m.idx
 join public.players p on p.group_id=g.group_id and p.user_id=private.current_account()
 where m.event_id=eid and g.phase='Mission';
 return jsonb_set(result,'{missions}',cards);
end $$;
-- The second supervised result is deliberately held through round table 2.
-- All other pending outcomes keep the existing transition guard.
do $$ declare def text; needle text; begin
 def:=pg_get_functiondef('private.control_check(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='where event_id=eid and group_id=gid and not published order by created_at limit 1';
 if position(needle in def)=0 then raise exception 'Expected pending-outcome guard is missing.'; end if;
 def:=replace(def,needle,'where event_id=eid and group_id=gid and not published and not (cmd=''discussion'' and g.mission=1 and c.mission_plan_id=''2026-11-02-archive-evidence'' and exists(select 1 from private.murder_windows held where held.id=opportunity and held.slot=1 and held.mode=''plain'' and held.status=''resolved'')) order by created_at limit 1');
 execute def;
 def:=pg_get_functiondef('private.group_next_step(uuid,uuid)'::regprocedure);
 needle:='where group_id=gid and not published order by created_at limit 1';
 if position(needle in def)=0 then raise exception 'Expected next-step outcome guard is missing.'; end if;
 def:=replace(def,needle,'where group_id=gid and not published and not (g.mission=1 and g.banishments=1 and (select mission_plan_id from private.event_settings where event_id=eid)=''2026-11-02-archive-evidence'' and exists(select 1 from private.murder_windows held where held.id=opportunity and held.slot=1 and held.mode=''plain'' and held.status=''resolved'')) order by created_at limit 1');
 execute def;
end $$;

do $$ begin execute replace(pg_get_functiondef('private.board(uuid)'::regprocedure),'private.board(','private.board_before_mission_plan('); end $$;
create or replace function private.board(token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.board_before_mission_plan(token);
 -- The roster display needs no mission evidence, including future briefings.
 return jsonb_set(result,'{missions}','[]');
end $$;

-- Keep existing murder rules and transitions, updating only obsolete mission names.
do $$ declare def text; signature text; begin
 foreach signature in array array['private.control_check(uuid,uuid,text,jsonb)','private.game_command_v4(text,uuid,jsonb)'] loop
  def:=pg_get_functiondef(signature::regprocedure);
  def:=replace(replace(def,'The Vault','The Evidence Room: Case investigation'),'vault_needed','case_needed');
  execute def;
 end loop;
end $$;
revoke all on function private.game_command_before_mission_plan(text,uuid,jsonb),private.game_command(text,uuid,jsonb),private.snapshot_before_mission_plan(uuid),private.board_before_mission_plan(uuid),private.board(uuid),private.snapshot(uuid) from public,anon,authenticated;
grant execute on function private.snapshot(uuid) to authenticated;
grant execute on function private.board(uuid) to anon,authenticated;
notify pgrst,'reload schema';
-- BEGIN GENERATED PUBLIC MISSION PLAN
create or replace function private.mission_plan_cards() returns jsonb language sql immutable set search_path='' as $$ select '[{"idx":0,"title":"The Locked Archive","minutes":25,"max_points":100,"instructions":"Work in three teams to decode Signals, Plotting and Registry evidence. Combine your digits in that order and ask the NCO to check the code before opening the archive. Keep clues within your flight. Explain your reasoning. Phones away during the physical task unless an NCO asks otherwise.","equipment":"Three printed clue packs, response sheet, pens and a three digit lockbox or sealed envelope."},{"idx":1,"title":"The Evidence Room: Case investigation","minutes":20,"max_points":125,"instructions":"A fictional classified file called RAVEN has been stolen. Compare the witness statement, badge register, door log, clock notice and storage records. Identify the suspect, theft time, exact hiding place, false claim and the evidence chain. Submit one flight response. These fictional characters have no connection to players’ secret roles.","equipment":"Printed case packs, response sheet and pens. Keep final-review evidence sealed until the later activity."},{"idx":2,"title":"The Evidence Room: Final Review","minutes":15,"max_points":100,"instructions":"Reopen the same case. Compare the new evidence with the original file. Decide which new report is false, explain why and identify who submitted it. State whether your original conclusion changes. Submit one final flight response.","equipment":"Retained case papers, sealed final-review pack, response sheet and pens."}]'::jsonb; $$;
revoke all on function private.mission_plan_cards() from public,anon,authenticated;
create or replace function private.mission_plan_timetable() returns jsonb language sql immutable set search_path='' as $$ select '[{"id":"briefing","time":"19:00","minutes":10,"label":"Welcome and joining","action":"activity","mission":null,"slot":null},{"id":"roles","time":"19:10","minutes":5,"label":"Joining checks and role release","action":"release_roles","mission":null,"slot":null},{"id":"archive","time":"19:15","minutes":25,"label":"The Locked Archive","action":"mission","mission":0,"slot":null},{"id":"round1","time":"19:40","minutes":10,"label":"Round table 1","action":"discussion","mission":null,"slot":null},{"id":"murder1","time":"19:50","minutes":5,"label":"First murder opportunity and reveal","action":"open_murder","mission":null,"slot":0},{"id":"vault","time":"19:55","minutes":20,"label":"The Evidence Room: Case investigation","action":"mission","mission":1,"slot":null},{"id":"round2","time":"20:15","minutes":10,"label":"Round table 2","action":"discussion","mission":null,"slot":null},{"id":"break","time":"20:25","minutes":10,"label":"Break and second murder reveal","action":"activity","mission":null,"slot":null},{"id":"transmission","time":"20:35","minutes":15,"label":"The Evidence Room: Final Review","action":"mission","mission":2,"slot":null},{"id":"round3","time":"20:50","minutes":15,"label":"Final round table","action":"discussion","mission":null,"slot":null},{"id":"results","time":"21:05","minutes":5,"label":"Final reveals and awards","action":"finish","mission":null,"slot":null},{"id":"clearup","time":"21:10","minutes":5,"label":"Clear up and form up","action":"activity","mission":null,"slot":null},{"id":"parade","time":"21:15","minutes":15,"label":"Parade","action":"activity","mission":null,"slot":null}]'::jsonb; $$;
revoke all on function private.mission_plan_timetable() from public,anon,authenticated;
