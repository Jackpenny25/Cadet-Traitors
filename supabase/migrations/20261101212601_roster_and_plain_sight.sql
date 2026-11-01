-- Review migration only. No personal roster data belongs in this file.
-- Existing credentials, memberships, roles, ballots and scoring are retained.
create function private.register_key(value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(normalize(trim(value),NFKC)),'[^[:alnum:]]','','g');
$$;
create table private.master_roster(
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 60),
 name_key text generated always as(private.register_key(name)) stored,
 rank text not null check(rank in ('Cdt','Cpl','Sgt','FS','CWO')),flight integer not null check(flight between 1 and 4),
 register_order integer not null check(register_order>0), unique(flight,register_order)
);
create index master_roster_name_idx on private.master_roster(name_key);
alter table private.accounts add column roster_id uuid unique references private.master_roster(id);
create table private.roster_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.roster_settings values(true,false);
create table private.roster_account_review(
 account_id uuid primary key references private.accounts(id),status text not null default 'pending' check(status in ('pending','linked','excluded','duplicate')),
 reason text not null default '',reviewer uuid references private.accounts(id)
);
alter table private.group_state add column registered_flight integer check(registered_flight between 1 and 4);
create unique index group_registered_flight_idx on private.group_state(event_id,registered_flight);
-- The existing four established group names have a defined order.
update private.group_state s set registered_flight=array_position(array['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'],g.name)
 from public.event_groups g where g.id=s.group_id;

create function private.roster_report() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.hosts where user_id=private.current_account()) then raise exception 'Only FS Penny or an existing authorised host may review the private register.';end if;
 return jsonb_build_object('enabled',(select enabled from private.roster_settings),'roster',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('account_id',a.id,'account_name',a.name) order by r.flight,r.register_order) from private.master_roster r left join private.accounts a on a.roster_id=r.id),'[]'),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'roster_id',a.roster_id,'status',v.status,'reason',v.reason,'matches',(select coalesce(jsonb_agg(r.id),'[]') from private.master_roster r where r.name_key=private.register_key(a.name)))) from private.accounts a join private.roster_account_review v on v.account_id=a.id),'[]'),
 'conflicts',coalesce((select jsonb_agg(jsonb_build_object('name',r.name,'event',e.title,'current_group',g.name,'registered_flight',r.flight)) from private.accounts a join private.master_roster r on r.id=a.roster_id join public.players p on p.user_id=a.id join private.group_state s on s.group_id=p.group_id join public.event_groups g on g.id=s.group_id join public.events e on e.id=p.event_id where s.registered_flight is distinct from r.flight),'[]'));
