-- Fresh-project baseline. For an existing project follow docs/DEPLOYMENT.md.

-- 001-foundation.sql
-- Run once in your dedicated project's SQL Editor.
-- Foundation only: joining, voting and host commands need server functions next.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null default '2427: Trust No One',
  owner_id uuid not null references auth.users(id),
  joining_open boolean not null default false,
  phase integer not null default 0 check (phase >= 0),
  created_at timestamptz not null default now()
);

create table public.event_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  unique(event_id, name),
  unique(event_id, id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null,
  user_id uuid not null references auth.users(id),
  display_name text not null check (length(trim(display_name)) between 1 and 30),
  status text not null default 'Active' check (status in ('Active','Banished','Murdered')),
  unique(event_id, user_id),
  foreign key(event_id, group_id) references public.event_groups(event_id, id)
);

-- No public roster table contains secret roles or PIN verifiers.
create table public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  role text not null check (role in ('Faithful','Traitor'))
);

alter table public.events enable row level security;
alter table public.event_groups enable row level security;
alter table public.players enable row level security;
alter table public.player_secrets enable row level security;

revoke all on public.events, public.event_groups, public.players, public.player_secrets from anon, authenticated;
grant select on public.events, public.event_groups, public.players, public.player_secrets to authenticated;

-- Read-only foundation. Browser clients cannot create or modify game records.
create policy "Owner reads event" on public.events for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owner reads groups" on public.event_groups for select to authenticated
  using (exists(select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy "Owner or player reads profile" on public.players for select to authenticated
  using (user_id = (select auth.uid()) or exists(select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy "Owner or player reads own role" on public.player_secrets for select to authenticated
  using (exists(select 1 from public.players p where p.id = player_id and
    (p.user_id = (select auth.uid()) or exists(select 1 from public.events e where e.id = p.event_id and e.owner_id = (select auth.uid())))));

create index events_owner_idx on public.events(owner_id);
create index players_user_idx on public.players(user_id);
create index players_group_idx on public.players(group_id);

-- A connection check that exposes no game data and changes nothing.
create function public.tno_connection_check()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('app', 'trust-no-one', 'schema_version', 1); $$;
revoke all on function public.tno_connection_check() from public;
grant execute on function public.tno_connection_check() to anon, authenticated;


-- 002-connected.sql
-- Run after 001-foundation.sql. No existing player or event data is deleted.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table private.accounts(
 id uuid primary key references auth.users(id), name text not null,
 name_key text not null unique, pin_hash text not null,
 failed integer not null default 0, locked_until timestamptz
);
create table private.sessions(
 auth_user uuid primary key references auth.users(id) on delete cascade,
 account_id uuid not null references private.accounts(id),
 expires_at timestamptz not null default now()+interval '8 hours'
);
create table private.login_limits(auth_user uuid primary key references auth.users(id) on delete cascade,
 attempts integer not null default 0, window_start timestamptz not null default now());
alter table private.accounts enable row level security;
alter table private.sessions enable row level security;
alter table private.login_limits enable row level security;

create function private.current_account() returns uuid language sql stable security definer set search_path='' as $$
 select account_id from private.sessions where auth_user=auth.uid() and expires_at>now();
$$;
create function private.login(display_name text,pin text,register boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a private.accounts; key text; display text; attempts integer;
begin
 if uid is null then raise exception 'Session required.'; end if;
 -- Serialise name claims and attempts. This is a small event service, not a bulk signup endpoint.
 perform pg_advisory_xact_lock(724271);
 insert into private.login_limits(auth_user) values(uid) on conflict do nothing;
 update private.login_limits set attempts=0,window_start=now() where auth_user=uid and window_start<now()-interval '15 minutes';
 update private.login_limits set attempts=private.login_limits.attempts+1 where auth_user=uid returning private.login_limits.attempts into attempts;
 if attempts>10 then return jsonb_build_object('error','Too many attempts. Wait 15 minutes.'); end if;
 display:=regexp_replace(trim(display_name),'\s+',' ','g'); key:=lower(normalize(display,NFKC));
 if display is null or length(display) not between 1 and 30 or pin is null or pin !~ '^[0-9]{4}$' then return jsonb_build_object('error','Enter your name and a four-digit PIN.'); end if;
 select * into a from private.accounts where name_key=key for update;
 if register then
  if a.id is not null then return jsonb_build_object('error','That name is taken. Sign in or use a different name.'); end if;
  if exists(select 1 from private.accounts where id=uid) then return jsonb_build_object('error','Sign out before creating a different account.'); end if;
  insert into private.accounts(id,name,name_key,pin_hash) values(uid,display,key,extensions.crypt(pin,extensions.gen_salt('bf',12))) returning * into a;
 else
  if a.id is null then return jsonb_build_object('error','Name or PIN not recognised.'); end if;
  if a.locked_until>now() then return jsonb_build_object('error','Too many attempts. Wait 15 minutes or ask the organiser.'); end if;
  if a.locked_until is not null then update private.accounts set failed=0,locked_until=null where id=a.id; a.failed:=0; end if;
  if extensions.crypt(pin,a.pin_hash)<>a.pin_hash then
   update private.accounts set failed=failed+1,locked_until=case when failed+1>=5 then now()+interval '15 minutes' end where id=a.id;
   return jsonb_build_object('error','Name or PIN not recognised.');
  end if;
 end if;
 update private.accounts set failed=0,locked_until=null where id=a.id;
 insert into private.sessions(auth_user,account_id) values(uid,a.id) on conflict(auth_user) do update set account_id=excluded.account_id,expires_at=now()+interval '8 hours';
 return jsonb_build_object('name',a.name);
end $$;
create function private.logout() returns void language sql security definer set search_path='' as $$
 delete from private.sessions where auth_user=auth.uid();
$$;
create table private.hosts(user_id uuid primary key references auth.users(id));
create table private.games(
 event_id uuid primary key references public.events(id) on delete cascade,
 code text unique not null, display_token uuid not null default gen_random_uuid(), stage text not null default 'Joining', round integer not null default 0,
 ballot_open boolean not null default false, ended boolean not null default false,
 announcement text not null default '', objective text not null default '',
 capacity integer not null check(capacity between 2 and 100), traitors integer not null check(traitors between 1 and 5)
);
create table private.ballots(
 event_id uuid not null references public.events(id) on delete cascade, round integer not null,
 voter uuid not null references public.players(id), target uuid not null references public.players(id),
 primary key(event_id,round,voter)
);
create table private.outcomes(
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
 round integer not null, group_id uuid not null references public.event_groups(id),
 kind text not null check(kind in ('Banished','Murdered')), target uuid references public.players(id),
 published boolean not null default false, reveal_role boolean not null default false,
 unique(event_id,round,group_id,kind)
);
create table private.proposals(
 event_id uuid not null references public.events(id) on delete cascade, round integer not null,
 actor uuid not null references public.players(id), target uuid not null references public.players(id),
 primary key(event_id,round,actor)
);
create table private.audit(
 id bigint generated always as identity primary key, event_id uuid not null references public.events(id) on delete cascade,
 actor uuid not null references auth.users(id), action text not null, details jsonb not null,
 created_at timestamptz not null default now()
);
alter table private.hosts enable row level security;
alter table private.games enable row level security;
alter table private.ballots enable row level security;
alter table private.outcomes enable row level security;
alter table private.proposals enable row level security;
alter table private.audit enable row level security;
revoke all on all tables in schema private from anon,authenticated;
create index outcomes_event_idx on private.outcomes(event_id);
create index audit_event_idx on private.audit(event_id,created_at);

-- All commands are atomic. The event row serialises joins, assignment and ballots.
-- Privileged implementation stays outside exposed schemas; callers get only wrappers.
create function private.command(cmd text, eid uuid, args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 uid uuid := private.current_account(); ev public.events; game private.games; me public.players;
 chosen public.players; grp public.event_groups; n integer; gid uuid; pid uuid; outid uuid;
 ishost boolean; result uuid; topvotes bigint; ties integer; textval text;
begin
 if uid is null then raise exception 'Sign in with your name and PIN first.'; end if;
 if cmd='create' then
  if not exists(select 1 from private.hosts where user_id=uid) then raise exception 'Your account does not have host access.'; end if;
  n := (args->>'groups')::integer;
  if n is null or n not between 1 and 5 or length(trim(args->>'title')) not between 1 and 80 then raise exception 'Enter a title and 1 to 5 groups.'; end if;
  insert into public.events(title,owner_id,joining_open) values(trim(args->>'title'),uid,true) returning * into ev;
  insert into private.games(event_id,code,capacity,traitors) values(ev.id,upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),(args->>'capacity')::integer,(args->>'traitors')::integer);
  for i in 1..n loop insert into public.event_groups(event_id,name) values(ev.id,(array['Raven','Ember','Thorn','Ash','Vesper'])[i]); end loop;
  return jsonb_build_object('id',ev.id);
 end if;
 if cmd='join' then select event_id into eid from private.games where code=upper(trim(args->>'code')); end if;
 select * into ev from public.events where id=eid for update;
 if not found then raise exception 'Game not found. Check the joining code.'; end if;
 select * into game from private.games where event_id=eid;
 if not found then raise exception 'This event has no connected game.'; end if;
 ishost := ev.owner_id=uid;
 select * into me from public.players where event_id=eid and user_id=uid;
 if cmd='join' then
  if ishost then raise exception 'You are the host. Use a separate account to play.'; end if;
  if me.id is not null then return jsonb_build_object('id',eid); end if;
  if not ev.joining_open or game.ended then raise exception 'Joining is closed.'; end if;
  textval:=trim(args->>'name');
  if textval is null or length(textval) not between 1 and 30 then raise exception 'Enter a name of 1 to 30 characters.'; end if;
  if exists(select 1 from public.players where event_id=eid and lower(display_name)=lower(textval)) then raise exception 'That callsign is taken. Add an initial or number.'; end if;
  if (select count(*) from public.players where event_id=eid)>=game.capacity then raise exception 'This game is full.'; end if;
  select g.id into gid from public.event_groups g left join public.players p on p.group_id=g.id where g.event_id=eid group by g.id order by count(p.id),g.name limit 1;
  insert into public.players(event_id,group_id,user_id,display_name) values(eid,gid,uid,textval);
  return jsonb_build_object('id',eid);
 end if;
 if game.ended then raise exception 'This game has ended.'; end if;
 if cmd in ('vote','propose') then
  if me.id is null or me.status<>'Active' then raise exception 'Only active players can do that.'; end if;
  select * into chosen from public.players where id=(args->>'target')::uuid and event_id=eid;
  if chosen.id is null or chosen.group_id<>me.group_id or chosen.status<>'Active' or chosen.id=me.id then raise exception 'Choose another active player in your group.'; end if;
  if cmd='vote' then
   if game.stage<>'Round table' or not game.ballot_open then raise exception 'Voting is closed.'; end if;
   insert into private.ballots values(eid,game.round,me.id,chosen.id) on conflict(event_id,round,voter) do update set target=excluded.target;
  else
   if game.stage<>'Night' or not exists(select 1 from public.player_secrets where player_id=me.id and role='Traitor')
    or not exists(select 1 from public.player_secrets where player_id=chosen.id and role='Faithful') then raise exception 'This target choice is not permitted.'; end if;
   if exists(select 1 from private.outcomes where event_id=eid and round=game.round and group_id=me.group_id and kind='Murdered') then raise exception 'This night has already been resolved.'; end if;
   insert into private.proposals values(eid,game.round,me.id,chosen.id) on conflict(event_id,round,actor) do update set target=excluded.target;
  end if;
 else
  if not ishost then raise exception 'Only this game''s host can do that.'; end if;
  case cmd
  when 'assign' then
   if exists(select 1 from public.player_secrets s join public.players p on p.id=s.player_id where p.event_id=eid) then raise exception 'Roles have already been assigned.'; end if;
   for grp in select * from public.event_groups where event_id=eid loop
    if (select count(*) from public.players where group_id=grp.id)<=game.traitors then raise exception 'Each group needs at least % players.',game.traitors+1; end if;
    insert into public.player_secrets(player_id,role)
     select id,case when row_number() over(order by gen_random_uuid())<=game.traitors then 'Traitor' else 'Faithful' end from public.players where group_id=grp.id;
   end loop;
   update public.events set joining_open=false where id=eid;
   update private.games set stage='Mission' where event_id=eid;
  when 'stage' then
   if game.stage='Joining' or game.ballot_open or exists(select 1 from private.outcomes where event_id=eid and not published) then raise exception 'Assign roles, close ballots and publish pending outcomes before changing stage.'; end if;
   textval:=args->>'stage';
   if textval not in ('Mission','Round table','Night') or textval=game.stage then raise exception 'Choose a different stage.'; end if;
   update private.games set stage=textval,round=round+1 where event_id=eid;
  when 'open_vote' then
   if game.stage<>'Round table' or game.ballot_open or exists(select 1 from private.outcomes where event_id=eid and round=game.round) then raise exception 'This ballot cannot be opened.'; end if;
   update private.games set ballot_open=true where event_id=eid;
  when 'close_vote' then
   if not game.ballot_open then raise exception 'Voting is already closed.'; end if;
   for grp in select * from public.event_groups where event_id=eid loop
    result:=null;
    select count(*) into topvotes from private.ballots where event_id=eid and round=game.round and voter in(select id from public.players where group_id=grp.id) group by target order by count(*) desc limit 1;
    select count(*) into ties from (select target from private.ballots where event_id=eid and round=game.round and voter in(select id from public.players where group_id=grp.id) group by target having count(*)=topvotes) t;
    if ties=1 then select target into result from private.ballots where event_id=eid and round=game.round and voter in(select id from public.players where group_id=grp.id) group by target order by count(*) desc limit 1; end if;
    insert into private.outcomes(event_id,round,group_id,kind,target) values(eid,game.round,grp.id,'Banished',result);
   end loop;
   update private.games set ballot_open=false where event_id=eid;
  when 'resolve_tie' then
   select * into chosen from public.players where id=(args->>'target')::uuid and event_id=eid and status='Active';
   if chosen.id is null then raise exception 'Choose an active tied candidate.'; end if;
   select count(*) into topvotes from private.ballots b join public.players p on p.id=b.voter where b.event_id=eid and b.round=game.round and p.group_id=chosen.group_id group by b.target order by count(*) desc limit 1;
   if topvotes is null or (select count(*) from private.ballots where event_id=eid and round=game.round and target=chosen.id)<>topvotes then raise exception 'Choose a candidate tied for the most votes.'; end if;
   update private.outcomes set target=chosen.id where event_id=eid and round=game.round and group_id=chosen.group_id and kind='Banished' and target is null and not published;
   if not found then raise exception 'No unresolved tie.'; end if;
  when 'confirm_murder' then
   if game.stage<>'Night' then raise exception 'Move to Night first.'; end if;
   select * into chosen from public.players where id=(args->>'target')::uuid and event_id=eid and status='Active';
   if chosen.id is null or not exists(select 1 from public.player_secrets where player_id=chosen.id and role='Faithful') or not exists(select 1 from private.proposals pr join public.players p on p.id=pr.actor join public.player_secrets s on s.player_id=p.id where pr.event_id=eid and pr.round=game.round and pr.target=chosen.id and p.status='Active' and s.role='Traitor') then raise exception 'Choose a valid target proposed by an active Traitor.'; end if;
   insert into private.outcomes(event_id,round,group_id,kind,target) values(eid,game.round,chosen.group_id,'Murdered',chosen.id);
  when 'publish' then
   outid:=(args->>'outcome')::uuid;
   select o.target into pid from private.outcomes o where o.id=outid and o.event_id=eid and not o.published for update;
   if not found then raise exception 'No unpublished outcome.'; end if;
   update public.players set status=(select kind from private.outcomes where id=outid) where id=pid and status='Active';
   update private.outcomes set published=true where id=outid;
  when 'reveal' then
   update private.outcomes set reveal_role=true where id=(args->>'outcome')::uuid and event_id=eid and published and kind='Banished';
   if not found then raise exception 'Publish a banishment first.'; end if;
  when 'score' then
   n:=(args->>'delta')::integer;
   if n is null or abs(n)>1000 or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Enter up to 1000 points and a reason.'; end if;
   update public.event_groups set score=score+n where id=(args->>'group')::uuid and event_id=eid;
   if not found then raise exception 'Group not found.'; end if;
  when 'announce' then
   if length(args->>'text')>1000 then raise exception 'Maximum 1000 characters.'; end if;
   update private.games set announcement=coalesce(args->>'text','') where event_id=eid;
  when 'objective' then
   if length(args->>'text')>1000 then raise exception 'Maximum 1000 characters.'; end if;
   update private.games set objective=coalesce(args->>'text','') where event_id=eid;
  when 'finish' then
   if game.stage='Joining' or game.ballot_open or exists(select 1 from private.outcomes where event_id=eid and not published) then raise exception 'Close ballots and publish all pending outcomes first.'; end if;
   update private.games set ended=true,stage='Results' where event_id=eid;
  else raise exception 'Unknown command.';
  end case;
 end if;
 insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,args);
 return jsonb_build_object('id',eid);
end $$;

create function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_account(); ev public.events; game private.games; me public.players; host boolean; myrole text;
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if eid is null then
  return jsonb_build_object('name',(select name from private.accounts where id=uid),'can_host',exists(select 1 from private.hosts where user_id=uid),'games',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'host',e.owner_id=uid)) from public.events e join private.games g on g.event_id=e.id where e.owner_id=uid or exists(select 1 from public.players where event_id=e.id and user_id=uid)),'[]'::jsonb));
 end if;
 select * into ev from public.events where id=eid;
 host:=coalesce(ev.owner_id=uid,false);
 select * into me from public.players where event_id=eid and user_id=uid;
 if not host and me.id is null then raise exception 'You are not a member of this game.'; end if;
 select * into game from private.games where event_id=eid;
 select role into myrole from public.player_secrets where player_id=me.id;
 return jsonb_build_object('id',eid,'title',ev.title,'host',host,'code',case when host then game.code end,'display_token',case when host then game.display_token end,'stage',game.stage,'round',game.round,'ended',game.ended,'ballot_open',game.ballot_open,'announcement',game.announcement,'objective',case when host or (me.status='Active' and myrole='Traitor') then game.objective end,
 'me',case when me.id is not null then jsonb_build_object('id',me.id,'group',me.group_id,'status',me.status,'role',myrole,'vote',(select target from private.ballots where event_id=eid and round=game.round and voter=me.id),'proposal',(select target from private.proposals where event_id=eid and round=game.round and actor=me.id)) end,
 'groups',(select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'score',g.score,'winner',case when game.ended then case when exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=g.id and p.status='Active' and s.role='Traitor') then 'Traitors' else 'Faithful' end end)) from public.event_groups g where g.event_id=eid),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'group',p.group_id,'status',p.status,'role',case when game.ended or host or (me.status='Active' and myrole='Traitor' and p.status='Active' and p.group_id=me.group_id and s.role='Traitor') or exists(select 1 from private.outcomes o where o.event_id=eid and o.target=p.id and o.reveal_role) then s.role end)) from public.players p left join public.player_secrets s on s.player_id=p.id where p.event_id=eid),'[]'::jsonb),
 'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'target',o.target,'group',o.group_id,'kind',o.kind,'published',o.published,'reveal_role',o.reveal_role)) from private.outcomes o where o.event_id=eid and (host or o.published)),'[]'::jsonb),
 'proposals',case when host then coalesce((select jsonb_agg(jsonb_build_object('actor',pr.actor,'target',pr.target)) from private.proposals pr where pr.event_id=eid and pr.round=game.round),'[]'::jsonb) end,
 'tally',case when host and not game.ballot_open then coalesce((select jsonb_agg(to_jsonb(t)) from(select target,count(*) as votes from private.ballots where event_id=eid and round=game.round group by target)t),'[]'::jsonb) end,
 'audit',case when host then coalesce((select jsonb_agg(to_jsonb(a)) from(select action,details,created_at from private.audit where event_id=eid order by id desc limit 50)a),'[]'::jsonb) end);
