-- Restore runtime additions and table links lost when foundation tables were recreated.
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
alter table public.players add constraint players_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Banished'::text, 'Murdered'::text, 'Withdrawn'::text])));
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.players'::regclass and conname='unique_player_number') then
  alter table public.players add constraint unique_player_number unique(event_id,player_number);
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='private.games'::regclass and conname='games_event_id_fkey') then
  alter table private.games add constraint games_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.games validate constraint games_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'games_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots'::regclass and conname='ballots_event_id_fkey') then
  alter table private.ballots add constraint ballots_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.ballots validate constraint ballots_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots'::regclass and conname='ballots_voter_fkey') then
  alter table private.ballots add constraint ballots_voter_fkey FOREIGN KEY (voter) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.ballots validate constraint ballots_voter_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_voter_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots'::regclass and conname='ballots_target_fkey') then
  alter table private.ballots add constraint ballots_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.ballots validate constraint ballots_target_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.outcomes'::regclass and conname='outcomes_event_id_fkey') then
  alter table private.outcomes add constraint outcomes_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.outcomes validate constraint outcomes_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'outcomes_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.outcomes'::regclass and conname='outcomes_group_id_fkey') then
  alter table private.outcomes add constraint outcomes_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) not valid;
 end if;
 begin
  alter table private.outcomes validate constraint outcomes_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'outcomes_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.outcomes'::regclass and conname='outcomes_target_fkey') then
  alter table private.outcomes add constraint outcomes_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.outcomes validate constraint outcomes_target_fkey;
 exception when foreign_key_violation then
  raise notice 'outcomes_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.proposals'::regclass and conname='proposals_event_id_fkey') then
  alter table private.proposals add constraint proposals_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.proposals validate constraint proposals_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'proposals_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.proposals'::regclass and conname='proposals_actor_fkey') then
  alter table private.proposals add constraint proposals_actor_fkey FOREIGN KEY (actor) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.proposals validate constraint proposals_actor_fkey;
 exception when foreign_key_violation then
  raise notice 'proposals_actor_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.proposals'::regclass and conname='proposals_target_fkey') then
  alter table private.proposals add constraint proposals_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.proposals validate constraint proposals_target_fkey;
 exception when foreign_key_violation then
  raise notice 'proposals_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.audit'::regclass and conname='audit_event_id_fkey') then
  alter table private.audit add constraint audit_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.audit validate constraint audit_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'audit_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.live_event'::regclass and conname='live_event_event_id_fkey') then
  alter table private.live_event add constraint live_event_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL not valid;
 end if;
 begin
  alter table private.live_event validate constraint live_event_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'live_event_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.event_settings'::regclass and conname='event_settings_event_id_fkey') then
  alter table private.event_settings add constraint event_settings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.event_settings validate constraint event_settings_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'event_settings_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.group_state'::regclass and conname='group_state_group_id_fkey') then
  alter table private.group_state add constraint group_state_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.group_state validate constraint group_state_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'group_state_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.group_state'::regclass and conname='group_state_event_id_fkey') then
  alter table private.group_state add constraint group_state_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.group_state validate constraint group_state_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'group_state_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.staff'::regclass and conname='staff_event_id_fkey') then
  alter table private.staff add constraint staff_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.staff validate constraint staff_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'staff_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.staff'::regclass and conname='staff_group_id_fkey') then
  alter table private.staff add constraint staff_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.staff validate constraint staff_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'staff_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.missions'::regclass and conname='missions_event_id_fkey') then
  alter table private.missions add constraint missions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.missions validate constraint missions_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'missions_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.mission_scores'::regclass and conname='mission_scores_event_id_fkey') then
  alter table private.mission_scores add constraint mission_scores_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.mission_scores validate constraint mission_scores_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'mission_scores_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.mission_scores'::regclass and conname='mission_scores_group_id_fkey') then
  alter table private.mission_scores add constraint mission_scores_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.mission_scores validate constraint mission_scores_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'mission_scores_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots_v2'::regclass and conname='ballots_v2_event_id_fkey') then
  alter table private.ballots_v2 add constraint ballots_v2_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.ballots_v2 validate constraint ballots_v2_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_v2_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots_v2'::regclass and conname='ballots_v2_group_id_fkey') then
  alter table private.ballots_v2 add constraint ballots_v2_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.ballots_v2 validate constraint ballots_v2_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_v2_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.ballots_v2'::regclass and conname='ballots_v2_result_fkey') then
  alter table private.ballots_v2 add constraint ballots_v2_result_fkey FOREIGN KEY (result) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.ballots_v2 validate constraint ballots_v2_result_fkey;
 exception when foreign_key_violation then
  raise notice 'ballots_v2_result_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.votes_v2'::regclass and conname='votes_v2_voter_fkey') then
  alter table private.votes_v2 add constraint votes_v2_voter_fkey FOREIGN KEY (voter) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.votes_v2 validate constraint votes_v2_voter_fkey;
 exception when foreign_key_violation then
  raise notice 'votes_v2_voter_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.votes_v2'::regclass and conname='votes_v2_target_fkey') then
  alter table private.votes_v2 add constraint votes_v2_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.votes_v2 validate constraint votes_v2_target_fkey;
 exception when foreign_key_violation then
  raise notice 'votes_v2_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.reveals'::regclass and conname='reveals_event_id_fkey') then
  alter table private.reveals add constraint reveals_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.reveals validate constraint reveals_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'reveals_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.reveals'::regclass and conname='reveals_group_id_fkey') then
  alter table private.reveals add constraint reveals_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.reveals validate constraint reveals_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'reveals_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.murder_windows'::regclass and conname='murder_windows_event_id_fkey') then
  alter table private.murder_windows add constraint murder_windows_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.murder_windows validate constraint murder_windows_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'murder_windows_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.murder_windows'::regclass and conname='murder_windows_group_id_fkey') then
  alter table private.murder_windows add constraint murder_windows_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.murder_windows validate constraint murder_windows_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'murder_windows_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.murder_windows'::regclass and conname='murder_windows_decider_fkey') then
  alter table private.murder_windows add constraint murder_windows_decider_fkey FOREIGN KEY (decider) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.murder_windows validate constraint murder_windows_decider_fkey;
 exception when foreign_key_violation then
  raise notice 'murder_windows_decider_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.murder_windows'::regclass and conname='murder_windows_target_fkey') then
  alter table private.murder_windows add constraint murder_windows_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.murder_windows validate constraint murder_windows_target_fkey;
 exception when foreign_key_violation then
  raise notice 'murder_windows_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.proposals_v2'::regclass and conname='proposals_v2_actor_fkey') then
  alter table private.proposals_v2 add constraint proposals_v2_actor_fkey FOREIGN KEY (actor) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.proposals_v2 validate constraint proposals_v2_actor_fkey;
 exception when foreign_key_violation then
  raise notice 'proposals_v2_actor_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.proposals_v2'::regclass and conname='proposals_v2_target_fkey') then
  alter table private.proposals_v2 add constraint proposals_v2_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.proposals_v2 validate constraint proposals_v2_target_fkey;
 exception when foreign_key_violation then
  raise notice 'proposals_v2_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.reveals'::regclass and conname='reveals_target_fkey') then
  alter table private.reveals add constraint reveals_target_fkey FOREIGN KEY (target) REFERENCES public.players(id) not valid;
 end if;
 begin
  alter table private.reveals validate constraint reveals_target_fkey;
 exception when foreign_key_violation then
  raise notice 'reveals_target_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.shields'::regclass and conname='shields_player_id_fkey') then
  alter table private.shields add constraint shields_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.shields validate constraint shields_player_id_fkey;
 exception when foreign_key_violation then
  raise notice 'shields_player_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.shields'::regclass and conname='shields_event_id_fkey') then
  alter table private.shields add constraint shields_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.shields validate constraint shields_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'shields_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.messages'::regclass and conname='messages_event_id_fkey') then
  alter table private.messages add constraint messages_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.messages validate constraint messages_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'messages_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.messages'::regclass and conname='messages_group_id_fkey') then
  alter table private.messages add constraint messages_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.messages validate constraint messages_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'messages_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.help_requests'::regclass and conname='help_requests_event_id_fkey') then
  alter table private.help_requests add constraint help_requests_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.help_requests validate constraint help_requests_event_id_fkey;
 exception when foreign_key_violation then
  raise notice 'help_requests_event_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.help_requests'::regclass and conname='help_requests_player_id_fkey') then
  alter table private.help_requests add constraint help_requests_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.help_requests validate constraint help_requests_player_id_fkey;
 exception when foreign_key_violation then
  raise notice 'help_requests_player_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.help_requests'::regclass and conname='help_requests_group_id_fkey') then
  alter table private.help_requests add constraint help_requests_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.event_groups(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.help_requests validate constraint help_requests_group_id_fkey;
 exception when foreign_key_violation then
  raise notice 'help_requests_group_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
 if not exists(select 1 from pg_constraint where conrelid='private.presence'::regclass and conname='presence_player_id_fkey') then
  alter table private.presence add constraint presence_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE not valid;
 end if;
 begin
  alter table private.presence validate constraint presence_player_id_fkey;
 exception when foreign_key_violation then
  raise notice 'presence_player_id_fkey: historical orphan records preserved; new writes remain checked.';
 end;
end $$;
notify pgrst,'reload schema';
