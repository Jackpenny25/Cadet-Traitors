-- Readable labels stay in the protected role table, never in a public roster RPC.
alter table public.player_secrets add column player_name text, add column player_number integer,
 add column group_name text, add column event_name text;
create function private.role_labels() returns trigger language plpgsql set search_path='' as $$
begin
 select p.display_name,p.player_number,g.name,e.title into new.player_name,new.player_number,new.group_name,new.event_name
 from public.players p join public.event_groups g on g.id=p.group_id join public.events e on e.id=p.event_id where p.id=new.player_id;
 return new;
end $$;
create trigger role_labels before insert or update on public.player_secrets for each row execute function private.role_labels();
update public.player_secrets set player_name=player_name;
create function private.refresh_role_labels() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='players' then update public.player_secrets set player_name=player_name where player_id=new.id;
 elsif tg_table_name='event_groups' then update public.player_secrets s set player_name=player_name from public.players p where p.id=s.player_id and p.group_id=new.id;
 else update public.player_secrets s set player_name=player_name from public.players p where p.id=s.player_id and p.event_id=new.id;
 end if;
 return new;
end $$;
create trigger refresh_role_labels after update of display_name,player_number,group_id,event_id on public.players for each row execute function private.refresh_role_labels();
create trigger refresh_role_labels after update of name on public.event_groups for each row execute function private.refresh_role_labels();
create trigger refresh_role_labels after update of title on public.events for each row execute function private.refresh_role_labels();
revoke all on function private.role_labels(),private.refresh_role_labels() from public,anon,authenticated;

create function private.control_answer(ok boolean,code text,message text,next_command text default null,next_args jsonb default '{}',noop boolean default false)
 returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('allowed',ok,'code',code,'reason',message,'next',next_command,'next_args',next_args,'noop',noop);
$$;
create function private.control_check(eid uuid,gid uuid,cmd text,args jsonb default '{}') returns jsonb language plpgsql stable set search_path='' as $$
#variable_conflict use_column
declare g private.group_state; c private.event_settings; b private.ballots_v2; w private.murder_windows; r private.reveals;
 block jsonb; n int; wanted int; title text; uid uuid:=private.current_account();
