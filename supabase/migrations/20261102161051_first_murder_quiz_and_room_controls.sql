-- Additive first-murder rounds. Existing opportunities and all saved game records stay unchanged.
create table private.raf_quiz_bank(
 id text primary key, questions jsonb not null, tie_prompt text not null,
 tie_answer bigint not null, source_notes jsonb not null default '[]'
);
create table private.room_controls(
 group_id uuid primary key, event_id uuid not null references public.events(id) on delete cascade,
 enabled boolean not null default false,
 foreign key(event_id,group_id) references public.event_groups(event_id,id) on delete cascade
);
create table private.first_murder_rounds(
 window_id uuid primary key references private.murder_windows(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 group_id uuid not null unique references public.event_groups(id) on delete cascade,
 chat_until timestamptz not null, decider uuid references public.players(id),
 chosen_at timestamptz, target uuid references public.players(id),
 pack jsonb not null, closed_at timestamptz, winner uuid references public.players(id),
 winner_score int, draw_used boolean not null default false, quiz_published_at timestamptz,
 foreign key(event_id,group_id) references public.event_groups(event_id,id) on delete cascade
);
create index first_murder_event_idx on private.first_murder_rounds(event_id);
create table private.raf_quiz_entries(
 window_id uuid not null references private.first_murder_rounds(window_id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade,
 tie bigint, answers jsonb not null default '{}', score int, distance numeric,
 updated_at timestamptz not null default now(), primary key(window_id,player_id)
);
alter table private.raf_quiz_bank enable row level security;
alter table private.room_controls enable row level security;
alter table private.first_murder_rounds enable row level security;
alter table private.raf_quiz_entries enable row level security;
revoke all on private.raf_quiz_bank,private.room_controls,private.first_murder_rounds,private.raf_quiz_entries from public,anon,authenticated;

create function private.room_actions() returns text[] language sql immutable set search_path='' as $$
 select array['mission','discussion','open_vote','close_vote','runoff','random_draw','skip_ballot','reopen_ballot','open_murder','lock_murder','planning','publish','reveal_role','score','finale','room_activity','first_publish_quiz'];
$$;
create or replace function private.can_control(eid uuid,gid uuid,command text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.current_account() is not null and (
 exists(select 1 from public.events where id=eid and owner_id=private.current_account()) or
 (exists(select 1 from private.staff where event_id=eid and account_id=private.current_account() and group_id=gid)
 and (command='read' or (command<>all(array['recover','shield','objective','confirm_objective']) and command=any(coalesce((select nco_permissions from private.event_settings where event_id=eid),'{}'::text[])))
 or (command=any(private.room_actions()) and exists(select 1 from private.room_controls where event_id=eid and group_id=gid and enabled)
 and (select roles_released from private.event_settings where event_id=eid)))));
$$;

-- Selecting once in the database preserves the same decider across logout, refresh and retries.
create function private.first_tick(eid uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.first_murder_rounds; picked uuid;
begin
 for r in select * from private.first_murder_rounds where event_id=eid and chosen_at is null and decider is null and chat_until<=clock_timestamp() for update loop
  select p.id into picked from public.players p join public.player_secrets s on s.player_id=p.id
   where p.group_id=r.group_id and p.status='Active' and s.role='Traitor' order by gen_random_uuid() limit 1;
  if picked is not null then
   update private.first_murder_rounds set decider=picked where window_id=r.window_id;
   update private.murder_windows set decider=picked where id=r.window_id;
  end if;
 end loop;
end $$;

-- Score and award the shield before resolving the already sealed target.
create function private.first_score(wid uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.first_murder_rounds; chosen uuid; top_score int; top_distance numeric; ties int; window_status text;
begin
 select * into r from private.first_murder_rounds where window_id=wid for update;
 if r.closed_at is not null then return;end if;
 if r.chosen_at is null then raise exception 'The deciding Traitor must seal a target before this flight quiz can close.';end if;
 update private.raf_quiz_entries e set
  score=(select count(*) from jsonb_array_elements(r.pack->'questions') q where exists(
   select 1 from jsonb_array_elements_text(q->'answers') alias where private.register_key(e.answers->>(q->>'id'))=private.register_key(alias.value))),
  distance=abs(e.tie::numeric-(r.pack->>'tie_answer')::numeric)
 where e.window_id=wid;
 select e.score,e.distance into top_score,top_distance from private.raf_quiz_entries e
  join public.players p on p.id=e.player_id join public.player_secrets s on s.player_id=p.id
  where e.window_id=wid and e.tie is not null and p.status='Active' and p.group_id=r.group_id and s.role='Faithful'
  order by e.score desc,e.distance asc limit 1;
 select count(*), (array_agg(e.player_id order by gen_random_uuid()))[1] into ties,chosen from private.raf_quiz_entries e
  join public.players p on p.id=e.player_id join public.player_secrets s on s.player_id=p.id
  where e.window_id=wid and e.tie is not null and p.status='Active' and p.group_id=r.group_id and s.role='Faithful'
   and e.score=top_score and e.distance=top_distance;
 update private.first_murder_rounds set closed_at=clock_timestamp(),winner=chosen,winner_score=top_score,draw_used=ties>1 where window_id=wid;
 if chosen is not null then
  insert into private.shields(player_id,slot,event_id) values(chosen,0,r.event_id) on conflict(player_id,slot) do nothing;
 end if;
 update private.murder_windows set target=r.target where id=wid;
 select status into window_status from private.murder_windows where id=wid;
 if window_status='open' then perform private.resolve_murder(wid,r.target is not null,'First-murder target sealed after private chat');
 elsif r.target is null and not exists(select 1 from private.reveals where opportunity=wid) and not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=r.group_id and p.status='Active' and s.role='Traitor') then
  insert into private.reveals(event_id,group_id,kind,target,opportunity) values(r.event_id,r.group_id,'Murdered',null,wid);
 else raise exception 'This opportunity was closed elsewhere. Ask FS Penny to check the existing outcome; no replacement victim has been selected.';end if;
 insert into private.audit(event_id,actor,action,details) values(r.event_id,private.current_account(),'first_quiz_scored',jsonb_build_object('groups',array[r.group_id],'winner',chosen,'score',top_score,'random_draw',ties>1));
end $$;

create or replace function private.resolve_murder(wid uuid,completed boolean,reason_text text) returns void
language plpgsql security definer set search_path='' as $$
declare w private.murder_windows; eligible boolean; protected boolean; enabled boolean;
begin
 select * into w from private.murder_windows where id=wid for update;
 if w.id is null or w.status<>'open' then raise exception 'This opportunity is already locked.';end if;
 select exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=w.target and p.group_id=w.group_id and p.status='Active' and s.role='Faithful') into eligible;
 select shields or exists(select 1 from private.first_murder_rounds r where r.window_id=wid and r.closed_at is not null and r.winner=w.target) into enabled from private.event_settings where event_id=w.event_id;
 select enabled and exists(select 1 from private.shields where player_id=w.target and slot=w.slot and not consumed) into protected;
 update private.shields set consumed=true where player_id=w.target and slot=w.slot and not consumed;
 update private.murder_windows set status='resolved',success=completed and eligible and not protected,
  reason=case when protected and completed then 'Shield blocked this attempt' when completed and not eligible then 'Target no longer eligible' else reason_text end where id=wid;
 insert into private.reveals(event_id,group_id,kind,target,opportunity) values(w.event_id,w.group_id,'Murdered',case when completed and eligible and not protected then w.target end,w.id);
end $$;

-- Retain the existing dispatcher, including session checks, request receipts and quotas.
do $$begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_raf_quiz(');end $$;
revoke all on function private.game_command_before_raf_quiz(text,uuid,jsonb) from public,anon,authenticated;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account();owner uuid;host boolean;r private.first_murder_rounds;w private.murder_windows;
 me public.players;bank private.raf_quiz_bank;item jsonb;action text:=cmd;result jsonb;previous uuid[];gid uuid;pid uuid;
 body text;answer text;question text;entry private.raf_quiz_entries;g record;b private.ballots_v2;
begin
 if uid is null then raise exception 'Sign in with your name and PIN first.';end if;
 select owner_id into owner from public.events where id=eid for update;host:=coalesce(owner=uid,false);
 if eid is not null and (host or exists(select 1 from private.staff where event_id=eid and account_id=uid) or exists(select 1 from public.players where event_id=eid and user_id=uid)) then perform private.first_tick(eid);end if;
 if cmd='room_control' then
  if not host then raise exception 'Only FS Penny can enable independent NCO controls.';end if;
  gid:=(args->>'group')::uuid;
  if not exists(select 1 from public.event_groups where id=gid and event_id=eid) then raise exception 'Choose a flight in this event.';end if;
  insert into private.room_controls values(gid,eid,coalesce((args->>'enabled')::boolean,false)) on conflict(group_id) do update set enabled=excluded.enabled;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('groups',array[gid],'enabled',args->'enabled'));
  return jsonb_build_object('id',eid);
 end if;
 if cmd='start_task' then
  select value into item from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) where value->>'id'=args->>'row';action:=item->>'action';
 end if;
 if cmd in ('raf_answer','first_choose','first_manual','first_publish_quiz') or cmd in ('message','propose','lock_murder') then
  if args ? 'opportunity' then select * into r from private.first_murder_rounds where window_id=(args->>'opportunity')::uuid and event_id=eid;
  elsif args ? 'group' then select * into r from private.first_murder_rounds where group_id=(args->>'group')::uuid and event_id=eid;
  else select * into r from private.first_murder_rounds where event_id=eid and group_id=(select group_id from public.players where event_id=eid and user_id=uid);end if;
  if r.window_id is not null then
   if (select ended from private.games where event_id=eid) then raise exception 'This event has finished. Its first-murder records are read only.';end if;
   if cmd='message' and r.closed_at is not null and (select phase from private.group_state where group_id=r.group_id)<>'Night' then return private.game_command_before_raf_quiz(cmd,eid,args);end if;
   select * into me from public.players where user_id=uid and event_id=eid;
   if cmd='raf_answer' then
    if me.id is null or me.group_id<>r.group_id or me.status<>'Active' or not exists(select 1 from public.player_secrets where player_id=me.id and role='Faithful') then raise exception 'This quiz is only for active Faithful players in their own flight.';end if;
    if r.closed_at is not null then raise exception 'Your flight quiz has closed because its victim was chosen. Your saved answers were counted; no new answers can be accepted.';end if;
    select * into entry from private.raf_quiz_entries where window_id=r.window_id and player_id=me.id;
    if args ? 'tie' then
     if coalesce(args->>'tie','')!~'^[0-9]{1,9}$' then raise exception 'Enter a whole-number tie-breaker estimate from 0 to 999999999.';end if;
     insert into private.raf_quiz_entries(window_id,player_id,tie) values(r.window_id,me.id,(args->>'tie')::bigint)
      on conflict(window_id,player_id) do update set tie=excluded.tie,updated_at=clock_timestamp();
    else
     if entry.tie is null then raise exception 'Save your numerical tie-breaker estimate first. Everyone needs it to enter the quiz.';end if;
     question:=args->>'question';answer:=trim(args->>'answer');
     if not exists(select 1 from jsonb_array_elements(r.pack->'questions') q where q->>'id'=question) then raise exception 'This question is not in your flight quiz. Refresh to load the saved question set.';end if;
     if answer is null or length(answer)>120 then raise exception 'Keep this answer to 120 characters or fewer. A short name or phrase is enough.';end if;
     update private.raf_quiz_entries set answers=jsonb_set(answers,array[question],to_jsonb(answer)),updated_at=clock_timestamp() where window_id=r.window_id and player_id=me.id;
    end if;
   elsif cmd='message' then
    if r.chosen_at is not null or clock_timestamp()>=r.chat_until then raise exception 'The 90-second chat has closed. The selected Traitor can now seal the victim. Messages cannot be reopened by refreshing or signing in again.';end if;
    if me.group_id is distinct from r.group_id or me.status<>'Active' or not exists(select 1 from public.player_secrets where player_id=me.id and role='Traitor') then raise exception 'Only this flight active Traitors can use its private chat.';end if;
    body:=trim(args->>'text');if coalesce(length(body),0) not between 1 and 240 then raise exception 'Write a private message between 1 and 240 characters.';end if;
    if exists(select 1 from private.messages where actor=uid and created_at>clock_timestamp()-interval '1 second') then raise exception 'Your last message was just sent. Wait a second before sending another.';end if;
    insert into private.messages(event_id,group_id,actor,body) values(eid,r.group_id,uid,body);
   elsif cmd in ('first_choose','propose','first_manual') then
    if cmd='first_manual' then
     if not host then raise exception 'Only FS Penny can record a manual victim or close a stalled first murder. Ask FS Penny for help; the selected Traitor can sign in again and continue.';end if;
     if coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Record why FS Penny is making a manual first-murder decision.';end if;
    else
     if clock_timestamp()<r.chat_until or r.decider is null then raise exception 'Finish the 90-second private chat first. The server then selects one active Traitor to make the decision.';end if;
     if me.id is distinct from r.decider or me.status<>'Active' or not exists(select 1 from public.player_secrets where player_id=me.id and role='Traitor') then raise exception 'Only the randomly selected Traitor can seal this flight victim. Your partner makes this decision; ask FS Penny if they cannot reconnect.';end if;
    end if;
    if clock_timestamp()<r.chat_until then raise exception 'The private chat is still open. Wait until its 90 seconds have finished.';end if;
    pid:=nullif(args->>'target','')::uuid;
    if cmd='first_manual' and pid is not null and not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=r.group_id and p.status='Active' and s.role='Traitor') then raise exception 'No active Traitors remain in this flight. Record No murder with a reason; do not choose a replacement victim.';end if;
    if r.chosen_at is not null then
     if r.target is not distinct from pid then return jsonb_build_object('id',eid);end if;
     raise exception 'This flight target is already sealed and its quiz counted. It cannot be changed or replaced.';
    end if;
    if pid is null and cmd<>'first_manual' then raise exception 'Choose an active Faithful in your own flight before sealing the victim.';end if;
    if pid is not null and not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=pid and p.group_id=r.group_id and p.status='Active' and s.role='Faithful') then raise exception 'That player is not an active Faithful in this flight. Choose an eligible player; nobody has been replaced automatically.';end if;
    if pid is not null and me.id is not null and cmd<>'first_manual' then insert into private.proposals_v2 values(r.window_id,me.id,pid) on conflict(window_id,actor) do nothing;end if;
    update private.first_murder_rounds set chosen_at=clock_timestamp(),target=pid where window_id=r.window_id;
    if cmd='first_manual' then insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('groups',array[r.group_id],'reason',trim(args->>'reason'),'target',pid));end if;
    perform private.first_score(r.window_id);
   elsif cmd='lock_murder' then
    if not private.can_control(eid,r.group_id,'lock_murder') then raise exception 'Your NCO account cannot control this flight.';end if;
    if r.closed_at is null then raise exception 'The selected Traitor has not sealed a victim yet. Their choice closes the quiz and locks this murder automatically. If they cannot reconnect, ask FS Penny to use Manual first-murder recovery.';end if;
   elsif cmd='first_publish_quiz' then
    if not private.can_control(eid,r.group_id,'publish') then raise exception 'Only FS Penny or a flight NCO with publication permission can publish this quiz result.';end if;
    if r.closed_at is null then raise exception 'The quiz is still open. Wait for the selected Traitor to seal their victim before publishing its winner.';end if;
    update private.first_murder_rounds set quiz_published_at=coalesce(quiz_published_at,clock_timestamp()) where window_id=r.window_id;
   end if;
   return jsonb_build_object('id',eid);
  elsif cmd in ('raf_answer','first_choose','first_manual','first_publish_quiz') then raise exception 'This first-murder quiz is not available. Refresh the flight dashboard and check the current opportunity.';
  end if;
 end if;
 if cmd='lock_murder' and exists(select 1 from private.first_murder_rounds where event_id=eid and (not(args ? 'group') or group_id=(args->>'group')::uuid)) then raise exception 'First-murder choices lock automatically when the selected Traitor seals a victim. Publish the quiz winner first, then the murder. Only FS Penny can use manual recovery.';end if;
 if cmd='publish' and exists(select 1 from private.reveals rr join private.first_murder_rounds fr on fr.window_id=rr.opportunity where rr.id=(args->>'reveal')::uuid and fr.quiz_published_at is null) then raise exception 'Publish this flight quiz winner first. Then reveal its murder outcome; the projector will queue the shield result before the murder.';end if;
 if cmd='publish_ready' and args->>'kind'='murder' and exists(select 1 from private.first_murder_rounds where event_id=eid and (not(args ? 'group') or group_id=(args->>'group')::uuid) and closed_at is not null and quiz_published_at is null) then raise exception 'Publish each selected flight quiz winner before revealing its first-murder outcome. Nothing has been revealed.';end if;
 if cmd='start_task' and action='activity' and not host then
  gid:=(args->>'group')::uuid;
  if gid is null or not private.can_control(eid,gid,'room_activity') then raise exception 'Choose one assigned flight with independent room controls enabled by FS Penny.';end if;
  if not (select roles_released from private.event_settings where event_id=eid) or item->>'id' not in ('break','clearup','parade') then raise exception 'FS Penny runs joining and role release. Flight NCOs begin at the first mission and can mark the break, clear-up and parade for their own flight.';end if;
  if (args->>'revision')::int is distinct from (select timetable_revision from private.event_settings where event_id=eid) then raise exception 'The timetable changed. Reload before starting this flight activity.';end if;
  if exists(select 1 from private.ballots_v2 where group_id=gid and status in ('open','tie','empty')) or exists(select 1 from private.murder_windows where group_id=gid and mode='standard' and status='open') then raise exception 'Finish this flight ballot or first-murder decision before starting the next activity.';end if;
  update private.group_state set phase='Briefing',active_task=item->>'id' where group_id=gid;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,'start_task',jsonb_build_object('groups',array[gid],'row',item->>'id'));
  return jsonb_build_object('id',eid);
 end if;
 if cmd in ('random_draw','skip_ballot','reopen_ballot') and not host and private.can_control(eid,(args->>'group')::uuid,cmd) then
  gid:=(args->>'group')::uuid;
  if (select ended from private.games where event_id=eid) then raise exception 'This event has finished.';end if;
  select b0.* into b from private.ballots_v2 b0 join private.group_state gs on gs.ballot=b0.id where gs.group_id=gid and gs.event_id=eid for update of b0;
  if b.id is null or (args->'expected_ballots'->>gid::text)::uuid is distinct from b.id then raise exception 'The flight ballot changed. Refresh before resolving it.';end if;
  if cmd='random_draw' then
   if b.status<>'tie' or not b.runoff then raise exception 'Use the runoff first. A random draw is available only if that runoff is also tied.';end if;
   select value into pid from unnest(b.tied) value order by gen_random_uuid() limit 1;
   update private.ballots_v2 set status='resolved',result=pid where id=b.id;
   insert into private.reveals(event_id,group_id,kind,target,ballot) values(eid,gid,'Banished',pid,b.id);
  else
   if b.status<>'empty' then raise exception 'Only an empty ballot can be reopened or skipped. Resolve its recorded result instead.';end if;
   if cmd='reopen_ballot' then update private.ballots_v2 set status='open' where id=b.id;update private.group_state set phase='Voting' where group_id=gid;
   else update private.ballots_v2 set status='skipped',published=true where id=b.id;update private.group_state set banishments=banishments+1 where group_id=gid;perform private.group_victory(gid);end if;
  end if;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('groups',array[gid],'ballot',b.id));return jsonb_build_object('id',eid);
 end if;
 if action='open_murder' and coalesce((case when cmd='start_task' then item->>'slot' else args->>'slot' end)::int,-1)=0 then
  select * into bank from private.raf_quiz_bank where id='raf-general-v1';
  if bank.id is null then raise exception 'The private RAF quiz question pack is not configured. Ask FS Penny to load it before opening the first murder.';end if;
  select coalesce(array_agg(id),'{}') into previous from private.murder_windows where event_id=eid;
  result:=private.game_command_before_raf_quiz(cmd,eid,args);
  for w in select * from private.murder_windows where event_id=eid and slot=0 and not(id=any(previous)) loop
   insert into private.first_murder_rounds(window_id,event_id,group_id,chat_until,pack)
    values(w.id,eid,w.group_id,clock_timestamp()+interval '90 seconds',to_jsonb(bank));
   update private.murder_windows set decider=null where id=w.id;
  end loop;
  return result;
 end if;
 return private.game_command_before_raf_quiz(cmd,eid,args);
