-- Run ONCE after 002-connected.sql. Existing accounts and game records are preserved.
-- Existing application sessions must sign in again to bind a live Auth session.
begin;
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
commit;