begin
 select * into g from private.group_state where group_id=gid and event_id=eid;
 if g.group_id is null then return private.control_answer(false,'missing_group','This group no longer exists. Reload Event home.'); end if;
 select * into c from private.event_settings where event_id=eid;
 select * into b from private.ballots_v2 where id=g.ballot;
 select * into w from private.murder_windows where id=g.opportunity;
 if (select ended from private.games where event_id=eid) then return private.control_answer(false,'ended','The event has ended. Open a separate rehearsal to practise further.'); end if;
 if not c.roles_released and cmd not in ('pause','resume','extend') then return private.control_answer(false,'roles_sealed','Private roles are not released. Prepare random roles, then Release private envelopes in Main host.'); end if;
 if args ? 'round' and cmd in ('close_vote','runoff','random_draw','reopen_ballot','skip_ballot','test_votes','publish_ballot') and b.round is distinct from (args->>'round')::int then
  if g.banishments>=coalesce((args->>'round')::int,0) then return private.control_answer(false,'round_complete','This round table is already complete. Its previous result is kept.',null,'{}',true); end if;
  return private.control_answer(false,'different_ballot','This control belongs to round table '||(args->>'round')||', but this group has '||coalesce('round table '||b.round,'no ballot')||'. Use its next-step card to finish the current stage first.');
 end if;
 -- Return just the next concrete step, rather than a repeated list of an entire round.
 if b.id is not null and not b.published and b.status<>'skipped' then
  if b.status='open' then block:=private.control_answer(false,'ballot_open','Voting is open. Use Close voting once the players have voted.','close_vote');
  elsif b.status='empty' then block:=private.control_answer(false,'ballot_empty','This ballot received no votes. Use Reopen empty ballot to collect votes, or Skip empty ballot to continue without a banishment.','reopen_ballot');
  elsif b.status='tie' then block:=private.control_answer(false,case when b.runoff then 'runoff_tied' else 'ballot_tied' end,case when b.runoff then 'The runoff also tied. Use Draw after tied runoff; do not start another discussion.' else 'The ballot tied. Use Start tied runoff; do not start another discussion.' end,case when b.runoff then 'random_draw' else 'runoff' end);
  elsif b.status='resolved' then
   select * into r from private.reveals where ballot=b.id and not published limit 1;
   block:=private.control_answer(false,'ballot_private','Voting is closed and its result is ready. Use Reveal outcome; do not reopen discussion.','publish',jsonb_build_object('reveal',r.id));
  end if;
 end if;
 if cmd='publish_ballot' then
  if b.published or g.banishments>=coalesce((args->>'round')::int,g.mission+1) then return private.control_answer(false,'published','This round-table outcome is already public. It will not be revealed twice.',null,'{}',true); end if;
  if b.status='resolved' and r.id is not null then return private.control_answer(true,'ready','Ready to reveal this ballot outcome.','publish',jsonb_build_object('reveal',r.id)); end if;
  return coalesce(block,private.control_answer(false,'no_ballot','This group has no ballot result. Start discussion for this group first.','discussion'));
 end if;
 if cmd in ('mission','discussion','open_murder','planning','finale') and block is not null then return block; end if;
 -- A pending murder disclosure must not be silently bypassed by another stage.
 select * into r from private.reveals where event_id=eid and group_id=gid and not published order by created_at limit 1;
 if cmd in ('mission','discussion','open_murder','planning','finale') and r.id is not null then return private.control_answer(false,'outcome_private','A private outcome is ready. Use Reveal outcome for this group before continuing.','publish',jsonb_build_object('reveal',r.id)); end if;
 if cmd='pause' then
  if g.paused then return private.control_answer(false,'paused','This timer is already paused.',null,'{}',true); end if;
 elsif cmd='resume' then
  if not g.paused then return private.control_answer(false,'running','This timer is already running.',null,'{}',true); end if;
 elsif cmd='mission' then
  wanted:=(args->>'mission')::int;select m.title into title from private.missions m where m.event_id=eid and idx=wanted;
  if title is null then return private.control_answer(false,'mission_missing','Choose a saved mission from Missions.'); end if;
  if wanted<g.mission or wanted=g.mission and g.phase not in ('Roles','Joining','Briefing') then return private.control_answer(false,'mission_started',title||' has already started or finished for this group. Its timer will not be restarted.',null,'{}',true); end if;
  if wanted>0 and g.banishments<wanted and not g.done then return private.control_answer(false,'round_required','This group has not completed round table '||wanted||'. Start its discussion before moving to the next mission.','discussion'); end if;
  if g.phase in ('Discussion','Voting','Finale','Results') then return private.control_answer(false,'finish_round','Finish the current round-table stage before starting a mission.','open_vote'); end if;
  if w.status='open' then return private.control_answer(false,'murder_open',case when w.mode='plain' then 'The supervised objective is still open. Assign its objective if needed, then Resolve privately in the control room.' else 'The murder choices are still open. Use Lock standard choices, then reveal the outcome.' end,case when w.mode='standard' then 'lock_murder' else 'page' end,case when w.mode='plain' then '{"page":"overview"}'::jsonb else '{}'::jsonb end); end if;
 elsif cmd='discussion' then
  wanted:=coalesce((args->>'round')::int,g.mission+1);
  if g.done or g.banishments>=wanted then return private.control_answer(false,'round_complete','Round table '||wanted||' is already complete. Do not start it again. Move to the next mission or murder stage.',null,'{}',true); end if;
  if wanted<>g.mission+1 then return private.control_answer(false,'wrong_round','This round table belongs to a different mission. Start mission '||wanted||' first.','mission',jsonb_build_object('mission',wanted-1)); end if;
  if g.phase='Discussion' then return private.control_answer(false,'discussion_running','Discussion is already running. Use Open voting when ready.','open_vote','{}',true); end if;
  if g.phase not in ('Mission','Roles','Night','Planning','Closed') then return private.control_answer(false,'wrong_phase','This group is in '||g.phase||'. Finish that stage before discussion.'); end if;
  if w.status='open' then return private.control_answer(false,'murder_open','Finish the open murder opportunity before starting discussion.','page','{"page":"overview"}'); end if;
 elsif cmd='open_vote' then
  if g.done or g.banishments>=coalesce((args->>'round')::int,g.mission+1) then return private.control_answer(false,'round_complete','This round table is complete. Do not open another vote.',null,'{}',true); end if;
  if coalesce((args->>'round')::int,g.mission+1)<>g.mission+1 then return private.control_answer(false,'mission_required','This voting control belongs to a later mission. Complete the current stage, then begin mission '||(args->>'round')||'.','mission',jsonb_build_object('mission',(args->>'round')::int-1)); end if;
  if b.status='open' then return private.control_answer(false,'vote_running','Voting is already open. Its votes will be kept.','close_vote','{}',true); end if;
  if block is not null then return block; end if;
  if g.phase<>'Discussion' then return private.control_answer(false,'discussion_needed','Discussion has not started for this group. Use Start discussion first.','discussion',jsonb_build_object('round',g.mission+1)); end if;
 elsif cmd='close_vote' then
  if b.status<>'open' or b.id is null then
   if b.id is not null then return jsonb_set(coalesce(block,private.control_answer(false,'vote_closed','Voting is already closed. Its result is kept.')),'{noop}','true'); end if;
   return private.control_answer(false,'vote_not_open','There is no open vote. This group is in '||g.phase||'. Check its next-step card.');
  end if;
 elsif cmd='runoff' then
  if b.published or b.status='resolved' then return private.control_answer(false,'no_tie','This ballot has a result and does not need a runoff.',null,'{}',true); end if;
  if b.status is distinct from 'tie' or b.runoff then return coalesce(block,private.control_answer(false,'no_first_tie','A runoff is only needed after a tied first ballot.')); end if;
 elsif cmd='random_draw' then
  if b.published or b.status='resolved' then return private.control_answer(false,'no_tie','This ballot has a result and does not need a random draw.',null,'{}',true); end if;
  if b.status is distinct from 'tie' or not b.runoff then return coalesce(block,private.control_answer(false,'no_runoff_tie','A random draw is only available after the runoff also ties.')); end if;
 elsif cmd in ('reopen_ballot','skip_ballot') then
  if b.published then return private.control_answer(false,'round_complete','This outcome is already complete. It will be kept.',null,'{}',true); end if;
  if b.status is distinct from 'empty' then return coalesce(block,private.control_answer(false,'not_empty','This ballot is not empty. Reopening or skipping is not needed.')); end if;
 elsif cmd='open_murder' then
  wanted:=(args->>'slot')::int;
  if g.done then return private.control_answer(false,'deduction_complete','Deduction is complete. No further murder is needed.',null,'{}',true); end if;
  if exists(select 1 from private.murder_windows where group_id=gid and slot=wanted) then return private.control_answer(false,'opportunity_used','This murder opportunity has already opened. Use its private decision or reveal controls instead.',null,'{}',true); end if;
  if w.status='open' then return private.control_answer(false,'other_murder_open','A different murder opportunity is still open. Finish that private decision first.','page','{"page":"overview"}'); end if;
  if wanted=0 and g.banishments<1 then return private.control_answer(false,'first_round_needed','Round table 1 has no completed outcome. Start discussion for this group.','discussion','{"round":1}'); end if;
  if wanted=1 and g.mission<>1 then return private.control_answer(false,'vault_needed','The second murder happens during The Vault. Begin that mission first.','mission','{"mission":1}'); end if;
  if g.phase in ('Discussion','Voting') then return private.control_answer(false,'round_running','This group is still discussing or voting. Use its round-table controls first.','open_vote'); end if;
  if wanted=c.plain_slot and g.phase<>'Mission' then return private.control_answer(false,'objective_mission_needed','Begin the physical mission before opening its supervised objective.','mission',jsonb_build_object('mission',g.mission)); end if;
 elsif cmd='lock_murder' then
  if w.status is distinct from 'open' then
   select * into r from private.reveals where group_id=gid and opportunity is not null and not published limit 1;
   if r.id is not null then return private.control_answer(false,'murder_locked','The choices are already locked. Use Reveal outcome now.','publish',jsonb_build_object('reveal',r.id)); end if;
   return private.control_answer(false,'no_open_murder','No standard murder is open for this group. Open its available murder opportunity first.');
  end if;
  if w.mode<>'standard' then return private.control_answer(false,'supervised_objective','This is a supervised objective. Use Assign objective and Resolve privately in the control room, not Lock standard choices.','page','{"page":"overview"}'); end if;
 elsif cmd='publish_murder' then
  select * into w from private.murder_windows where group_id=gid and slot=(args->>'slot')::int;
  if w.status='published' or g.done and w.id is null then return private.control_answer(false,'published','This opportunity is complete or no longer needed.',null,'{}',true); end if;
  select * into r from private.reveals where opportunity=w.id and not published limit 1;
  if r.id is null then return private.control_answer(false,'murder_not_ready','This opportunity has no outcome ready. Lock standard choices or verify the supervised objective first.','lock_murder'); end if;
  return private.control_answer(true,'ready','Ready to reveal this murder outcome.','publish',jsonb_build_object('reveal',r.id));
 elsif cmd='planning' then
  if g.done then return private.control_answer(false,'deduction_complete','Deduction is complete. Private planning is no longer needed.',null,'{}',true); end if;
  if g.planning_until>now() then return private.control_answer(false,'planning_open','Private planning is already open.',null,'{}',true); end if;
  if g.phase not in ('Mission','Closed','Night','Planning') then return private.control_answer(false,'planning_stage','Private planning is available during a mission or after a completed round table.'); end if;
 elsif cmd='finale' then
  if g.phase='Finale' then return private.control_answer(false,'finale_started','The finale is already running.',null,'{}',true); end if;
  if not g.done and g.banishments<3 then return private.control_answer(false,'deduction_remaining','This group has completed '||g.banishments||' of 3 round tables. Continue its next mission and round table before the finale.'); end if;
 elsif cmd='test_votes' then
  if not c.practice then return private.control_answer(false,'not_practice','Test votes are only available in a rehearsal.'); end if;
  if b.status is distinct from 'open' then return coalesce(block,private.control_answer(false,'no_test_ballot','Open voting for this group before generating test votes.','open_vote')); end if;
  if g.paused then return private.control_answer(false,'paused','Resume this group’s timer in the control room before generating votes.','resume'); end if;
 end if;
 return private.control_answer(true,'ready','Ready.');