end $$;
create function public.tno_roster(action text default 'report',args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_account(); row jsonb; rid uuid; aid uuid;
begin
 if uid is null or not exists(select 1 from private.hosts where user_id=uid) then raise exception 'Only an existing authorised host may manage the register.';end if;
 perform pg_advisory_xact_lock(hashtextextended('master-register',0));
 if action='import' then
  if exists(select 1 from private.master_roster) then raise exception 'The register is already imported. Review it rather than importing another copy.';end if;
  if args->>'confirm' is distinct from 'IMPORT CHECKED REGISTER' or jsonb_typeof(args->'rows') is distinct from 'array' or jsonb_array_length(args->'rows') not between 4 and 300 or octet_length(args::text)>100000 then raise exception 'Supply the checked private register and explicit import confirmation.';end if;
  for row in select value from jsonb_array_elements(args->'rows') loop
   insert into private.master_roster(name,rank,flight,register_order) values(row->>'name',row->>'rank',(row->>'flight')::int,(row->>'order')::int);
  end loop;
  -- Identity matching is a review action. Never merge or delete an old account.
  insert into private.roster_account_review(account_id) select id from private.accounts where not exists(select 1 from private.hosts where user_id=id) on conflict do nothing;
 elsif action in ('link','exclude','duplicate') then
  aid:=(args->>'account')::uuid;rid:=(args->>'roster')::uuid;
  if not exists(select 1 from private.roster_account_review where account_id=aid) or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Choose an account awaiting review and record why this is the correct match or exclusion.';end if;
  if action='link' then
   if not exists(select 1 from private.master_roster where id=rid) then raise exception 'Choose the approved register person.';end if;
   if exists(select 1 from private.accounts where roster_id=rid and id<>aid) then raise exception 'Another account is already linked to this register person. Flag the duplicate; do not merge accounts.';end if;
   update private.accounts set roster_id=rid where id=aid;
  elsif exists(select 1 from private.accounts where id=aid and roster_id is not null) then raise exception 'This account is already linked. Review its mapping before excluding it.';
  end if;
  update private.roster_account_review set status=case when action='link' then 'linked' when action='exclude' then 'excluded' else 'duplicate' end,reason=trim(args->>'reason'),reviewer=uid where account_id=aid;
 elsif action='activate' then
  if not exists(select 1 from private.master_roster) then raise exception 'Import the checked register first.';end if;
  if exists(select 1 from private.roster_account_review where status='pending') then raise exception 'Review every existing account first. Link confirmed matches and flag duplicates or excluded test accounts. No accounts have been merged or deleted.';end if;
  if exists(select 1 from private.master_roster group by name_key having count(*)>1) then raise exception 'Two register people have the same surname and initial. Resolve their approved login spellings before opening registration.';end if;
  update private.roster_settings set enabled=true;
 elsif action<>'report' then raise exception 'Unknown register action.';end if;
 return private.roster_report();
end $$;
revoke all on function public.tno_roster(text,jsonb) from public,anon;
grant execute on function public.tno_roster(text,jsonb) to authenticated;

alter function private.login(text,text,boolean) rename to login_before_roster;
revoke all on function private.login_before_roster(text,text,boolean) from public,anon,authenticated;
create function private.login(display_name text,pin text,register boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.master_roster; a private.accounts; result jsonb; matches int; lookup text:=display_name;
begin
 if register then
  -- Never let an unbound Auth session bypass the existing anti-abuse checks.
  if auth.uid() is null or not exists(select 1 from auth.sessions where user_id=auth.uid() and id=(auth.jwt()->>'session_id')::uuid) then return jsonb_build_object('error','Your device session expired. Reload and sign in again.');end if;
  if not (select enabled from private.roster_settings) then return jsonb_build_object('error','Register checks are being prepared. Please speak to FS Penny before creating an account.');end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('register:'||coalesce(private.register_key(display_name),''),0));
 select count(*) into matches from private.master_roster where name_key=private.register_key(display_name);
 if matches>1 then return jsonb_build_object('error','This register name belongs to more than one person. Please speak to FS Penny so the correct account can be identified.');end if;
 if matches=1 then
  select * into r from private.master_roster where name_key=private.register_key(display_name);
  select * into a from private.accounts where roster_id=r.id;
  if register then
   if a.id is not null or exists(select 1 from private.accounts where private.register_key(name)=r.name_key) then return jsonb_build_object('error','An account already exists for this name. Please sign in or speak to your flight NCO.');end if;
   result:=private.login_before_roster(r.name,pin,true);
   if not result ? 'error' then update private.accounts set roster_id=r.id where id=auth.uid();end if;
   return result;
  elsif a.id is not null then lookup:=a.name;end if;
 elsif register then return jsonb_build_object('error','Name not found on the approved register. Enter your surname and initial exactly as shown, or speak to your flight NCO.');end if;
 result:=private.login_before_roster(lookup,pin,false);
 if not result ? 'error' then
  select rr.* into r from private.accounts aa join private.master_roster rr on rr.id=aa.roster_id where aa.id=private.current_account();
  if r.id is not null then result:=result||jsonb_build_object('name',r.name);end if;
 end if;
 return result;
end $$;
revoke all on function private.login(text,text,boolean) from public,anon;
grant execute on function private.login(text,text,boolean) to authenticated;

-- Each flight has one immutable released task and a separately editable draft.
create table private.plain_tasks(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,
 group_id uuid not null unique references public.event_groups(id) on delete cascade,
 draft text not null default '',draft_explanation text not null default 'required' check(draft_explanation in ('disabled','optional','required')),
 draft_photo text not null default 'disabled' check(draft_photo in ('disabled','optional','required')),
 draft_nco boolean not null default false, revision bigint not null default 1,
 task text,explanation text,photo text,allow_nco boolean not null default false,
 state text not null default 'draft' check(state in ('draft','sent','open','closed','reviewed','revealed')),
 sent_at timestamptz,opened_at timestamptz,closed_at timestamptz,
 opportunity uuid unique references private.murder_windows(id) on delete set null,review_reason text,reviewed_by uuid references private.accounts(id),reviewed_at timestamptz
);
create table private.plain_submissions(
 id uuid primary key default gen_random_uuid(),task_id uuid not null unique references private.plain_tasks(id) on delete cascade,
 reporter uuid not null references public.players(id) on delete cascade,target uuid not null references public.players(id) on delete cascade,
 explanation text not null default '' check(length(explanation)<=1500),submitted_at timestamptz not null default now(),
 verified_by uuid references private.accounts(id),verification text,
 decision text check(decision in ('approved','rejected')),decision_reason text,decision_at timestamptz
);
create table private.plain_uploads(
 id uuid primary key default gen_random_uuid(),task_id uuid not null references private.plain_tasks(id) on delete cascade,
 reporter uuid not null references public.players(id) on delete cascade,target uuid not null references public.players(id) on delete cascade,
 path text not null unique,submission_id uuid references private.plain_submissions(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index plain_tasks_event_idx on private.plain_tasks(event_id);
create index plain_uploads_task_idx on private.plain_uploads(task_id);
create index plain_submissions_target_idx on private.plain_submissions(target);
do $$ declare tab text;begin
 foreach tab in array array['master_roster','roster_settings','roster_account_review','plain_tasks','plain_submissions','plain_uploads'] loop
  execute format('alter table private.%I enable row level security',tab);
  execute format('revoke all on private.%I from public,anon,authenticated',tab);
 end loop;
end $$;

create function private.plain_can_read(tid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.current_account() is not null and exists(select 1 from private.plain_tasks t join public.events e on e.id=t.event_id join private.event_settings c on c.event_id=e.id where t.id=tid and
 (e.owner_id=private.current_account() or t.allow_nco and exists(select 1 from private.staff s where s.event_id=e.id and s.group_id=t.group_id and s.account_id=private.current_account())
 or t.state<>'draft' and c.roles_released and exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.event_id=e.id and p.group_id=t.group_id and p.user_id=private.current_account() and p.status='Active' and r.role='Traitor')));
$$;
create function private.plain_valid_target(gid uuid,pid uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.id=pid and p.group_id=gid and p.status='Active' and r.role='Faithful');
$$;

-- Storage has its own authorisation on every upload/download. App Auth alone is
-- insufficient: the bound PIN session, task, actor and victim are also checked.
create function private.evidence_access(object_name text,writing boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare u private.plain_uploads;t private.plain_tasks;
begin
 select * into u from private.plain_uploads where path=object_name;
 if u.id is null or not private.plain_can_read(u.task_id) then return false;end if;
 if not writing then return true;end if;
 select * into t from private.plain_tasks where id=u.task_id;
 return u.submission_id is null and t.state='open' and t.photo<>'disabled' and u.created_at>now()-interval '30 minutes'
  and private.plain_valid_target(t.group_id,u.target) and exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.id=u.reporter and p.user_id=private.current_account() and p.status='Active' and r.role='Traitor')
  and not exists(select 1 from private.plain_submissions where task_id=t.id);
end $$;
create function public.tno_evidence_access(object_name text,writing boolean default false) returns boolean language sql security invoker set search_path='' as $$select private.evidence_access(object_name,writing);$$;
revoke all on function private.evidence_access(text,boolean),public.tno_evidence_access(text,boolean) from public,anon;
grant execute on function private.evidence_access(text,boolean),public.tno_evidence_access(text,boolean) to authenticated;
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('murder-evidence','murder-evidence',false,5242880,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg'];
  execute 'create policy "PIN authorised evidence upload" on storage.objects for insert to authenticated with check (bucket_id=''murder-evidence'' and public.tno_evidence_access(name,true))';
  execute 'create policy "PIN authorised evidence read" on storage.objects for select to authenticated using (bucket_id=''murder-evidence'' and public.tno_evidence_access(name,false))';
 end if;
end $$;

-- Keep the current command receipts, request limits and transaction boundaries.
do $$begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_before_plain_tasks(');end $$;
revoke all on function private.game_command_before_plain_tasks(text,uuid,jsonb) from public,anon,authenticated;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account();owner uuid;g private.group_state;t private.plain_tasks;s private.plain_submissions;
 me public.players;r private.reveals;u private.plain_uploads;result jsonb;rid uuid;gid uuid;rf int;n int;item jsonb;host boolean;resolved_command text;resolved_mission int;
begin
 if uid is null then raise exception 'Sign in with your register name and PIN first.';end if;
 if cmd='join' and eid is null then select event_id into eid from private.live_event where singleton;end if;
 if cmd='create' then
  result:=private.game_command_before_plain_tasks(cmd,eid,args);eid:=(result->>'id')::uuid;
  update private.group_state s set registered_flight=array_position(array['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'],gg.name) from public.event_groups gg where gg.id=s.group_id and s.event_id=eid;
  if (select enabled from private.roster_settings) then
   update private.group_state s set capacity=greatest(traitors+1,(select count(*)::int from private.master_roster rr where rr.flight=s.registered_flight)) where event_id=eid;
   update private.games set capacity=(select sum(capacity) from private.group_state where event_id=eid) where event_id=eid;
  end if;
  -- New events use the current public physical briefings. Answer/marking fields
  -- are untouched; existing rehearsals retain their selected mission plan.
  update private.missions m set title=card->>'title',instructions=card->>'instructions',equipment=card->>'equipment'
   from jsonb_array_elements(private.mission_plan_cards()) card where m.event_id=eid and m.idx=(card->>'idx')::int;
  update private.event_settings c set timetable=(select jsonb_agg(row||case when row->>'action'='mission' then jsonb_build_object('label',(select title from private.missions where event_id=eid and idx=(row->>'mission')::int)) when row->>'id'='break' then jsonb_build_object('label','Break and Murder in Plain Sight attempts') else '{}'::jsonb end order by row->>'time') from jsonb_array_elements(c.timetable) row) where c.event_id=eid;
  return result;
 end if;
 select owner_id into owner from public.events where id=eid for update;host:=owner=uid;
 if cmd='join' and (select enabled from private.roster_settings) then
  if exists(select 1 from public.players where event_id=eid and user_id=uid) then return jsonb_build_object('id',eid);end if;
  if host or exists(select 1 from private.staff where event_id=eid and account_id=uid) then raise exception 'Organisers use their existing dashboard rather than joining as a cadet.';end if;
  select rr.flight into rf from private.accounts a join private.master_roster rr on rr.id=a.roster_id where a.id=uid;
  if rf is null then raise exception 'This existing account needs a register match. Ask FS Penny to link it in Register review. Your PIN and progress are preserved.';end if;
  if not exists(select 1 from public.events e join private.event_settings c on c.event_id=e.id join private.games x on x.event_id=e.id where e.id=eid and e.joining_open and not x.ended and (c.practice or exists(select 1 from private.live_event where event_id=eid)) and (not c.practice or args->>'practice_event'=eid::text) and (c.roles_released or not exists(select 1 from public.players p join public.player_secrets ss on ss.player_id=p.id where p.event_id=eid))) then raise exception 'Joining is closed or this link is not the open event. Ask FS Penny to open joining, then retry Join the event.';end if;
  select * into g from private.group_state where event_id=eid and registered_flight=rf for update;
  if g.group_id is null then raise exception 'Flight % is not mapped in this event. Ask FS Penny to map the four flights in Setup.',rf;end if;
  if g.done then raise exception 'Your flight has finished deduction. Ask FS Penny about joining the physical activities.';end if;
  if (select count(*) from public.players where group_id=g.group_id)>=g.capacity then raise exception 'Your registered flight is full. Ask FS Penny to review its capacity; you will not be moved to a different flight.';end if;
  select coalesce(max(player_number),0)+1 into n from public.players where event_id=eid;
  insert into public.players(event_id,group_id,user_id,display_name,player_number) select eid,g.group_id,uid,rr.name,n from private.accounts a join private.master_roster rr on rr.id=a.roster_id where a.id=uid returning * into me;
  if (select roles_released from private.event_settings where event_id=eid) then insert into public.player_secrets(player_id,role) values(me.id,'Faithful');end if;
  return jsonb_build_object('id',eid);
 end if;
 if cmd='configure' then
  if exists(select 1 from private.plain_tasks where event_id=eid) then raise exception 'Private task drafts are already saved for these groups. Complete flight setup before drafting tasks; this reconfiguration would replace the groups, so no changes were made.';end if;
  result:=private.game_command_before_plain_tasks(cmd,eid,args);
  n:=0;for item in select value from jsonb_array_elements(args->'groups') loop n:=n+1;update private.group_state ss set registered_flight=n from public.event_groups gg where gg.id=ss.group_id and gg.event_id=eid and gg.name=item->>'name';end loop;
  return result;
 end if;
 if cmd='late_join' and (select enabled from private.roster_settings) then
  select rr.flight into rf from private.accounts a join private.master_roster rr on rr.id=a.roster_id where a.name_key=lower(normalize(regexp_replace(trim(args->>'name'),'\s+',' ','g'),NFKC)) or rr.name_key=private.register_key(args->>'name');
  if rf is null then raise exception 'Link this existing account to the register before admitting it as a late arrival.';end if;
  if not exists(select 1 from private.group_state where event_id=eid and group_id=(args->>'group')::uuid and registered_flight=rf) then raise exception 'This player belongs to % Flight. Select that registered flight; a late arrival must not change their flight.',rf;end if;
 end if;
 -- No legacy client can select a standard second target or resolve these tasks.
 if cmd='open_murder' and (args->>'slot')::int=1 then raise exception 'Second murder uses Murder in Plain Sight. Save and send each flight task, open submissions at the break, then close, review and reveal separately.';end if;
 if cmd in ('objective','confirm_objective','report_objective','propose','lock_murder') and exists(select 1 from private.plain_tasks pt where pt.event_id=eid and pt.opportunity=(args->>'opportunity')::uuid) then raise exception 'Use the Murder in Plain Sight completion or review controls for the second murder. There is no separate target selection.';end if;
 if cmd='start_task' and exists(select 1 from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) row where row->>'id'=args->>'row' and row->>'action'='open_murder' and row->>'slot'='1') then raise exception 'Use the separate private task controls for the second murder.';end if;
 if cmd='publish_ready' and args->>'kind'='murder' and (args->>'slot')::int=1 then raise exception 'Reveal each reviewed flight separately in Murder in Plain Sight. This deliberate reveal keeps the break sequence staged.';end if;
 resolved_command:=cmd;resolved_mission:=(args->>'mission')::int;
 if cmd='start_task' then select row->>'action',(row->>'mission')::int into resolved_command,resolved_mission from jsonb_array_elements((select timetable from private.event_settings where event_id=eid)) row where row->>'id'=args->>'row';end if;
 if resolved_command in ('mission','finale','finish') and (resolved_command<>'mission' or resolved_mission=2) and exists(select 1 from private.plain_tasks pt where pt.event_id=eid and (not(args ? 'group') or pt.group_id=(args->>'group')::uuid) and pt.state not in ('draft','revealed')) then raise exception 'Finish the break task first: close submissions, approve or reject with a reason, then reveal each flight separately before Final Review.';end if;
 if cmd='publish' then
  select pt.* into t from private.plain_tasks pt join private.reveals rr on rr.opportunity=pt.opportunity where rr.id=(args->>'reveal')::uuid and pt.event_id=eid;
  if t.id is not null then
   if not host then raise exception 'Only FS Penny, the event host, may reveal this reviewed murder.';end if;
   if t.state='revealed' then return jsonb_build_object('id',eid);end if;
   if t.state<>'reviewed' then raise exception 'Close submissions and record an approve or reject decision before revealing this murder.';end if;
   select * into s from private.plain_submissions where task_id=t.id;
   if (select target from private.reveals where id=(args->>'reveal')::uuid) is not null and not private.plain_valid_target(t.group_id,s.target) then raise exception 'The proposed victim is no longer an active Faithful in this flight. Use Void invalid outcome with a reason. No replacement victim will be selected.';end if;
   if exists(select 1 from private.ballots_v2 where group_id=t.group_id and status in ('open','tie','empty')) or (select banishments from private.group_state where group_id=t.group_id)<2 then raise exception 'Finish round table 2 for this flight first: close its vote, resolve any tie and reveal or skip its ballot. The task outcome remains private.';end if;
   result:=private.game_command_before_plain_tasks(cmd,eid,args);update private.plain_tasks set state='revealed' where id=t.id;return result;
  end if;
 end if;
 if cmd not like 'plain_%' and cmd<>'flight_map' then return private.game_command_before_plain_tasks(cmd,eid,args);end if;
 if owner is null then raise exception 'Choose an existing event first.';end if;
 if (select ended from private.games where event_id=eid) then raise exception 'This event has finished. Keep its records and use a separate rehearsal.';end if;
 if cmd='flight_map' then
  if not host then raise exception 'Only the event host may map register flights.';end if;
  if jsonb_array_length(args->'groups')<>4 or (select count(distinct value) from jsonb_array_elements_text(args->'groups'))<>4 then raise exception 'Choose each event group exactly once for 1, 2, 3 and 4 Flight.';end if;
  update private.group_state set registered_flight=null where event_id=eid;
  n:=0;for item in select value from jsonb_array_elements(args->'groups') loop n:=n+1;update private.group_state set registered_flight=n where event_id=eid and group_id=(item#>>'{}')::uuid;if not found then raise exception 'A selected group does not belong to this event.';end if;end loop;
  if exists(select 1 from public.players p join private.accounts a on a.id=p.user_id join private.master_roster rr on rr.id=a.roster_id join private.group_state ss on ss.group_id=p.group_id where p.event_id=eid and rr.flight<>ss.registered_flight) then raise exception 'This mapping conflicts with an existing registered player. Keep their membership and review the mismatch privately; no players or roles have been moved.';end if;
  return jsonb_build_object('id',eid);
 end if;
 gid:=(args->>'group')::uuid;
 select * into g from private.group_state where group_id=gid and event_id=eid for update;
 if g.group_id is null then raise exception 'Choose the flight receiving this task.';end if;
 select * into t from private.plain_tasks where group_id=gid for update;
 if cmd='plain_save' then
  if not host then raise exception 'Only the event host can draft private tasks.';end if;
  if coalesce(length(trim(args->>'task')),0) not between 1 and 1500 or coalesce(args->>'explanation','') not in ('disabled','optional','required') or coalesce(args->>'photo','') not in ('disabled','optional','required') then raise exception 'Write a task of 1 to 1500 characters and choose Disabled, Optional or Required for each evidence type.';end if;
  if t.id is not null and ((args->>'revision')::bigint is distinct from t.revision or t.state<>'draft') then raise exception 'This draft changed on another device or has already been sent. Reload the task before editing; sent instructions are preserved.';end if;
  insert into private.plain_tasks(event_id,group_id,draft,draft_explanation,draft_photo,draft_nco) values(eid,gid,trim(args->>'task'),args->>'explanation',args->>'photo',coalesce((args->>'nco')::boolean,false)) on conflict(group_id) do update set draft=excluded.draft,draft_explanation=excluded.draft_explanation,draft_photo=excluded.draft_photo,draft_nco=excluded.draft_nco,revision=private.plain_tasks.revision+1;
 elsif cmd='plain_send' then
  if not host then raise exception 'Only the event host can explicitly send a task.';end if;
  if t.id is null then raise exception 'Save a task draft for this flight first.';end if;
  if t.state<>'draft' then return jsonb_build_object('id',eid);end if;
  if (args->>'revision')::bigint is distinct from t.revision then raise exception 'The draft changed. Reload and read the saved task before sending it.';end if;
  if not (select roles_released from private.event_settings where event_id=eid) or g.done then raise exception 'Release roles first and choose a flight with active Traitors.';end if;
  if not exists(select 1 from public.players p join public.player_secrets ss on ss.player_id=p.id where p.group_id=gid and p.status='Active' and ss.role='Traitor') then raise exception 'No active Traitors remain in this flight. No task will be sent.';end if;
  update private.plain_tasks set task=draft,explanation=draft_explanation,photo=draft_photo,allow_nco=draft_nco,state='sent',sent_at=now() where id=t.id;
 elsif cmd='plain_open' then
  if not host then raise exception 'Only FS Penny can open completion submissions.';end if;
  if t.state='open' then return jsonb_build_object('id',eid);end if;
  if t.state is distinct from 'sent' then raise exception 'Save and explicitly send this flight task first. Closed attempts cannot be reopened.';end if;
  if g.done or g.mission<>1 then raise exception 'This flight must be in the Evidence Room or its second round table before break submissions open.';end if;
  if exists(select 1 from private.murder_windows where group_id=gid and slot=1) then raise exception 'This flight already has a second murder opportunity. Review its saved outcome; it cannot have another victim.';end if;
  insert into private.murder_windows(event_id,group_id,slot,mode,objective) values(eid,gid,1,'plain',t.task) returning id into rid;
  update private.plain_tasks set state='open',opened_at=now(),opportunity=rid where id=t.id;
 elsif cmd='plain_close' then
  if not host then raise exception 'Only FS Penny can close submissions.';end if;
  if t.state in ('closed','reviewed','revealed') then return jsonb_build_object('id',eid);end if;
  if t.state is distinct from 'open' then raise exception 'Open completion submissions first. Sending a task alone does not open attempts.';end if;
  update private.plain_tasks set state='closed',closed_at=now() where id=t.id;
 elsif cmd in ('plain_upload','plain_submit') then
  select * into me from public.players where event_id=eid and user_id=uid and group_id=gid;
  if me.id is null or me.status<>'Active' or g.done or not (select roles_released from private.event_settings where event_id=eid) or not exists(select 1 from public.player_secrets where player_id=me.id and role='Traitor') then raise exception 'Only an active Traitor in this flight can report this task.';end if;
  if t.state is distinct from 'open' then raise exception 'Completion submissions are closed. The task stays visible; ask FS Penny if you missed the submission window.';end if;
  if exists(select 1 from private.plain_submissions where task_id=t.id) then
   if cmd='plain_submit' then return jsonb_build_object('id',eid);end if;
   raise exception 'Your flight has already submitted completion. No further evidence uploads are accepted.';
  end if;
  if not private.plain_valid_target(gid,(args->>'target')::uuid) then raise exception 'Choose an active Faithful in your own flight. If your intended person was eliminated or withdrew, do not substitute someone else; speak to FS Penny.';end if;
  if cmd='plain_upload' then
   if t.photo='disabled' then raise exception 'Photo evidence is disabled for this task. Use the requested written explanation instead.';end if;
   if (select count(*) from private.plain_uploads where task_id=t.id and reporter=me.id)>=6 then raise exception 'This task has reached its photo upload allowance. Speak to FS Penny; do not keep retrying uploads.';end if;
   rid:=gen_random_uuid();insert into private.plain_uploads(id,task_id,reporter,target,path) values(rid,t.id,me.id,(args->>'target')::uuid,rid::text||'.jpg') returning * into u;
   return jsonb_build_object('id',eid,'upload',u.id,'path',u.path);
  end if;
  if length(coalesce(args->>'explanation',''))>1500 or t.explanation='required' and coalesce(length(trim(args->>'explanation')),0)=0 then raise exception 'Explain how the physical task was completed with this proposed victim before submitting.';end if;
  if t.explanation='disabled' and coalesce(args->>'explanation','')<>'' then raise exception 'Written evidence is disabled for this task. Clear the explanation and submit the enabled evidence.';end if;
  if jsonb_typeof(coalesce(args->'photos','[]'))<>'array' or jsonb_array_length(coalesce(args->'photos','[]'))>3 then raise exception 'Attach up to three uploaded photographs.';end if;
  if t.photo='required' and jsonb_array_length(coalesce(args->'photos','[]'))=0 then raise exception 'This task requires a photograph relating to the proposed victim. Choose a photo, wait for Upload complete, then submit.';end if;
  if t.photo='disabled' and jsonb_array_length(coalesce(args->'photos','[]'))>0 then raise exception 'Photographs are disabled for this task.';end if;
  for item in select value from jsonb_array_elements(coalesce(args->'photos','[]')) loop
   select * into u from private.plain_uploads where id=(item#>>'{}')::uuid and task_id=t.id and reporter=me.id and target=(args->>'target')::uuid and submission_id is null;
   if u.id is null or not exists(select 1 from storage.objects where bucket_id='murder-evidence' and name=u.path and (metadata->>'size')::bigint between 1 and 5242880 and metadata->>'mimetype'='image/jpeg') then raise exception 'A photo is missing, incomplete or belongs to a different victim. Re-upload the correct image and wait for Upload complete.';end if;
  end loop;
  insert into private.plain_submissions(task_id,reporter,target,explanation) values(t.id,me.id,(args->>'target')::uuid,trim(coalesce(args->>'explanation',''))) returning id into rid;
  update private.plain_uploads set submission_id=rid where id in (select value::uuid from jsonb_array_elements_text(coalesce(args->'photos','[]')));
 elsif cmd='plain_verify' then
  if not host and not (t.allow_nco and exists(select 1 from private.staff where event_id=eid and group_id=gid and account_id=uid)) then raise exception 'FS Penny has not enabled evidence assistance for your assignment on this task.';end if;
  if t.state not in ('closed') or coalesce(length(trim(args->>'reason')),0) not between 1 and 500 then raise exception 'Close submissions first, then record the physical verification findings.';end if;
  update private.plain_submissions set verified_by=uid,verification=trim(args->>'reason') where task_id=t.id;
  if not found then raise exception 'There is no completion submission to verify. The host can reject the unused opportunity with a reason.';end if;
 elsif cmd='plain_review' then
  if not host then raise exception 'Only FS Penny, the event host, may approve or reject the murder. Assigned NCOs may record verification when permitted.';end if;
  if t.state in ('reviewed','revealed') then return jsonb_build_object('id',eid);end if;
  if t.state is distinct from 'closed' then raise exception 'Close completion submissions before review. This leaves round table 2 and its votes unchanged.';end if;
  if coalesce(length(trim(args->>'reason')),0) not between 1 and 500 or coalesce(args->>'decision','') not in ('approved','rejected') then raise exception 'Choose Approve or Reject and record a clear review reason.';end if;
  select * into s from private.plain_submissions where task_id=t.id;
  if args->>'decision'='approved' then
   if s.id is null then raise exception 'No completion was submitted. Reject this opportunity with a reason; no victim will be selected.';end if;
   if not private.plain_valid_target(gid,s.target) then raise exception 'The proposed victim is no longer an active Faithful in this flight. Reject with that reason. A replacement victim will not be chosen.';end if;
   if not exists(select 1 from public.players p join public.player_secrets ss on ss.player_id=p.id where p.group_id=gid and p.status='Active' and ss.role='Traitor') then raise exception 'No active Traitors remain. Reject the attempt with a reason.';end if;
  end if;
  update private.murder_windows set target=s.target where id=t.opportunity;
  if (select status from private.murder_windows where id=t.opportunity)='open' then
   perform private.resolve_murder(t.opportunity,args->>'decision'='approved',trim(args->>'reason'));
  elsif args->>'decision'='rejected' and not exists(select 1 from private.reveals where opportunity=t.opportunity) then
   insert into private.reveals(event_id,group_id,kind,opportunity) values(eid,gid,'Murdered',t.opportunity);
  else raise exception 'This murder opportunity already has a recorded outcome. Review its pending reveal instead.';end if;
  update private.plain_submissions set decision=args->>'decision',decision_reason=trim(args->>'reason'),decision_at=now() where task_id=t.id;
  update private.plain_tasks set state='reviewed',review_reason=trim(args->>'reason'),reviewed_by=uid,reviewed_at=now() where id=t.id;
 elsif cmd='plain_void' then
  if not host or t.state<>'reviewed' or coalesce(length(trim(args->>'reason')),0) not between 1 and 500 then raise exception 'Only the host can void an unrevealed invalid victim, with a recorded reason.';end if;
  select * into r from private.reveals where opportunity=t.opportunity and not published;
  if r.target is null or private.plain_valid_target(gid,r.target) then raise exception 'This pending outcome has no invalid victim to void. Review it and use its deliberate reveal control.';end if;
  update private.reveals set target=null where id=r.id;
  update private.murder_windows set success=false,reason=trim(args->>'reason') where id=t.opportunity;
  update private.plain_tasks set review_reason=trim(args->>'reason') where id=t.id;
 else raise exception 'Unknown private task action.';end if;
 insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('groups',jsonb_build_array(gid),'task',t.id,'reason',case when cmd in ('plain_review','plain_void','plain_verify') then args->>'reason' end));
 return jsonb_build_object('id',eid);
end $$;
revoke all on function private.game_command(text,uuid,jsonb) from public,anon,authenticated;

-- Second tasks run independently of the group stage. No countdown or silent
-- expiry is introduced, and none is made the group's current opportunity.
do $$declare def text;begin
 def:=pg_get_functiondef('private.control_check(uuid,uuid,text,jsonb)'::regprocedure);
 def:=replace(def,'if w.status=''open'' then','if w.status=''open'' and not exists(select 1 from private.plain_tasks pt where pt.opportunity=w.id) then');
 def:=replace(def,'wanted=c.plain_slot','wanted=1');
 def:=replace(def,'if cmd=''pause'' then',$guard$
 if (cmd in ('finale','finish') or cmd='mission' and (args->>'mission')::int=2) and exists(select 1 from private.plain_tasks pt where pt.group_id=gid and pt.state not in ('draft','revealed')) then return private.control_answer(false,'break_task_pending','Finish the break task first: close submissions, review privately and reveal this flight before Final Review.','page','{"page":"plain"}');end if;
 if cmd='pause' then$guard$);
 def:=replace(def,'where event_id=eid and group_id=gid and not published and not (','where event_id=eid and group_id=gid and not published and not (cmd=''discussion'' and g.mission=1 and g.banishments=1 and exists(select 1 from private.plain_tasks pt where pt.opportunity=private.reveals.opportunity)) and not (');
 execute def;
 def:=pg_get_functiondef('private.group_next_step(uuid,uuid)'::regprocedure);
 def:=regexp_replace(def,E'elsif g.phase=''Mission'' and g.mission=1 and \\(select plain_slot[^\\n]+\\n','','g');
 def:=replace(def,'where group_id=gid and not published and not (','where group_id=gid and not published and not (g.mission=1 and g.banishments=1 and exists(select 1 from private.plain_tasks pt where pt.opportunity=private.reveals.opportunity)) and not (');
 execute def;
 def:=pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'number=cfg.plain_slot','number=1');
 execute def;
end $$;

do $$begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_before_plain_tasks(');end $$;
revoke all on function private.snapshot_before_plain_tasks(uuid) from public,anon,authenticated;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;uid uuid:=private.current_account();host boolean;approved text;
begin
 result:=private.snapshot_before_plain_tasks(eid);
 select r.name into approved from private.accounts a join private.master_roster r on r.id=a.roster_id where a.id=uid;
 if eid is null then return result||jsonb_build_object('name',coalesce(approved,result->>'name'));end if;
 host:=(result->>'host')::boolean;
 result:=jsonb_set(result,'{groups}',coalesce((select jsonb_agg(value||jsonb_build_object('registered_flight',(select registered_flight from private.group_state where group_id=(value->>'id')::uuid))) from jsonb_array_elements(result->'groups')),'[]'));
 result:=jsonb_set(result,'{players}',coalesce((select jsonb_agg(value||jsonb_build_object('name',coalesce((select rr.name from public.players p join private.accounts a on a.id=p.user_id join private.master_roster rr on rr.id=a.roster_id where p.id=(value->>'id')::uuid),value->>'name'))) from jsonb_array_elements(result->'players')),'[]'));
 if approved is not null and result->'me'<>'null'::jsonb then result:=jsonb_set(result,'{me,name}',to_jsonb(approved));end if;
 -- Fellow Traitors include current status, but only an active released Traitor
 -- may receive them. Eliminated viewers never receive the private circle.
 result:=result||jsonb_build_object('fellows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(rr.name,p.display_name),'status',p.status)) from public.players p join public.player_secrets ss on ss.player_id=p.id left join private.accounts a on a.id=p.user_id left join private.master_roster rr on rr.id=a.roster_id where p.event_id=eid and p.group_id=(result->'me'->>'group')::uuid and p.id<>(result->'me'->>'id')::uuid and ss.role='Traitor' and result->'me'->>'role'='Traitor' and result->'me'->>'status'='Active' and (result->>'roles_released')::boolean),'[]'));
 result:=result||jsonb_build_object('plain_tasks',coalesce((select jsonb_agg(
  jsonb_build_object('id',t.id,'group',t.group_id,'state',t.state,'task',case when t.state<>'draft' then t.task end,'explanation',t.explanation,'photo',t.photo,'allow_nco',t.allow_nco,'sent_at',t.sent_at,'opportunity',t.opportunity,
  'submission',(select (to_jsonb(s)-case when host or t.allow_nco and exists(select 1 from private.staff st where st.event_id=eid and st.group_id=t.group_id and st.account_id=uid) then '{}'::text[] else array['verified_by','verification','decision','decision_reason','decision_at'] end)||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'path',u.path)) from private.plain_uploads u where u.submission_id=s.id),'[]')) from private.plain_submissions s where s.task_id=t.id),
  'outcome',case when host or t.allow_nco and exists(select 1 from private.staff st where st.event_id=eid and st.group_id=t.group_id and st.account_id=uid) then (select jsonb_build_object('success',w.success,'reason',w.reason) from private.murder_windows w where w.id=t.opportunity) end,
  'review_reason',case when host or t.allow_nco and exists(select 1 from private.staff st where st.event_id=eid and st.group_id=t.group_id and st.account_id=uid) then t.review_reason end)
  ||case when host then jsonb_build_object('draft',t.draft,'draft_explanation',t.draft_explanation,'draft_photo',t.draft_photo,'draft_nco',t.draft_nco,'revision',t.revision) else '{}'::jsonb end)
  from private.plain_tasks t where t.event_id=eid and (host or private.plain_can_read(t.id))),'[]'));
 -- Task evidence must not fall through the old NCO read permission.
 result:=jsonb_set(result,'{windows}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'windows') where not exists(select 1 from private.plain_tasks t where t.opportunity=(value->>'id')::uuid)),'[]'));
 result:=jsonb_set(result,'{reveals}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'reveals') where host or (value->>'published')::boolean or not exists(select 1 from private.plain_tasks t where t.opportunity=(value->>'opportunity')::uuid and not private.plain_can_read(t.id))),'[]'));
 if not host and jsonb_typeof(result->'audit')='array' then result:=jsonb_set(result,'{audit}',coalesce((select jsonb_agg(value) from jsonb_array_elements(result->'audit') where value->>'action' not like 'plain_%' or private.plain_can_read((value->'details'->>'task')::uuid)),'[]'));end if;
 return result;
end $$;
revoke all on function private.snapshot(uuid) from public,anon;
grant execute on function private.snapshot(uuid) to authenticated;
do $$begin execute replace(pg_get_functiondef('private.recovery_export(uuid)'::regprocedure),'private.recovery_export(','private.recovery_export_before_tasks(');end $$;
revoke all on function private.recovery_export_before_tasks(uuid) from public,anon,authenticated;
create or replace function private.recovery_export(eid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.recovery_export_before_tasks(eid);
 return result||jsonb_build_object('plain_tasks',coalesce((select jsonb_agg(to_jsonb(t)) from private.plain_tasks t where event_id=eid),'[]'),
 'plain_submissions',coalesce((select jsonb_agg(to_jsonb(s)) from private.plain_submissions s join private.plain_tasks t on t.id=s.task_id where t.event_id=eid),'[]'),
 'private_evidence_metadata',coalesce((select jsonb_agg(to_jsonb(u)) from private.plain_uploads u join private.plain_tasks t on t.id=u.task_id where t.event_id=eid),'[]'));
end $$;
revoke all on function private.recovery_export(uuid) from public,anon;
grant execute on function private.recovery_export(uuid) to authenticated;
-- All additional implementation helpers are internal, except the deliberately
-- narrow evidence predicate invoked by the Storage RLS policy.
revoke all on function private.register_key(text),private.roster_report(),private.plain_can_read(uuid),private.plain_valid_target(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
-- BEGIN REGISTER UPDATE PUBLIC CONTENT
create or replace function private.mission_plan_cards() returns jsonb language sql immutable set search_path='' as $$ select '[{"idx":0,"title":"The Locked Archive","minutes":25,"max_points":100,"instructions":"Work in three teams to decode Signals, Plotting and Registry evidence. Combine your digits in that order and explain your reasoning to your flight NCO. The NCO checks the existing code and authorises opening your sealed ARCHIVE envelope. There are four ARCHIVE envelopes, one per flight. Keep the CASE RAVEN envelope inside sealed until the Evidence Room begins. Keep clues within your flight. Phones away unless an NCO asks otherwise.","equipment":"Four sealed ARCHIVE envelopes, each containing a sealed CASE RAVEN envelope; three printed clue packs per flight, response sheets and pens. Wax-style seals are optional decoration."},{"idx":1,"title":"The Evidence Room: Case investigation","minutes":20,"max_points":125,"instructions":"A fictional classified file called RAVEN has been stolen. Compare the witness statement, badge register, door log, clock notice and storage records. Identify the suspect, theft time, exact hiding place, false claim and the evidence chain. Submit one flight response. These fictional characters have no connection to players’ secret roles.","equipment":"Printed case packs, response sheet and pens. Keep final-review evidence sealed until the later activity."},{"idx":2,"title":"The Evidence Room: Final Review","minutes":15,"max_points":100,"instructions":"Reopen the same case. Compare the new evidence with the original file. Decide which new report is false, explain why and identify who submitted it. State whether your original conclusion changes. Submit one final flight response.","equipment":"Retained case papers, sealed final-review pack, response sheet and pens."}]'::jsonb; $$;
revoke all on function private.mission_plan_cards() from public,anon,authenticated;
create or replace function private.mission_plan_timetable() returns jsonb language sql immutable set search_path='' as $$ select '[{"id":"briefing","time":"19:00","minutes":10,"label":"Welcome and joining","action":"activity","mission":null,"slot":null},{"id":"roles","time":"19:10","minutes":5,"label":"Joining checks and role release","action":"release_roles","mission":null,"slot":null},{"id":"archive","time":"19:15","minutes":25,"label":"The Locked Archive","action":"mission","mission":0,"slot":null},{"id":"round1","time":"19:40","minutes":10,"label":"Round table 1","action":"discussion","mission":null,"slot":null},{"id":"murder1","time":"19:50","minutes":5,"label":"First murder opportunity and reveal","action":"open_murder","mission":null,"slot":0},{"id":"vault","time":"19:55","minutes":20,"label":"The Evidence Room: Case investigation","action":"mission","mission":1,"slot":null},{"id":"round2","time":"20:15","minutes":10,"label":"Round table 2","action":"discussion","mission":null,"slot":null},{"id":"task-send","time":"20:24","minutes":1,"label":"Send private Murder in Plain Sight tasks","action":"activity","mission":null,"slot":null},{"id":"break","time":"20:25","minutes":10,"label":"Break and Murder in Plain Sight attempts","action":"activity","mission":null,"slot":null},{"id":"task-close","time":"20:32","minutes":1,"label":"Close submissions and private review","action":"activity","mission":null,"slot":null},{"id":"task-reveal","time":"20:33","minutes":2,"label":"Staged second murder reveals","action":"activity","mission":null,"slot":null},{"id":"transmission","time":"20:35","minutes":15,"label":"The Evidence Room: Final Review","action":"mission","mission":2,"slot":null},{"id":"round3","time":"20:50","minutes":15,"label":"Final round table","action":"discussion","mission":null,"slot":null},{"id":"results","time":"21:05","minutes":5,"label":"Final reveals and awards","action":"finish","mission":null,"slot":null},{"id":"clearup","time":"21:10","minutes":5,"label":"Clear up and form up","action":"activity","mission":null,"slot":null},{"id":"parade","time":"21:15","minutes":15,"label":"Parade","action":"activity","mission":null,"slot":null}]'::jsonb; $$;
revoke all on function private.mission_plan_timetable() from public,anon,authenticated;
-- Preserve private answers, marking, scores and existing target times.
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