end $$;
revoke all on function private.game_command(text,uuid,jsonb) from public,anon,authenticated;

do $$begin execute replace(pg_get_functiondef('private.control_check(uuid,uuid,text,jsonb)'::regprocedure),'private.control_check(','private.control_check_before_raf_quiz(');end $$;
create or replace function private.control_check(eid uuid,gid uuid,cmd text,args jsonb default '{}') returns jsonb
language plpgsql stable set search_path='' as $$
declare r private.first_murder_rounds;
begin
 select * into r from private.first_murder_rounds where event_id=eid and group_id=gid;
 if r.window_id is not null then
  if cmd='lock_murder' then return private.control_answer(false,'automatic_first_lock','The selected Traitor seals the victim and closes the quiz automatically. Ask FS Penny for manual recovery if needed.');end if;
  if cmd='publish_murder' and coalesce((args->>'slot')::int,0)=0 and r.quiz_published_at is null then return private.control_answer(false,'quiz_first','Publish this flight quiz winner first, then reveal its murder outcome.','first_publish_quiz',jsonb_build_object('opportunity',r.window_id));end if;
 end if;
 return private.control_check_before_raf_quiz(eid,gid,cmd,args);
end $$;

do $$begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_raf_quiz(');end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare result jsonb;uid uuid:=private.current_account();me public.players;r private.first_murder_rounds;entry private.raf_quiz_entries;items jsonb:='[]';item jsonb;organiser boolean;role text;perms jsonb;
begin
 result:=private.snapshot_before_raf_quiz(eid);if eid is null then return result;end if;
 perform private.first_tick(eid);organiser:=(result->>'organiser')::boolean;
 select * into me from public.players where event_id=eid and user_id=uid;
 select s.role into role from public.player_secrets s where player_id=me.id;
 for r in select * from private.first_murder_rounds where event_id=eid and (private.can_control(eid,group_id,'read') or (me.group_id=group_id and me.status='Active')) loop
  if organiser then
   item:=jsonb_build_object('opportunity',r.window_id,'group',r.group_id,'chat_until',r.chat_until,'decider',r.decider,'chosen',r.chosen_at is not null,'closed',r.closed_at is not null,'winner',r.winner,'score',r.winner_score,'draw',r.draw_used,'published',r.quiz_published_at is not null,'total',jsonb_array_length(r.pack->'questions'),'entries',(select count(*) from private.raf_quiz_entries where window_id=r.window_id and tie is not null));
  elsif role='Traitor' then
   item:=jsonb_build_object('opportunity',r.window_id,'group',r.group_id,'chat_until',r.chat_until,'chat_open',clock_timestamp()<r.chat_until and r.chosen_at is null,'can_choose',me.id=r.decider and r.chosen_at is null,'selected',me.id=r.decider,'chosen',r.chosen_at is not null,'closed',r.closed_at is not null);
  elsif role='Faithful' then
   select * into entry from private.raf_quiz_entries where window_id=r.window_id and player_id=me.id;
   item:=jsonb_build_object('opportunity',r.window_id,'group',r.group_id,'closed',r.closed_at is not null,'tie_prompt',r.pack->>'tie_prompt','tie',entry.tie,'answers',coalesce(entry.answers,'{}'),'questions',(select jsonb_agg(q-'answers') from jsonb_array_elements(r.pack->'questions') q));
  else continue;end if;
  items:=items||jsonb_build_array(item);
 end loop;
 result:=result||jsonb_build_object('first_murder',items);
 if organiser then
  if not (result->>'host')::boolean then result:=jsonb_set(result,'{nco_permissions}',coalesce((select jsonb_agg(p) from jsonb_array_elements(result->'nco_permissions') p where p#>>'{}'<>all(array['recover','shield','objective','confirm_objective'])),'[]'));end if;
  result:=result||jsonb_build_object('room_controls',(select coalesce(jsonb_agg(jsonb_build_object('group',g.id,'enabled',coalesce(rc.enabled,false))),'[]') from public.event_groups g left join private.room_controls rc on rc.group_id=g.id where g.event_id=eid and private.can_control(eid,g.id,'read')));
  if exists(select 1 from private.staff st join private.room_controls rc on rc.group_id=st.group_id where st.event_id=eid and st.account_id=uid and rc.enabled) and (result->>'roles_released')::boolean then
   select jsonb_agg(distinct value) into perms from jsonb_array_elements(coalesce(result->'nco_permissions','[]')||to_jsonb(private.room_actions())) where value#>>'{}'<>all(array['recover','shield','objective','confirm_objective']);result:=jsonb_set(result,'{nco_permissions}',perms);
  end if;
  result:=jsonb_set(result,'{groups}',(select jsonb_agg(g||case when exists(select 1 from private.first_murder_rounds rr where rr.group_id=(g->>'id')::uuid and rr.closed_at is not null and rr.quiz_published_at is null) then jsonb_build_object('next_step',private.control_answer(true,'quiz_first','The quiz has closed. Publish its shield winner, then reveal the sealed murder.','first_publish_quiz',jsonb_build_object('opportunity',(select window_id from private.first_murder_rounds where group_id=(g->>'id')::uuid)))) else '{}'::jsonb end) from jsonb_array_elements(result->'groups') g));
  result:=jsonb_set(result,'{groups}',(select jsonb_agg(g||case when exists(select 1 from private.first_murder_rounds rr where rr.group_id=(g->>'id')::uuid and rr.closed_at is null) then jsonb_build_object('next_step',private.control_answer(false,'first_quiz_running','The RAF quiz is open. After 90 seconds of private chat, the selected Traitor seals the victim. The website then counts the quiz, awards its shield and locks the murder. Ask FS Penny for manual recovery if the selected player cannot reconnect.')) else '{}'::jsonb end) from jsonb_array_elements(result->'groups') g));
 end if;
 -- The new round never exposes its sealed target or the other Traitor decision to a player.
 if not organiser then result:=jsonb_set(result,'{windows}',coalesce((select jsonb_agg(w) from jsonb_array_elements(result->'windows') w where not exists(select 1 from private.first_murder_rounds rr where rr.window_id=(w->>'id')::uuid)),'[]'));end if;
 return result;
end $$;
revoke all on function private.snapshot_before_raf_quiz(uuid),private.control_check_before_raf_quiz(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.snapshot(uuid) from public,anon;
grant execute on function private.snapshot(uuid) to authenticated;

do $$begin execute replace(pg_get_functiondef('private.board(uuid)'::regprocedure),'private.board(','private.board_before_raf_quiz(');end $$;
create or replace function private.board(token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;eid uuid;
begin
 result:=private.board_before_raf_quiz(token);eid:=(result->>'id')::uuid;
 result:=jsonb_set(result,'{groups}',(select jsonb_agg(g||jsonb_build_object('registered_flight',(select registered_flight from private.group_state where group_id=(g->>'id')::uuid))) from jsonb_array_elements(result->'groups') g));
 return result||jsonb_build_object('quiz_results',coalesce((select jsonb_agg(jsonb_build_object('id',r.window_id,'group',r.group_id,'winner',r.winner,'name',coalesce((select mr.name from public.players p join private.accounts a on a.id=p.user_id join private.master_roster mr on mr.id=a.roster_id where p.id=r.winner),(select display_name from public.players where id=r.winner)),'score',r.winner_score,'total',jsonb_array_length(r.pack->'questions'),'draw',r.draw_used,'outcome',(select id from private.reveals where opportunity=r.window_id),'time',r.quiz_published_at) order by r.quiz_published_at) from private.first_murder_rounds r where r.event_id=eid and r.quiz_published_at is not null),'[]'));
end $$;
revoke all on function private.board_before_raf_quiz(uuid) from public,anon,authenticated;
revoke all on function private.board(uuid) from public;
grant execute on function private.board(uuid) to anon,authenticated;

do $$begin execute replace(pg_get_functiondef('private.recovery_export(uuid)'::regprocedure),'private.recovery_export(','private.recovery_export_before_raf_quiz(');end $$;
create or replace function private.recovery_export(eid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.recovery_export_before_raf_quiz(eid);
 return result||jsonb_build_object('first_murder_rounds',(select jsonb_agg(to_jsonb(r)) from private.first_murder_rounds r where event_id=eid),'raf_quiz_entries',(select jsonb_agg(to_jsonb(e)) from private.raf_quiz_entries e join private.first_murder_rounds r on r.window_id=e.window_id where r.event_id=eid),'room_controls',(select jsonb_agg(to_jsonb(rc)) from private.room_controls rc where event_id=eid));
end $$;
revoke all on function private.recovery_export_before_raf_quiz(uuid),private.room_actions(),private.first_tick(uuid),private.first_score(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