end $$;
revoke all on function private.control_answer(boolean,text,text,text,jsonb,boolean),private.control_check(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Run the same checks on the server. Preflight every selected group before any
-- mutation, then skip groups already at the requested stage without resetting them.
do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_control_checks('); end $$;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare action text:=cmd; payload jsonb:=args; row jsonb; g record; check_result jsonb; plan jsonb:='[]';
 failures text:=''; ready int:=0; skipped int:=0; result jsonb; permission text; name text; uid uuid:=private.current_account();
begin
 if cmd='start_task' then
  select value into row from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) where value->>'id'=args->>'row';
  action:=row->>'action';payload:=args||jsonb_build_object('mission',row->'mission','slot',row->'slot');
  if action='discussion' and row->>'id'~'^round[1-3]$' then payload:=payload||jsonb_build_object('round',right(row->>'id',1)::int); end if;
 elsif cmd='publish_ready' then action:=case when args->>'kind'='murder' then 'publish_murder' else 'publish_ballot' end;
 end if;
 if action is null or action<>all(array['mission','discussion','open_vote','close_vote','runoff','random_draw','skip_ballot','reopen_ballot','planning','open_murder','lock_murder','finale','pause','resume','extend','test_votes','publish_ballot','publish_murder']) then return private.game_command_before_control_checks(cmd,eid,args); end if;
 if uid is null then raise exception 'Sign in with your name and PIN first.'; end if;
 perform 1 from public.events where id=eid for update;
 permission:=case when action in ('publish_ballot','publish_murder') then 'publish' when action in ('pause','resume','extend') then 'timer' else action end;
 for g in select s.*,e.name from private.group_state s join public.event_groups e on e.id=s.group_id where s.event_id=eid
  and (not(args ? 'group') or s.group_id=(args->>'group')::uuid)
  and ((select owner_id=uid from public.events where id=eid) or exists(select 1 from private.staff a where a.event_id=eid and a.group_id=s.group_id and a.account_id=uid)) order by e.name loop
  if not private.can_control(eid,g.group_id,permission) then raise exception 'You are not permitted to use this action for %.',g.name; end if;
  check_result:=private.control_check(eid,g.group_id,action,payload);
  if (check_result->>'allowed')::boolean then ready:=ready+1;
  elsif (check_result->>'noop')::boolean then skipped:=skipped+1;
  else failures:=failures||case when failures<>'' then E'\n' else '' end||g.name||': '||(check_result->>'reason'); end if;
  plan:=plan||jsonb_build_array(jsonb_build_object('group',g.group_id,'check',check_result));
 end loop;
 if failures<>'' then raise exception 'Nothing has changed. Resolve these groups first:%',E'\n'||failures; end if;
 if ready=0 then raise exception 'Nothing has changed. The selected groups are already at this stage, have completed it, or no authorised group was selected. Check the next-step cards.'; end if;
 for row in select value from jsonb_array_elements(plan) loop
  if not (row->'check'->>'allowed')::boolean then continue; end if;
  if cmd='publish_ready' then
   if not coalesce(args->'expected_reveals','[]') @> jsonb_build_array(row->'check'->'next_args'->>'reveal') then raise exception 'The pending outcomes changed. Reload and check the names before revealing.'; end if;
   result:=private.game_command_before_control_checks('publish',eid,args||jsonb_build_object('group',row->>'group','reveal',row->'check'->'next_args'->>'reveal'));
  else result:=private.game_command_before_control_checks(cmd,eid,args||jsonb_build_object('group',row->>'group')); end if;
 end loop;
 return coalesce(result,jsonb_build_object('id',eid))||jsonb_build_object('groups_advanced',ready,'groups_unchanged',skipped);
end $$;
revoke all on function private.game_command_before_control_checks(text,uuid,jsonb),private.game_command(text,uuid,jsonb) from public,anon,authenticated;

create function private.group_next_step(eid uuid,gid uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare g private.group_state; b private.ballots_v2; w private.murder_windows; r private.reveals; cmd text; args jsonb:='{}'; result jsonb;
begin
 select * into g from private.group_state where group_id=gid;select * into b from private.ballots_v2 where id=g.ballot;select * into w from private.murder_windows where id=g.opportunity;
 if not (select roles_released from private.event_settings where event_id=eid) then return private.control_answer(false,'roles_sealed','Prepare and release the private envelopes in Main host.'); end if;
 if b.id is not null and not b.published and b.status<>'skipped' then
  result:=private.control_check(eid,gid,'publish_ballot','{}');return result;
 end if;
 select * into r from private.reveals where group_id=gid and not published order by created_at limit 1;
 if r.id is not null then return private.control_answer(false,'outcome_private','The outcome is ready. Reveal it to advance this group.','publish',jsonb_build_object('reveal',r.id)); end if;
 if w.status='open' then
  if w.mode='standard' then return private.control_answer(false,'choices_open','Collect the private target choices, then lock the decision.','lock_murder');
  else return private.control_answer(false,'objective_open',case when w.target is null then 'Assign a target and private objective in the control room.' else 'The supervised objective is assigned. Verify it physically, then Resolve privately in the control room.' end,'page','{"page":"overview"}'); end if;
 end if;
 if g.phase='Finale' then return private.control_answer(false,'finale_running','This group is ready for final results when every group has finished.'); end if;
 if g.done then cmd:='finale';
 elsif g.phase='Discussion' then cmd:='open_vote';
 elsif g.phase='Roles' then cmd:='mission';args:='{"mission":0}';
 elsif g.phase='Mission' and g.mission=1 and (select plain_slot from private.event_settings where event_id=eid)=1 and not exists(select 1 from private.murder_windows where group_id=gid and slot=1) then cmd:='open_murder';args:='{"slot":1}';
 elsif g.phase='Mission' and g.banishments<g.mission+1 then cmd:='discussion';args:=jsonb_build_object('round',g.mission+1);
 elsif g.banishments>=1 and not exists(select 1 from private.murder_windows where group_id=gid and slot=0) then cmd:='open_murder';args:='{"slot":0}';
 elsif g.mission<2 then cmd:='mission';args:=jsonb_build_object('mission',g.mission+1);
 else cmd:='discussion';args:=jsonb_build_object('round',g.mission+1);
 end if;
 result:=private.control_check(eid,gid,cmd,args);
 if (result->>'allowed')::boolean then return private.control_answer(true,'ready','Ready for the next stage.',cmd,args); end if;
 return result;
end $$;
revoke all on function private.group_next_step(uuid,uuid) from public,anon,authenticated;

do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_control_guidance('); end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; groups jsonb:='[]'; g jsonb; checks jsonb; cmd text; n int; gid uuid;
begin
 result:=private.snapshot_before_control_guidance(eid);
 if eid is null or not (result->>'organiser')::boolean then return result; end if;
 for g in select value from jsonb_array_elements(result->'groups') loop
  gid:=(g->>'id')::uuid;checks:='{}';
  foreach cmd in array array['open_vote','close_vote','runoff','random_draw','skip_ballot','reopen_ballot','planning','lock_murder','finale','pause','resume','extend','test_votes'] loop
   checks:=checks||jsonb_build_object(cmd,private.control_check(eid,gid,cmd,'{}'));
  end loop;
  for n in 0..2 loop checks:=checks||jsonb_build_object('mission_'||n,private.control_check(eid,gid,'mission',jsonb_build_object('mission',n))); end loop;
  for n in 1..3 loop
   checks:=checks||jsonb_build_object('discussion_'||n,private.control_check(eid,gid,'discussion',jsonb_build_object('round',n)), 'publish_ballot_'||n,private.control_check(eid,gid,'publish_ballot',jsonb_build_object('round',n)));
   foreach cmd in array array['open_vote','close_vote','runoff','random_draw','reopen_ballot','skip_ballot','test_votes'] loop
    checks:=checks||jsonb_build_object(cmd||'_'||n,private.control_check(eid,gid,cmd,jsonb_build_object('round',n)));
   end loop;
  end loop;
  for n in 0..1 loop checks:=checks||jsonb_build_object('open_murder_'||n,private.control_check(eid,gid,'open_murder',jsonb_build_object('slot',n)),'publish_murder_'||n,private.control_check(eid,gid,'publish_murder',jsonb_build_object('slot',n))); end loop;
  groups:=groups||jsonb_build_array(g||jsonb_build_object('control_checks',checks,'next_step',private.group_next_step(eid,gid)));
 end loop;
 return jsonb_set(result,'{groups}',groups);
end $$;
revoke all on function private.snapshot_before_control_guidance(uuid),private.snapshot(uuid) from public,anon,authenticated;
grant execute on function private.snapshot(uuid) to authenticated;
notify pgrst,'reload schema';