end $$;

revoke all on function private.command(text,uuid,jsonb), private.snapshot(uuid) from public,anon;
grant execute on function private.command(text,uuid,jsonb), private.snapshot(uuid) to authenticated;
create function public.tno_command(cmd text,eid uuid default null,args jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.command(cmd,eid,args); $$;
create function public.tno_snapshot(eid uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.snapshot(eid); $$;
revoke all on function public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid) from public,anon;
grant execute on function public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid) to authenticated;
-- A public board uses its own unguessable link and a strict public projection.
create function private.board(token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid; game private.games;
begin
 select * into game from private.games where display_token=token;
 if not found then raise exception 'Display not found.'; end if;
 eid:=game.event_id;
 return jsonb_build_object('title',(select title from public.events where id=eid),'stage',game.stage,'announcement',game.announcement,
 'groups',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'score',score)) from public.event_groups where event_id=eid),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'group',p.group_id,'status',p.status,'role',case when game.ended or exists(select 1 from private.outcomes o where o.event_id=eid and o.target=p.id and o.published and o.reveal_role) then s.role end)) from public.players p left join public.player_secrets s on s.player_id=p.id where p.event_id=eid),'[]'::jsonb));
end $$;
revoke all on function private.board(uuid) from public;
grant usage on schema private to anon;
grant execute on function private.board(uuid) to anon,authenticated;
create function public.tno_board(token uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.board(token); $$;
revoke all on function public.tno_board(uuid) from public;
grant execute on function public.tno_board(uuid) to anon,authenticated;
notify pgrst,'reload schema';
-- PIN login establishes the application identity; Auth's anonymous token alone grants nothing.
revoke all on function private.current_account(),private.login(text,text,boolean),private.logout() from public,anon;
grant execute on function private.login(text,text,boolean),private.logout() to authenticated;
create function public.tno_login(display_name text,pin text,register boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.login(display_name,pin,register); $$;
create function public.tno_logout() returns void language sql security invoker set search_path='' as $$ select private.logout(); $$;
revoke all on function public.tno_login(text,text,boolean),public.tno_logout() from public,anon;
grant execute on function public.tno_login(text,text,boolean),public.tno_logout() to authenticated;
-- Prevent the foundation's auth.uid policies from exposing records before PIN login.
revoke all on public.events,public.event_groups,public.players,public.player_secrets from anon,authenticated;
create or replace function public.tno_connection_check() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('app','trust-no-one','schema_version',2); $$;

-- 005-security.sql
-- Run ONCE after 002-connected.sql. Existing accounts and game records are preserved.
-- Existing application sessions must sign in again to bind a live Auth session.

alter table private.sessions add column auth_session uuid;
create index sessions_account_idx on private.sessions(account_id);
create index sessions_auth_session_idx on private.sessions(auth_session);
create unique index games_display_token_idx on private.games(display_token);
create table private.request_limits(
 account_id uuid not null references private.accounts(id),
 bucket text not null, started timestamptz not null default now(), used integer not null default 0,
 primary key(account_id,bucket)
);
create table private.receipts(
 account_id uuid not null references private.accounts(id), request_id uuid not null,
 command text not null, event_id uuid, arguments jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(account_id,request_id)
);
alter table private.request_limits enable row level security;
alter table private.receipts enable row level security;
revoke all on private.request_limits,private.receipts from public,anon,authenticated;

create or replace function private.current_account() returns uuid language sql stable security definer set search_path='' as $$
 select s.account_id from private.sessions s
 join auth.sessions a on a.id=s.auth_session and a.user_id=s.auth_user
 where s.auth_user=auth.uid() and s.expires_at>now()
 and s.auth_session=(auth.jwt()->>'session_id')::uuid;
$$;

-- Keep the verified credential implementation and wrap it with stricter session checks.
alter function private.login(text,text,boolean) rename to login_core;
revoke all on function private.login_core(text,text,boolean) from public,anon,authenticated;
create or replace function private.login_core(display_name text,pin text,register boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a private.accounts; key text; display text; attempts integer;
begin
 if uid is null then raise exception 'Session required.'; end if;
 -- Independent names no longer share a global bcrypt lock.
 perform pg_advisory_xact_lock(hashtextextended('login:'||uid::text,0));
 insert into private.login_limits(auth_user) values(uid) on conflict do nothing;
 update private.login_limits set attempts=0,window_start=now() where auth_user=uid and window_start<now()-interval '15 minutes';
 update private.login_limits set attempts=private.login_limits.attempts+1 where auth_user=uid returning private.login_limits.attempts into attempts;
 if attempts>10 then return jsonb_build_object('error','Too many attempts. Wait 15 minutes.'); end if;
 display:=regexp_replace(trim(display_name),'\s+',' ','g'); key:=lower(normalize(display,NFKC));
 if display is null or length(display) not between 1 and 30 or pin is null or pin !~ '^[0-9]{4}$' then return jsonb_build_object('error','Enter your name and a four-digit PIN.'); end if;
 perform pg_advisory_xact_lock(hashtextextended('name:'||key,0));
 select * into a from private.accounts where name_key=key for update;
 if register then
  if a.id is not null then return jsonb_build_object('error','That name is taken. Sign in or use a different name.'); end if;
  if exists(select 1 from private.accounts where id=uid) then return jsonb_build_object('error','Sign out before creating a different account.'); end if;
  insert into private.accounts(id,name,name_key,pin_hash) values(uid,display,key,extensions.crypt(pin,extensions.gen_salt('bf',12))) returning * into a;
 else
  if a.id is null then return jsonb_build_object('error','Name or PIN not recognised.'); end if;
  if a.locked_until>now() then return jsonb_build_object('error','Too many attempts. Wait 15 minutes or ask the organiser.'); end if;
  if a.locked_until is not null then update private.accounts set failed=0,locked_until=null where id=a.id; a.failed:=0; end if;
  if extensions.crypt(pin,a.pin_hash)<>a.pin_hash then
   update private.accounts set failed=failed+1,locked_until=case when failed+1>=5 then now()+interval '15 minutes' end where id=a.id;
   return jsonb_build_object('error','Name or PIN not recognised.');
  end if;
 end if;
 update private.accounts set failed=0,locked_until=null where id=a.id;
 insert into private.sessions(auth_user,account_id) values(uid,a.id) on conflict(auth_user) do update set account_id=excluded.account_id,expires_at=now()+interval '8 hours';
 return jsonb_build_object('name',a.name);
end $$;

create function private.login(display_name text,pin text,register boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; sid uuid;
begin
 sid:=(auth.jwt()->>'session_id')::uuid;
 if auth.uid() is null or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then
  return jsonb_build_object('error','This session has expired. Reload and sign in again.');
 end if;
 if display_name is null or octet_length(display_name)>240 or pin is null or length(pin)<>4 then
  return jsonb_build_object('error','Enter your name and a four-digit PIN.');
 end if;
 result:=private.login_core(display_name,pin,register);
 if not result ? 'error' then update private.sessions set auth_session=sid where auth_user=auth.uid(); end if;
 return result;
end $$;
revoke all on function private.login(text,text,boolean) from public,anon;
grant execute on function private.login(text,text,boolean) to authenticated;

-- Per-account limits cover invalid game-code guesses and persist after rejected commands.
-- Returning errors rather than raising them preserves the counter transaction.
alter function private.command(text,uuid,jsonb) rename to game_command;
revoke all on function private.game_command(text,uuid,jsonb) from public,anon,authenticated;
create function private.command(cmd text,eid uuid,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_account(); used integer; quota_bucket text; rid uuid; old private.receipts; result jsonb;
begin
 if uid is null then return jsonb_build_object('error','Sign in with your name and PIN first.'); end if;
 if args is null or jsonb_typeof(args)<>'object' or octet_length(args::text)>4096 or length(cmd)>40 then return jsonb_build_object('error','Invalid request.'); end if;
 -- Serialise retries and quota updates for this account, across devices.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,5));
 begin rid:=(args->>'request_id')::uuid; exception when invalid_text_representation then return jsonb_build_object('error','Invalid request identifier.'); end;
 if rid is null then return jsonb_build_object('error','Refresh the website to load its security update.'); end if;
 select * into old from private.receipts where account_id=uid and request_id=rid;
 if found then
  if old.command=cmd and old.event_id is not distinct from eid and old.arguments=args then return old.result; end if;
  return jsonb_build_object('error','A request identifier cannot be reused for another action.');
 end if;
 quota_bucket:=case when cmd='join' then 'join' else 'command' end;
 insert into private.request_limits(account_id,bucket) values(uid,quota_bucket) on conflict do nothing;
 update private.request_limits q set started=now(),used=0 where q.account_id=uid and q.bucket=quota_bucket and q.started<now()-interval '1 minute';
 update private.request_limits q set used=q.used+1 where q.account_id=uid and q.bucket=quota_bucket returning q.used into used;
 if used>(case when quota_bucket='join' then 10 else 60 end) then return jsonb_build_object('error','Too many requests. Wait one minute and try again.'); end if;
 if cmd='rotate_board' then
  update private.games set display_token=gen_random_uuid() where event_id=eid and exists(select 1 from public.events where id=eid and owner_id=uid);
  if not found then return jsonb_build_object('error','Only this game''s host can do that.'); end if;
  result:=jsonb_build_object('id',eid);
  insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,'{}');
 else
  begin result:=private.game_command(cmd,eid,args);
  exception
   when raise_exception then return jsonb_build_object('error',sqlerrm);
   when unique_violation then return jsonb_build_object('error','That outcome has already been recorded. Refresh the game.');
   when data_exception or integrity_constraint_violation then return jsonb_build_object('error','Check the submitted values and try again.');
  end;
 end if;
 -- PINs never enter command arguments or the audit log.
 insert into private.receipts(account_id,request_id,command,event_id,arguments,result) values(uid,rid,cmd,eid,args,result);
 return result;
end $$;
revoke all on function private.command(text,uuid,jsonb) from public,anon;
grant execute on function private.command(text,uuid,jsonb) to authenticated;

-- Public wrappers resolve to the new implementations, not the renamed originals.
create or replace function public.tno_login(display_name text,pin text,register boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.login(display_name,pin,register); $$;
create or replace function public.tno_command(cmd text,eid uuid default null,args jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.command(cmd,eid,args); $$;
revoke all on function public.tno_login(text,text,boolean),public.tno_command(text,uuid,jsonb) from public,anon;
grant execute on function public.tno_login(text,text,boolean),public.tno_command(text,uuid,jsonb) to authenticated;

-- Maintain deny-by-default for future objects created by this SQL Editor role.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from anon,authenticated;
revoke all on all tables in schema private from anon,authenticated;
revoke all on public.events,public.event_groups,public.players,public.player_secrets from anon,authenticated;
create or replace function public.tno_connection_check() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('app','trust-no-one','schema_version',3); $$;
notify pgrst,'reload schema';
