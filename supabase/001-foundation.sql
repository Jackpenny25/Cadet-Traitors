-- Run once in your dedicated project's SQL Editor.
-- Foundation only: joining, voting and host commands need server functions next.
begin;

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

commit;
