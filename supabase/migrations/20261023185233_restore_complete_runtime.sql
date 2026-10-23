-- Restore ALL canonical runtime functions after older setup definitions were reinstalled.
-- Includes dashboard snapshots, projector reads, protected commands and authentication.
-- No records, account credentials or event configuration are changed.
do $$ begin
 if to_regclass('private.live_event') is null or to_regclass('private.receipts') is null
  or to_regprocedure('private.legacy_game_command(text,uuid,jsonb)') is null
  or not exists(select 1 from information_schema.columns where table_schema='private' and table_name='sessions' and column_name='auth_session')
 then raise exception 'Install the security and single-event runtime migrations before this repair.'; end if;
end $$;

create or replace function private.current_account() returns uuid language sql stable security definer set search_path='' as $$
 select s.account_id from private.sessions s
 join auth.sessions a on a.id=s.auth_session and a.user_id=s.auth_user
 where s.auth_user=auth.uid() and s.expires_at>now()
 and s.auth_session=(auth.jwt()->>'session_id')::uuid;
$$;

create or replace function private.login(display_name text,pin text,register boolean default false) returns jsonb
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

create or replace function private.logout() returns void language sql security definer set search_path='' as $$
 delete from private.sessions where auth_user=auth.uid();
$$;

create or replace function private.command(cmd text,eid uuid,args jsonb) returns jsonb
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

create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_account(); ev public.events; cfg private.event_settings; me public.players;
 host boolean; organiser boolean; ended boolean; myrole text; visible_groups uuid[]; all_groups uuid[];
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if eid is null then return jsonb_build_object('name',(select name from private.accounts where id=uid),
  'can_host',exists(select 1 from private.hosts where user_id=uid),
  'live',(select jsonb_build_object('id',e.id,'title',e.title,'joining',e.joining_open,'ended',g.ended,'joined',exists(select 1 from public.players where event_id=e.id and user_id=uid),'organiser',e.owner_id=uid or exists(select 1 from private.staff where event_id=e.id and account_id=uid)) from private.live_event l join public.events e on e.id=l.event_id join private.games g on g.event_id=e.id),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'practice',c.practice,'host',e.owner_id=uid)) from public.events e join private.event_settings c on c.event_id=e.id where e.owner_id=uid or exists(select 1 from private.staff where event_id=e.id and account_id=uid) or (c.practice and exists(select 1 from public.players where event_id=e.id and user_id=uid))),'[]'::jsonb)); end if;
 select * into ev from public.events where id=eid;
 if ev.id is null then raise exception 'Event not found.'; end if;
 host:=ev.owner_id=uid;
 select * into cfg from private.event_settings where event_id=eid;
 select * into me from public.players where event_id=eid and user_id=uid;
 organiser:=host or exists(select 1 from private.staff where event_id=eid and account_id=uid);
 if me.id is null and not organiser then raise exception 'You are not a member of this event.'; end if;
 select g.ended into ended from private.games g where event_id=eid;
 select role into myrole from public.player_secrets where player_id=me.id and cfg.roles_released;
 select array_agg(group_id) into all_groups from private.group_state where event_id=eid;
 select array_agg(group_id) into visible_groups from private.group_state where event_id=eid and (host or group_id=me.group_id or private.can_control(eid,group_id,'read'));
 if me.id is not null then insert into private.presence(player_id) values(me.id) on conflict(player_id) do update set seen_at=now(); end if;
 return jsonb_build_object('id',eid,'title',ev.title,'host',host,'organiser',organiser,'practice',cfg.practice,'ended',ended,
 'server_now',now(),'joining',ev.joining_open,'date',cfg.event_date,'roles_released',cfg.roles_released,
 'is_live',exists(select 1 from private.live_event where event_id=eid),'display_token',case when host then (select display_token from private.games where event_id=eid) end,
 'announcement',(select announcement from private.games where event_id=eid),'chat_enabled',cfg.chat,'shields_enabled',cfg.shields,'plain_slot',case when organiser then coalesce(cfg.plain_slot,-1) end,
 'nco_permissions',case when organiser then to_jsonb(cfg.nco_permissions) end,'timetable',cfg.timetable,
 'me',case when me.id is not null then jsonb_build_object('id',me.id,'number',me.player_number,'name',me.display_name,'group',me.group_id,'status',me.status,'role',myrole,
 'vote',(select target from private.votes_v2 where ballot_id=(select ballot from private.group_state where group_id=me.group_id) and voter=me.id),
 'proposal',(select target from private.proposals_v2 where window_id=(select opportunity from private.group_state where group_id=me.group_id) and actor=me.id),
 'help_open',exists(select 1 from private.help_requests where player_id=me.id and completed_at is null),
 'shields',coalesce((select jsonb_agg(slot) from private.shields where player_id=me.id and not consumed),'[]'::jsonb)) end,
 'groups',(select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'score',g.score,'phase',s.phase,'mission',s.mission,'banishments',s.banishments,'done',s.done,'winner',case when ended then s.winner end,
 'deadline',s.deadline,'paused',s.paused,'remaining',s.remaining,'planning',s.planning_until>now(),
 'capacity',case when organiser then s.capacity end,'traitors',case when organiser then s.traitors end,
 'active',(select count(*) from public.players where group_id=g.id and status='Active'),
 'votes_received',case when organiser then (select count(*) from private.votes_v2 where ballot_id=s.ballot) end,
 'eligible',case when organiser then (select count(*) from public.players where group_id=g.id and status='Active') end,
 'ballot',case when private.can_control(eid,g.id,'read') then (select to_jsonb(b) from private.ballots_v2 b where b.id=s.ballot) else (select jsonb_build_object('id',id,'status',status,'candidates',candidates) from private.ballots_v2 where id=s.ballot) end
 )) from public.event_groups g join private.group_state s on s.group_id=g.id where g.event_id=eid and (not organiser or g.id=any(visible_groups))),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.player_number,'name',p.display_name,'group',p.group_id,'status',p.status,'account_name',case when private.can_control(eid,p.group_id,'read') then (select name from private.accounts where id=p.user_id) end,
 'seen_at',case when private.can_control(eid,p.group_id,'read') then (select seen_at from private.presence where player_id=p.id) end,
 'role',case when ended or private.can_control(eid,p.group_id,'read') or (cfg.roles_released and me.status='Active' and myrole='Traitor' and p.group_id=me.group_id and p.status='Active' and r.role='Traitor') or exists(select 1 from private.reveals where target=p.id and published and role_revealed) then r.role end)) from public.players p left join public.player_secrets r on r.player_id=p.id where p.event_id=eid and (not organiser or p.group_id=any(visible_groups))),'[]'::jsonb),
 'missions',(select jsonb_agg(jsonb_build_object('idx',m.idx,'title',m.title,'instructions',m.instructions,'equipment',case when organiser then m.equipment end,'scoring',m.scoring,'max_points',m.max_points,'minutes',m.minutes,'notes',case when organiser then m.notes end,'answer',case when organiser then m.answer end)) from private.missions m where m.event_id=eid),
 'scores',coalesce((select jsonb_agg(jsonb_build_object('group_id',s.group_id,'mission',s.mission,'points',s.points,'completed',s.completed,'reason',case when organiser then s.reason end)) from private.mission_scores s where s.event_id=eid and (not organiser or s.group_id=any(visible_groups))),'[]'::jsonb),
 'reveals',coalesce((select jsonb_agg(to_jsonb(r)) from private.reveals r where r.event_id=eid and (r.published or private.can_control(eid,r.group_id,'read'))),'[]'::jsonb),
 'windows',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'group_id',w.group_id,'slot',w.slot,'mode',w.mode,'status',w.status,'target',w.target,'objective',w.objective,'reported',w.reported,
 'deadline',w.deadline,'success',case when private.can_control(eid,w.group_id,'read') then w.success end,'reason',case when private.can_control(eid,w.group_id,'read') then w.reason end,
 'proposals',case when private.can_control(eid,w.group_id,'read') then (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from private.proposals_v2 p where p.window_id=w.id) end)) from private.murder_windows w where w.event_id=eid and (private.can_control(eid,w.group_id,'read') or (me.group_id=w.group_id and me.status='Active' and myrole='Traitor' and w.status='open'))),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(t)) from(select m.id,m.group_id,m.body,m.created_at,coalesce((select display_name from public.players where user_id=m.actor and event_id=eid),a.name) as sender from private.messages m join private.accounts a on a.id=m.actor where m.event_id=eid and (private.can_control(eid,m.group_id,'read') or (me.status='Active' and myrole='Traitor' and me.group_id=m.group_id)) order by m.id desc limit 100)t),'[]'::jsonb),
 'helps',coalesce((select jsonb_agg(to_jsonb(h)) from private.help_requests h where h.event_id=eid and private.can_control(eid,h.group_id,'read') and h.completed_at is null),'[]'::jsonb),
 'staff',case when host then coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'group',s.group_id)) from private.staff s join private.accounts a on a.id=s.account_id where s.event_id=eid),'[]'::jsonb) end,
 'audit',case when organiser then coalesce((select jsonb_agg(to_jsonb(t)) from(select action,details,created_at,(select name from private.accounts where id=a.actor) as actor from private.audit a where a.event_id=eid and (host or exists(select 1 from jsonb_array_elements_text(coalesce(a.details->'groups','[]')) x where x.value::uuid=any(visible_groups))) order by a.id desc limit 100)t),'[]'::jsonb) end);
end $$;

create or replace function public.tno_command(cmd text,eid uuid default null,args jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.command(cmd,eid,args); $$;

create or replace function public.tno_snapshot(eid uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.snapshot(eid); $$;

create or replace function private.board(token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid; ended boolean; cfg private.event_settings;
begin
 select event_id,g.ended into eid,ended from private.games g where display_token=token;
 if eid is null then raise exception 'Player board not found. Ask the host for its current link.'; end if;
 select * into cfg from private.event_settings where event_id=eid;
 return jsonb_build_object('id',eid,'title',(select title from public.events where id=eid),'server_now',now(),'ended',ended,'practice',cfg.practice,
 'joining',(select joining_open from public.events where id=eid),'announcement',(select announcement from private.games where event_id=eid),
 'groups',(select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'score',g.score,'phase',s.phase,'mission',s.mission,'deadline',s.deadline,'remaining',s.remaining,'paused',s.paused,'winner',case when ended then s.winner end)) from public.event_groups g join private.group_state s on s.group_id=g.id where g.event_id=eid),
 'missions',(select jsonb_agg(jsonb_build_object('idx',idx,'title',title,'instructions',instructions)) from private.missions where event_id=eid),
 'reveals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'group',r.group_id,'kind',r.kind,'target',r.target,'redundant',r.redundant,'role',case when r.role_revealed then (select role from public.player_secrets where player_id=r.target) end,'time',r.published_at) order by r.published_at) from private.reveals r where r.event_id=eid and r.published),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.player_number,'name',p.display_name,'group',p.group_id,'status',p.status,'role',case when ended or exists(select 1 from private.reveals r where r.target=p.id and r.published and r.role_revealed) then s.role end)) from public.players p left join public.player_secrets s on s.player_id=p.id where p.event_id=eid),'[]'::jsonb));
end $$;

create or replace function public.tno_board(token uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.board(token); $$;

create or replace function public.tno_login(display_name text,pin text,register boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.login(display_name,pin,register); $$;

create or replace function public.tno_logout() returns void language sql security invoker set search_path='' as $$ select private.logout(); $$;

create or replace function public.tno_connection_check() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('app','trust-no-one','schema_version',4); $$;

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

create or replace function private.default_timetable() returns jsonb language sql immutable set search_path='' as $$
 select '[{"time":"19:00","minutes":10,"label":"Welcome and briefing"},{"time":"19:10","minutes":5,"label":"Joining checks and role reveal"},{"time":"19:15","minutes":25,"label":"The Locked Archive"},{"time":"19:40","minutes":10,"label":"Round table 1"},{"time":"19:50","minutes":5,"label":"Murder opportunity 1 and reveal"},{"time":"19:55","minutes":20,"label":"The Vault and secret objective"},{"time":"20:15","minutes":10,"label":"Round table 2"},{"time":"20:25","minutes":10,"label":"Break and second murder reveal"},{"time":"20:35","minutes":15,"label":"The Last Transmission"},{"time":"20:50","minutes":15,"label":"Final round table"},{"time":"21:05","minutes":5,"label":"Final reveals and awards"},{"time":"21:10","minutes":5,"label":"Clear up and form up"},{"time":"21:15","minutes":15,"label":"Final parade"}]'::jsonb;
$$;

create or replace function private.seed_event(eid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.event_settings set timetable=private.default_timetable() where event_id=eid and timetable='[]';
 insert into private.missions(event_id,idx,title,instructions,equipment,max_points,minutes)
 values(eid,0,'The Locked Archive','Combine the clues provided by your NCO to open the physical box. Put your phone away until called back.','Clue cards, lock, box. Organiser must prepare and verify the puzzle.',100,25),
 (eid,1,'The Vault','Agree whether to bank your points or risk some for an additional reward. Tell your NCO your decision.','Prepared puzzle and bank/risk scoring sheet. Organiser must set and verify answers.',125,20),
 (eid,2,'The Last Transmission','Combine the fragments of the fictional message and present your solution to the NCO.','Prepared message and clue fragments. Organiser must prepare and verify the recording.',100,15)
 on conflict do nothing;
end $$;

create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 uid uuid:=private.current_account(); ev public.events; cfg private.event_settings; me public.players; p public.players;
 gs private.group_state; b private.ballots_v2; w private.murder_windows; r private.reveals;
 gid uuid; pid uuid; bid uuid; wid uuid; ids uuid[]; eligible uuid[]; targets uuid[]; target_id uuid;
 ishost boolean; number integer; countval integer; minutes integer; seconds integer; maximum integer; scoreval integer;
 item jsonb; role_name text; textval text; newphase text; deadline_at timestamptz; permission text;
begin
 if uid is null then raise exception 'Sign in with your name and PIN first.'; end if;
 if cmd='create' then
  if not exists(select 1 from private.hosts where user_id=uid) then raise exception 'Your account does not have host access.'; end if;
  perform 1 from private.live_event where singleton for update;
  if not coalesce((args->>'practice')::boolean,false) and exists(select 1 from private.live_event where event_id is not null) then raise exception 'The live event already exists. Open it instead.'; end if;
  number:=coalesce((args->>'groups')::integer,5);
  countval:=coalesce((args->>'size')::integer,10);
  maximum:=coalesce((args->>'traitors')::integer,2);
  if number not between 1 and 5 or countval not between 2 and 50 or maximum not between 1 and 5 or maximum>=countval or number*countval>100 or coalesce(length(trim(args->>'title')),0) not between 1 and 80 then raise exception 'Check group sizes, role counts and event title.'; end if;
  insert into public.events(title,owner_id,joining_open) values(trim(args->>'title'),uid,false) returning * into ev;
  insert into private.games(event_id,code,capacity,traitors) values(ev.id,upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),number*countval,maximum);
  insert into private.event_settings(event_id,event_date,practice) values(ev.id,coalesce((args->>'date')::date,current_date),coalesce((args->>'practice')::boolean,false));
  for i in 1..number loop
   insert into public.event_groups(event_id,name) values(ev.id,(array['Raven','Ember','Thorn','Ash','Vesper'])[i]) returning id into gid;
   insert into private.group_state(group_id,event_id,capacity,traitors) values(gid,ev.id,countval,maximum);
  end loop;
  perform private.seed_event(ev.id);
  if not coalesce((args->>'practice')::boolean,false) then update private.live_event set event_id=ev.id where singleton; end if;
  insert into private.audit(event_id,actor,action,details) values(ev.id,uid,cmd,jsonb_build_object('practice',coalesce((args->>'practice')::boolean,false)));
  return jsonb_build_object('id',ev.id);
 end if;
 if cmd='join' and eid is null then select event_id into eid from private.live_event where singleton; end if;
 select * into ev from public.events where id=eid for update;
 if ev.id is null then raise exception 'The organiser has not opened the event yet.'; end if;
 select * into cfg from private.event_settings where event_id=eid;
 ishost:=ev.owner_id=uid;
 select * into me from public.players where event_id=eid and user_id=uid;
 if cmd='join' then
  if not cfg.practice and not exists(select 1 from private.live_event where event_id=eid) then raise exception 'This is not the live event.'; end if;
  if ishost or exists(select 1 from private.staff where event_id=eid and account_id=uid) then raise exception 'Organisers use their dashboard rather than joining the roster.'; end if;
  if cfg.practice and (args->>'practice_event')::uuid is distinct from eid then raise exception 'Use the separate rehearsal link to join practice.'; end if;
  if me.id is not null then return jsonb_build_object('id',eid); end if;
  if not ev.joining_open or cfg.roles_released or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Joining is closed. Ask your NCO about late arrival.'; end if;
  select g.group_id into gid from private.group_state g left join public.players p on p.group_id=g.group_id where g.event_id=eid group by g.group_id,g.capacity having count(p.id)<g.capacity order by count(p.id),g.group_id limit 1;
  if gid is null then raise exception 'The event is full. Ask your NCO.'; end if;
  select coalesce(max(player_number),0)+1 into number from public.players where event_id=eid;
  textval:='Player '||lpad(number::text,2,'0');
  insert into public.players(event_id,group_id,user_id,display_name,player_number) values(eid,gid,uid,textval,number);
 elsif cmd='configure' then
  if not ishost or cfg.roles_released or exists(select 1 from public.players where event_id=eid) then raise exception 'Only the host can configure an empty event before joining.'; end if;
  if jsonb_array_length(args->'groups') not between 1 and 5 then raise exception 'Choose 1 to 5 groups.'; end if;
  number:=0;
  for item in select value from jsonb_array_elements(args->'groups') loop
   if coalesce(length(trim(item->>'name')),0) not between 1 and 30 or (item->>'size')::integer not between 2 and 50 or (item->>'traitors')::integer not between 1 and 5 or (item->>'traitors')::integer >= (item->>'size')::integer then raise exception 'Each group needs a name, space and at least one Faithful.'; end if;
   number:=number+(item->>'size')::integer;
  end loop;
  if number>100 then raise exception 'Maximum 100 players.'; end if;
  delete from public.event_groups where event_id=eid;
  for item in select value from jsonb_array_elements(args->'groups') loop
   insert into public.event_groups(event_id,name) values(eid,trim(item->>'name')) returning id into gid;
   insert into private.group_state(group_id,event_id,capacity,traitors) values(gid,eid,(item->>'size')::integer,(item->>'traitors')::integer);
  end loop;
  update private.games set capacity=number where event_id=eid;
  if coalesce(length(trim(args->>'title')),0) not between 1 and 80 then raise exception 'Enter an event title.'; end if;
  update public.events set title=trim(args->>'title') where id=eid;
  update private.event_settings set event_date=(args->>'date')::date,shields=coalesce((args->>'shields')::boolean,false),chat=coalesce((args->>'chat')::boolean,false),plain_slot=case when args ? 'plain_slot' and (args->>'plain_slot')::integer=-1 then null else coalesce((args->>'plain_slot')::integer,1) end where event_id=eid;
 elsif cmd='late_join' then
  if not ishost or (select ended from private.games where event_id=eid) or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Only the host can approve a logged late arrival.'; end if;
  select id into pid from private.accounts where name_key=lower(normalize(regexp_replace(trim(args->>'name'),'\s+',' ','g'),NFKC));
  gid:=(args->>'group')::uuid;
  select * into gs from private.group_state where group_id=gid and event_id=eid;
  if pid is null or gs.group_id is null or gs.done or exists(select 1 from public.players where event_id=eid and user_id=pid) or exists(select 1 from private.staff where event_id=eid and account_id=pid) or pid=ev.owner_id or (select count(*) from public.players where group_id=gid)>=gs.capacity then raise exception 'Check the registered account, group space and existing roster.'; end if;
  if not cfg.roles_released and exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Reset unreleased role preparation before adding a late player.'; end if;
  select coalesce(max(player_number),0)+1 into number from public.players where event_id=eid;
  insert into public.players(event_id,group_id,user_id,display_name,player_number) values(eid,gid,pid,'Player '||lpad(number::text,2,'0'),number) returning id into target_id;
  if cfg.roles_released then insert into public.player_secrets values(target_id,'Faithful'); end if;
  ids:=array[gid];
 elsif cmd='timetable' then
  if not ishost then raise exception 'Only the main host can edit the timetable.'; end if;
  if jsonb_typeof(args->'rows')<>'array' or jsonb_array_length(args->'rows') not between 3 and 20 then raise exception 'Enter 3 to 20 timetable rows.'; end if;
  textval:='';
  for item in select value from jsonb_array_elements(args->'rows') loop
   if coalesce(item->>'time','')!~ '^(19|20|21):[0-5][0-9]$' or item->>'time'<=textval or coalesce((item->>'minutes')::integer,0) not between 1 and 60 or coalesce(length(item->>'label'),0) not between 1 and 80 then raise exception 'Times must increase, with valid durations and labels.'; end if;
   textval:=item->>'time';
  end loop;
  update private.event_settings set timetable=args->'rows' where event_id=eid;
 elsif cmd='edit_mission' then
  if not ishost then raise exception 'Only the main host can edit missions.'; end if;
  if coalesce(length(args->>'title'),0) not between 1 and 80 or coalesce(length(args->>'instructions'),0) not between 1 and 1000 or coalesce((args->>'max_points')::integer,-1) not between 0 and 1000 or coalesce((args->>'minutes')::integer,0) not between 1 and 60 then raise exception 'Check mission title, instructions, duration and maximum points.'; end if;
  update private.missions set title=args->>'title',instructions=args->>'instructions',notes=coalesce(args->>'notes',''),answer=coalesce(args->>'answer',''),equipment=coalesce(args->>'equipment',''),scoring=coalesce(args->>'scoring',''),max_points=(args->>'max_points')::integer,minutes=(args->>'minutes')::integer where event_id=eid and idx=(args->>'mission')::integer;
  if not found then raise exception 'Mission not found.'; end if;
 elsif cmd='assign_staff' then
  if not ishost then raise exception 'Only the host can assign organisers.'; end if;
  select id into pid from private.accounts where name_key=lower(normalize(regexp_replace(trim(args->>'name'),'\s+',' ','g'),NFKC));
  if pid is null or pid=uid or exists(select 1 from public.players where event_id=eid and user_id=pid) then raise exception 'Choose a registered organiser account outside the player roster.'; end if;
  delete from private.staff where event_id=eid and account_id=pid;
  for gid in select value::text::uuid from jsonb_array_elements_text(args->'groups') loop
   if not exists(select 1 from public.event_groups where id=gid and event_id=eid) then raise exception 'Choose groups in this event.'; end if;
   insert into private.staff values(eid,pid,gid);
  end loop;
 elsif cmd='permissions' then
  if not ishost then raise exception 'Only the host can set NCO permissions.'; end if;
  if exists(select 1 from jsonb_array_elements_text(args->'permissions') p where p.value<>all(array['timer','score','help_done','proxy_vote','confirm_objective','recover','open_vote','close_vote','runoff','random_draw','open_murder','lock_murder','planning','publish','reveal_role','mission','discussion','shield','objective'])) then raise exception 'Invalid NCO permission.'; end if;
  update private.event_settings set nco_permissions=array(select jsonb_array_elements_text(args->'permissions')) where event_id=eid;
 elsif cmd in ('set_live','joining','prepare_roles','manual_role','reset_roles','release_roles','finish','delete','announce') then
  if not ishost then raise exception 'Only the main host can do that.'; end if;
  case cmd
  when 'set_live' then
   perform 1 from private.live_event where singleton for update;
   if cfg.practice or exists(select 1 from private.live_event where event_id is not null and event_id<>eid) then raise exception 'A live event already exists, or this is practice.'; end if;
   if exists(select 1 from private.outcomes where event_id=eid) or exists(select 1 from private.ballots where event_id=eid) then raise exception 'This earlier event has legacy decisions. Keep it for records and create a fresh live event.'; end if;
   update private.live_event set event_id=eid where singleton;
  when 'joining' then
   if cfg.roles_released or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Joining remains locked after role preparation. Reset unreleased roles first.'; end if;
   update public.events set joining_open=(args->>'open')::boolean where id=eid;
  when 'prepare_roles' then
   if cfg.roles_released or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.event_id=eid) then raise exception 'Roles are already prepared. Reset unreleased roles deliberately to change them.'; end if;
   for gs in select * from private.group_state where event_id=eid loop
    if (select count(*) from public.players where group_id=gs.group_id and status='Active')<=gs.traitors then raise exception 'Every group needs more players than Traitors.'; end if;
    insert into public.player_secrets(player_id,role) select id,case when row_number() over(order by gen_random_uuid())<=gs.traitors then 'Traitor' else 'Faithful' end from public.players where group_id=gs.group_id and status='Active';
   end loop;
   update public.events set joining_open=false where id=eid;
  when 'manual_role' then
   if cfg.roles_released then raise exception 'Released roles cannot be changed.'; end if;
   select * into p from public.players where id=(args->>'player')::uuid and event_id=eid;
   if p.id is null or args->>'role' not in ('Faithful','Traitor') then raise exception 'Choose a player and role.'; end if;
   if exists(select 1 from public.player_secrets where player_id=p.id) then raise exception 'Reset unreleased roles before assigning a different distribution.'; end if;
   insert into public.player_secrets values(p.id,args->>'role');
   update public.events set joining_open=false where id=eid;
  when 'reset_roles' then
   if cfg.roles_released or args->>'confirm'<>'RESET UNRELEASED ROLES' then raise exception 'Only unreleased roles can be reset with confirmation.'; end if;
   delete from public.player_secrets where player_id in(select id from public.players where event_id=eid);
  when 'release_roles' then
   if cfg.roles_released then raise exception 'Roles have already been released.'; end if;
   for gs in select * from private.group_state where event_id=eid loop
    if (select count(*) from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=gs.group_id and s.role='Traitor')<>gs.traitors or exists(select 1 from public.players p left join public.player_secrets s on s.player_id=p.id where p.group_id=gs.group_id and s.player_id is null) then raise exception 'Check every group has all roles and the configured number of Traitors.'; end if;
   end loop;
   update private.event_settings set roles_released=true where event_id=eid;
   update public.events set joining_open=false where id=eid;
   update private.group_state set phase='Roles',remaining=300 where event_id=eid;
  when 'finish' then
   if not cfg.roles_released or exists(select 1 from private.reveals where event_id=eid and not published) or exists(select 1 from private.ballots_v2 where event_id=eid and status in ('open','tie')) or exists(select 1 from private.murder_windows where event_id=eid and status='open') then raise exception 'Close ballots, resolve murder opportunities and publish pending outcomes before final results.'; end if;
   if exists(select 1 from private.group_state where event_id=eid and not done and banishments<3) then raise exception 'Complete three banishments or an early deduction victory in every group before final results.'; end if;
   update private.games set ended=true where event_id=eid;
   update private.group_state s set phase='Results',paused=true,deadline=null,done=true,winner=case when exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.group_id=s.group_id and p.status='Active' and r.role='Traitor') then 'Traitors' else 'Faithful' end where s.event_id=eid;
  when 'delete' then
   if args->>'confirm'<>ev.title then raise exception 'Type the event title to confirm deletion.'; end if;
   delete from private.receipts where event_id=eid;
   delete from private.votes_v2 where ballot_id in(select id from private.ballots_v2 where event_id=eid);
   delete from private.proposals_v2 where window_id in(select id from private.murder_windows where event_id=eid);
   delete from private.reveals where event_id=eid;
   delete from private.ballots_v2 where event_id=eid;
   delete from private.murder_windows where event_id=eid;
   delete from private.ballots where event_id=eid;
   delete from private.outcomes where event_id=eid;
   delete from private.proposals where event_id=eid;
   delete from public.events where id=eid;
   return jsonb_build_object('id',null);
  when 'announce' then
   if length(args->>'text')>1000 then raise exception 'Maximum 1000 characters.'; end if;
   update private.games set announcement=coalesce(args->>'text','') where event_id=eid;
  end case;
 else
  -- Player actions derive the actor/group from their verified account, never supplied IDs.
  if cmd in ('vote','propose','message','report_objective','help') then
   if me.id is null then raise exception 'Join the event first.'; end if;
   ids:=array[me.group_id];
  elsif args ? 'group' then ids:=array[(args->>'group')::uuid];
  elsif ishost then select array_agg(group_id order by group_id) into ids from private.group_state where event_id=eid;
  else select array_agg(group_id order by group_id) into ids from private.staff where event_id=eid and account_id=uid;
  end if;
  if ids is null then raise exception 'No authorised groups selected.'; end if;
  for gid in select unnest(ids) order by 1 loop
   select * into gs from private.group_state where group_id=gid and event_id=eid for update;
   if gs.group_id is null then raise exception 'Group not found in this event.'; end if;
   permission:=case when cmd in ('pause','resume','extend') then 'timer' when cmd='organiser_message' then 'objective' else cmd end;
   if cmd not in ('vote','propose','message','report_objective','help') and not private.can_control(eid,gid,permission) then raise exception 'You are not permitted to control this group or action.'; end if;
   select * into b from private.ballots_v2 where id=gs.ballot;
   select * into w from private.murder_windows where id=gs.opportunity;
   if cmd in ('close_vote','runoff','random_draw','skip_ballot','reopen_ballot') and (args->'expected_ballots'->>gid::text)::uuid is distinct from gs.ballot then raise exception 'This ballot has changed. Refresh the group before acting.'; end if;
   if cmd not in ('score','help','help_done','withdraw','callsign') and (select ended from private.games where event_id=eid) then raise exception 'The event has ended.'; end if;
   case cmd
   when 'help' then
    if not exists(select 1 from private.help_requests where player_id=me.id and created_at>now()-interval '30 seconds') then
     insert into private.help_requests(event_id,player_id,group_id) values(eid,me.id,gid) on conflict(player_id) where completed_at is null do nothing;
    end if;
   when 'help_done' then update private.help_requests set completed_at=now() where id=(args->>'help')::uuid and group_id=gid and event_id=eid and completed_at is null;
   when 'organiser_message' then
    textval:=trim(args->>'text');
    if coalesce(length(textval),0) not between 1 and 240 then raise exception 'Messages must be 1 to 240 characters.'; end if;
    if exists(select 1 from private.messages where actor=uid and created_at>now()-interval '3 seconds') then raise exception 'Wait a few seconds before sending another message.'; end if;
    insert into private.messages(event_id,group_id,actor,body) values(eid,gid,uid,textval);
   when 'pause' then
    if gs.paused then raise exception 'This group is already paused.'; end if;
    update private.group_state set remaining=greatest(0,ceil(extract(epoch from(deadline-now())))::integer),paused=true,deadline=null where group_id=gid;
    update private.murder_windows set deadline=null where group_id=gid and status='open';
   when 'resume' then
    if not gs.paused then raise exception 'This timer is already running.'; end if;
    update private.group_state set paused=false,deadline=now()+make_interval(secs=>remaining) where group_id=gid;
    update private.murder_windows set deadline=now()+make_interval(secs=>gs.remaining) where group_id=gid and status='open';
   when 'extend' then
    seconds:=coalesce((args->>'seconds')::integer,60);
    if seconds not between 30 and 600 then raise exception 'Extend by 30 to 600 seconds.'; end if;
    update private.group_state set remaining=remaining+seconds,deadline=case when paused then null else deadline+make_interval(secs=>seconds) end where group_id=gid;
    update private.murder_windows set deadline=case when gs.paused then null else deadline+make_interval(secs=>seconds) end where group_id=gid and status='open';
   when 'mission' then
    number:=(args->>'mission')::integer;
    if not cfg.roles_released or number not between 0 and 2 or (gs.phase='Mission' and gs.mission=number) or gs.phase in ('Voting','Discussion','Finale','Results') or (b.id is not null and not b.published and b.status<>'skipped') then raise exception 'Release roles and resolve the current ballot before starting a different mission.'; end if;
    if w.mode='standard' and w.status='open' then raise exception 'Lock the standard murder opportunity before leaving it.'; end if;
    if w.id is not null and w.mode='plain' and w.status='open' then perform private.resolve_murder(w.id,false,'Objective deadline passed without NCO confirmation'); end if;
    select m.minutes into minutes from private.missions m where m.event_id=eid and m.idx=number;
    update private.group_state set phase='Mission',mission=number,paused=false,remaining=minutes*60,deadline=now()+make_interval(mins=>minutes),planning_until=null where group_id=gid;
   when 'discussion' then
    if not cfg.roles_released or gs.done or gs.banishments>=3 or gs.phase not in ('Mission','Roles','Night','Planning','Closed') or (b.id is not null and not b.published and b.status<>'skipped') then raise exception 'This group cannot start another discussion yet.'; end if;
    if w.mode='standard' and w.status='open' then raise exception 'Lock the standard murder opportunity before leaving it.'; end if;
    if w.id is not null and w.mode='plain' and w.status='open' then perform private.resolve_murder(w.id,false,'Objective expired at the end of its mission'); end if;
    update private.group_state set phase='Discussion',paused=false,remaining=300,deadline=now()+interval '5 minutes',planning_until=null where group_id=gid;
   when 'open_vote' then
    if gs.phase<>'Discussion' or gs.done or gs.banishments>=3 then raise exception 'Start discussion before opening a ballot.'; end if;
    insert into private.ballots_v2(event_id,group_id,round) values(eid,gid,gs.banishments+1) returning id into bid;
    update private.group_state set phase='Voting',ballot=bid,paused=false,remaining=120,deadline=now()+interval '2 minutes' where group_id=gid;
   when 'vote','proxy_vote' then
    if (args->>'ballot')::uuid is distinct from b.id then raise exception 'This ballot has changed. Submit against its current identifier.'; end if;
    if gs.phase<>'Voting' or b.status<>'open' or gs.done or gs.paused then raise exception 'Voting is closed or paused.'; end if;
    if cmd='vote' then p:=me; else
     if coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Record a reason for a manual vote.'; end if;
     select * into p from public.players where id=(args->>'voter')::uuid and group_id=gid;
    end if;
    target_id:=(args->>'target')::uuid;
    if p.id is null or p.status<>'Active' or p.group_id<>gid or target_id=p.id or not exists(select 1 from public.players where id=target_id and group_id=gid and status='Active') or (b.candidates is not null and not target_id=any(b.candidates)) then raise exception 'Choose an eligible active player in this group, without self voting.'; end if;
    insert into private.votes_v2 values(b.id,p.id,target_id) on conflict(ballot_id,voter) do update set target=excluded.target;
   when 'close_vote' then
    if b.id is null or b.status<>'open' then raise exception 'No open ballot.'; end if;
    select coalesce(jsonb_object_agg(t.target,t.votes),'{}') into item from(select target,count(*) as votes from private.votes_v2 where ballot_id=b.id group by target)t;
    select max(value::integer) into maximum from jsonb_each_text(item);
    select coalesce(array_agg(key::uuid),'{}') into targets from jsonb_each_text(item) where value::integer=maximum;
    select coalesce(array_agg(id),'{}') into eligible from public.players p where p.group_id=gid and p.status='Active' and not exists(select 1 from private.votes_v2 where ballot_id=b.id and voter=p.id);
    update private.ballots_v2 set tally=item,tied=targets,abstentions=eligible,status=case when cardinality(targets)>1 then 'tie' when cardinality(targets)=0 then 'empty' else 'resolved' end,result=case when cardinality(targets)=1 then targets[1] end where id=b.id;
    if cardinality(targets)=1 then insert into private.reveals(event_id,group_id,kind,target,ballot) values(eid,gid,'Banished',targets[1],b.id); end if;
    update private.group_state set phase='Closed',paused=true,deadline=null where group_id=gid;
   when 'runoff' then
    if b.status<>'tie' or b.runoff then raise exception 'Only one runoff is allowed after a tied first ballot.'; end if;
    insert into private.ballots_v2(event_id,group_id,round,runoff,parent,candidates) values(eid,gid,b.round,true,b.id,b.tied) returning id into bid;
    update private.ballots_v2 set status='superseded' where id=b.id;
    update private.group_state set phase='Voting',ballot=bid,remaining=60,paused=false,deadline=now()+interval '1 minute' where group_id=gid;
   when 'random_draw' then
    if b.status<>'tie' or not b.runoff then raise exception 'A random draw requires a tied runoff and an explicit host action.'; end if;
    if not ishost then raise exception 'Only the main host can trigger a random draw.'; end if;
    select value into target_id from unnest(b.tied) value order by gen_random_uuid() limit 1;
    update private.ballots_v2 set status='resolved',result=target_id where id=b.id;
    insert into private.reveals(event_id,group_id,kind,target,ballot) values(eid,gid,'Banished',target_id,b.id);
   when 'skip_ballot','reopen_ballot' then
    if not ishost or b.status<>'empty' then raise exception 'Only the host may reopen or skip an empty ballot.'; end if;
    if cmd='reopen_ballot' then
     update private.ballots_v2 set status='open' where id=b.id;
     update private.group_state set phase='Voting',remaining=120,paused=false,deadline=now()+interval '2 minutes' where group_id=gid;
    else
     update private.ballots_v2 set status='skipped',published=true where id=b.id;
     update private.group_state set banishments=banishments+1 where group_id=gid;
     perform private.group_victory(gid);
    end if;
   when 'planning' then
    if gs.done or not cfg.roles_released or gs.phase not in ('Mission','Closed','Night','Planning') then raise exception 'Resolve the current ballot before private planning.'; end if;
    update private.group_state set planning_until=now()+interval '2 minutes',
     phase=case when phase='Closed' then 'Planning' else phase end,
     paused=case when phase='Closed' then false else paused end,
     deadline=case when phase='Closed' then now()+interval '2 minutes' else deadline end where group_id=gid;
   when 'open_murder' then
    number:=(args->>'slot')::integer;
    if exists(select 1 from private.murder_windows where group_id=gid and status='open') then raise exception 'Resolve the current murder opportunity before opening another.'; end if;
    if gs.done or not cfg.roles_released or number not in(0,1) or exists(select 1 from private.murder_windows where group_id=gid and slot=number) or (number=0 and gs.banishments<1) or (number=1 and gs.mission<>1) or gs.phase in ('Voting','Discussion') then raise exception 'Check this opportunity, phase and group eligibility.'; end if;
    if number=cfg.plain_slot and gs.phase<>'Mission' then raise exception 'Open the supervised objective during its physical mission.'; end if;
    pid:=(args->>'decider')::uuid;
    if pid is null then select p.id into pid from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=gid and p.status='Active' and s.role='Traitor' order by p.player_number limit 1; end if;
    if not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=pid and p.group_id=gid and p.status='Active' and s.role='Traitor') then raise exception 'Choose an active deciding Traitor.'; end if;
    textval:=case when number=cfg.plain_slot then 'plain' else 'standard' end;
    insert into private.murder_windows(event_id,group_id,slot,mode,decider,deadline) values(eid,gid,number,textval,pid,case when textval='plain' then coalesce(gs.deadline,now()+interval '3 minutes') else now()+interval '3 minutes' end) returning id into wid;
    update private.group_state set opportunity=wid,planning_until=now()+interval '2 minutes',phase=case when textval='standard' then 'Night' else phase end,
     paused=case when textval='standard' then false else paused end,remaining=case when textval='standard' then 180 else remaining end,
     deadline=case when textval='standard' then now()+interval '3 minutes' else deadline end where group_id=gid;
   when 'objective' then
    target_id:=(args->>'target')::uuid;
    if w.id is null or w.mode<>'plain' or w.status<>'open' or coalesce(length(trim(args->>'text')),0) not between 1 and 500 or not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=target_id and p.group_id=gid and p.status='Active' and s.role='Faithful') then raise exception 'Choose an eligible private target and objective during the second opportunity.'; end if;
    update private.murder_windows set target=target_id,objective=trim(args->>'text'),reported=false where id=w.id;
   when 'propose','report_objective','message' then
    if me.status<>'Active' or gs.done or gs.paused or not cfg.roles_released or not exists(select 1 from public.player_secrets where player_id=me.id and role='Traitor') then raise exception 'Only an active Traitor in this group can act now.'; end if;
    if cmd='message' then
     if gs.planning_until is null or gs.planning_until<now() then raise exception 'Private planning is closed.'; end if;
     textval:=trim(args->>'text');
     if not cfg.chat and textval<>all(array['I agree.','Please suggest another target.','Check the objective.','Ready when you are.']) then raise exception 'Free text chat is disabled. Use a preset message.'; end if;
     if coalesce(length(textval),0) not between 1 and 240 then raise exception 'Messages must be 1 to 240 characters.'; end if;
     if exists(select 1 from private.messages where actor=uid and created_at>now()-interval '3 seconds') then raise exception 'Wait a few seconds before sending another message.'; end if;
     insert into private.messages(event_id,group_id,actor,body) values(eid,gid,uid,textval);
    else
     if (args->>'opportunity')::uuid is distinct from w.id then raise exception 'This opportunity has changed. Refresh before submitting.'; end if;
     if w.id is null or w.status<>'open' or (w.deadline is not null and w.deadline<now()) then raise exception 'The murder opportunity is closed.'; end if;
     if cmd='report_objective' then
      if w.mode<>'plain' or w.target is null then raise exception 'Wait for your NCO to assign the objective.'; end if;
      update private.murder_windows set reported=true where id=w.id;
     else
      target_id:=(args->>'target')::uuid;
      if w.mode<>'standard' or not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=target_id and p.group_id=gid and p.status='Active' and s.role='Faithful') then raise exception 'Choose an active Faithful in your group.'; end if;
      insert into private.proposals_v2 values(w.id,me.id,target_id) on conflict(window_id,actor) do update set target=excluded.target;
     end if;
    end if;
   when 'lock_murder' then
    if (args->'expected_opportunities'->>gid::text)::uuid is distinct from w.id and (args->>'opportunity')::uuid is distinct from w.id then raise exception 'This opportunity has changed. Refresh before locking.'; end if;
    if w.id is null or w.status<>'open' or w.mode<>'standard' then raise exception 'No open standard opportunity.'; end if;
    if args ? 'target' then
     if not ishost or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'A host manual decision needs a reason.'; end if;
     target_id:=(args->>'target')::uuid;
    else
     if not exists(select 1 from public.players where id=w.decider and status='Active') then
      select p.id into pid from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=gid and p.status='Active' and s.role='Traitor' order by p.player_number limit 1;
     else pid:=w.decider; end if;
     select array_agg(distinct q.target) into targets from private.proposals_v2 q join public.players p on p.id=q.actor where q.window_id=w.id and p.status='Active';
     if cardinality(targets)=1 then target_id:=targets[1]; else select target into target_id from private.proposals_v2 where window_id=w.id and actor=pid; end if;
    end if;
    update private.murder_windows set target=target_id where id=w.id;
    perform private.resolve_murder(w.id,target_id is not null,case when target_id is null then 'No valid decision before closure' else 'Organiser locked the Traitor decision' end);
   when 'confirm_objective' then
    if (args->>'opportunity')::uuid is distinct from w.id then raise exception 'This opportunity has changed. Refresh before confirming.'; end if;
    if w.id is null or w.mode<>'plain' or w.status<>'open' then raise exception 'No open supervised objective.'; end if;
    if coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Record the physical verification or rejection reason.'; end if;
    perform private.resolve_murder(w.id,coalesce((args->>'success')::boolean,false) and (w.deadline is null or w.deadline>=now()),trim(args->>'reason'));
   when 'publish','reveal_role' then
    select * into r from private.reveals where id=(args->>'reveal')::uuid and group_id=gid and event_id=eid for update;
    if r.id is null then raise exception 'Outcome not found in this group.'; end if;
    if cmd='reveal_role' then
     if not r.published or r.kind<>'Banished' then raise exception 'Publish a banishment first.'; end if;
     update private.reveals set role_revealed=true where id=r.id;
    else
     if r.published then raise exception 'This outcome is already public.'; end if;
     select * into p from public.players where id=r.target;
     update private.reveals set published=true,published_at=now(),redundant=r.target is not null and p.status<>'Active' where id=r.id;
     if r.target is not null and p.status='Active' then update public.players set status=r.kind where id=r.target; end if;
     if r.ballot is not null then
      update private.ballots_v2 set published=true where id=r.ballot;
      update private.group_state set banishments=banishments+1 where group_id=gid;
     end if;
     if r.opportunity is not null then update private.murder_windows set status='published' where id=r.opportunity; end if;
     perform private.group_victory(gid);
    end if;
   when 'shield' then
    target_id:=(args->>'player')::uuid;number:=(args->>'slot')::integer;
    if not cfg.shields or number not in(0,1) or not exists(select 1 from public.players where id=target_id and group_id=gid and status='Active') or exists(select 1 from private.murder_windows where group_id=gid and slot=number and status<>'open') then raise exception 'Shields are disabled or this opportunity has been resolved.'; end if;
    insert into private.shields(player_id,slot,event_id) values(target_id,number,eid) on conflict do nothing;
   when 'score' then
    number:=(args->>'mission')::integer;scoreval:=(args->>'points')::integer;
    select max_points into maximum from private.missions where event_id=eid and idx=number;
    if maximum is null or scoreval is null or scoreval<0 or scoreval>maximum or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Enter valid mission points within its limit, and a reason.'; end if;
    insert into private.mission_scores(event_id,group_id,mission,points,completed,reason) values(eid,gid,number,scoreval,coalesce((args->>'completed')::boolean,false),trim(args->>'reason')) on conflict(group_id,mission) do update set points=excluded.points,completed=excluded.completed,reason=excluded.reason;
    update public.event_groups set score=(select coalesce(sum(points),0) from private.mission_scores where group_id=gid) where id=gid;
   when 'callsign','withdraw' then
    if not ishost or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Only the host can make a logged player correction.'; end if;
    select * into p from public.players where id=(args->>'player')::uuid and group_id=gid;
    if p.id is null then raise exception 'Player not found.'; end if;
    if cmd='callsign' then
     if coalesce(length(trim(args->>'name')),0) not between 1 and 30 then raise exception 'Enter a callsign of 1 to 30 characters.'; end if;
     update public.players set display_name=trim(args->>'name') where id=p.id;
    else
     if b.status='open' then raise exception 'Close the ballot before a withdrawal.'; end if;
     update public.players set status='Withdrawn' where id=p.id;
     if cfg.roles_released then perform private.group_victory(gid); end if;
    end if;
   when 'finale' then
    if not ishost or not cfg.roles_released or (not gs.done and gs.banishments<3) or exists(select 1 from private.reveals where group_id=gid and not published) or b.status in ('open','tie','empty') or w.status='open' then raise exception 'Complete the group deduction and resolve outstanding decisions before the finale.'; end if;
    update private.group_state set phase='Finale',remaining=300,paused=false,deadline=now()+interval '5 minutes' where group_id=gid;
   else raise exception 'Unknown event command.';
   end case;
  end loop;
 end if;
 -- Log group context. No PIN or session data is ever accepted by this command.
 insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,(args-'request_id')||jsonb_build_object('groups',coalesce(to_jsonb(ids),'[]')));
 return jsonb_build_object('id',eid);
end $$;

create or replace function private.can_control(eid uuid,gid uuid,command text) returns boolean language sql stable security definer set search_path='' as $$
 select private.current_account() is not null and (
 exists(select 1 from public.events where id=eid and owner_id=private.current_account()) or
 (exists(select 1 from private.staff where event_id=eid and account_id=private.current_account() and group_id=gid)
 and (command='read' or command=any(coalesce((select nco_permissions from private.event_settings where event_id=eid),'{}'::text[]))))
 );
$$;

create or replace function private.group_victory(gid uuid) returns void language plpgsql security definer set search_path='' as $$
declare alive_traitors integer; pending boolean; gs private.group_state;
begin
 select * into gs from private.group_state where group_id=gid;
 select count(*) into alive_traitors from public.players p join public.player_secrets s on s.player_id=p.id where p.group_id=gid and p.status='Active' and s.role='Traitor';
 if alive_traitors=0 then
  -- Unconfirmed attempts expire, but a confirmed pending victim is retained.
  update private.murder_windows set status='resolved',success=false,reason='No active Traitors remain' where group_id=gid and status='open';
 end if;
 select exists(select 1 from private.murder_windows where group_id=gid and status='resolved' and success=true) into pending;
 if (alive_traitors=0 or gs.banishments>=3) and not pending then
  update private.group_state set done=true,winner=case when alive_traitors=0 then 'Faithful' else 'Traitors' end where group_id=gid;
 end if;
end $$;

create or replace function private.resolve_murder(wid uuid,completed boolean,reason_text text) returns void language plpgsql security definer set search_path='' as $$
declare w private.murder_windows; eligible boolean; protected boolean; enabled boolean;
begin
 select * into w from private.murder_windows where id=wid for update;
 if w.id is null or w.status<>'open' then raise exception 'This opportunity is already locked.'; end if;
 select exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=w.target and p.group_id=w.group_id and p.status='Active' and s.role='Faithful') into eligible;
 select shields into enabled from private.event_settings where event_id=w.event_id;
 select enabled and exists(select 1 from private.shields where player_id=w.target and slot=w.slot and not consumed) into protected;
 update private.shields set consumed=true where player_id=w.target and slot=w.slot and not consumed;
 update private.murder_windows set status='resolved',success=completed and eligible and not protected,
 reason=case when protected and completed then 'Shield blocked this attempt' when completed and not eligible then 'Target no longer eligible' else reason_text end where id=wid;
 insert into private.reveals(event_id,group_id,kind,target,opportunity) values(w.event_id,w.group_id,'Murdered',case when completed and eligible and not protected then w.target end,w.id);
end $$;

create or replace function private.recovery_export(eid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.current_account() is null or not exists(select 1 from public.events where id=eid and owner_id=private.current_account()) then raise exception 'Only the main host may export recovery data.'; end if;
 insert into private.audit(event_id,actor,action,details) values(eid,private.current_account(),'export','{}');
 return jsonb_build_object('warning','PRIVATE organiser recovery record. Contains hidden roles, votes and pending outcomes. Keep off the projector.','exported_at',now(),
 'event',(select jsonb_build_object('title',title,'joining_open',joining_open) from public.events where id=eid),'settings',(select to_jsonb(c) from private.event_settings c where event_id=eid),
 'groups',(select jsonb_agg(to_jsonb(g)) from public.event_groups g where event_id=eid),'states',(select jsonb_agg(to_jsonb(s)) from private.group_state s where event_id=eid),
 'players',(select jsonb_agg(jsonb_build_object('id',p.id,'number',p.player_number,'name',p.display_name,'group',p.group_id,'status',p.status,'role',s.role)) from public.players p left join public.player_secrets s on s.player_id=p.id where p.event_id=eid),
 'missions',(select jsonb_agg(to_jsonb(m)) from private.missions m where event_id=eid),'ballots',(select jsonb_agg(to_jsonb(b)) from private.ballots_v2 b where event_id=eid),
 'votes',(select jsonb_agg(to_jsonb(v)) from private.votes_v2 v join private.ballots_v2 b on b.id=v.ballot_id where b.event_id=eid),
 'murder_windows',(select jsonb_agg(to_jsonb(w)) from private.murder_windows w where event_id=eid),'reveals',(select jsonb_agg(to_jsonb(r)) from private.reveals r where event_id=eid),
 'scores',(select jsonb_agg(to_jsonb(s)) from private.mission_scores s where event_id=eid),'legacy_outcomes',(select jsonb_agg(to_jsonb(o)) from private.outcomes o where event_id=eid),'legacy_ballots',(select jsonb_agg(to_jsonb(b)) from private.ballots b where event_id=eid),'audit',(select jsonb_agg(to_jsonb(a)) from private.audit a where event_id=eid));
end $$;

create or replace function private.recover_player(eid uuid,pid uuid,new_pin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.players; uid uuid:=private.current_account();
begin
 select * into p from public.players where id=pid and event_id=eid;
 if p.id is null or not private.can_control(eid,p.group_id,'recover') then raise exception 'Not permitted to recover this player.'; end if;
 if new_pin is null or new_pin!~ '^[0-9]{4}$' then raise exception 'Enter a four-digit replacement PIN.'; end if;
 if exists(select 1 from private.audit where event_id=eid and actor=uid and action='recover' and created_at>now()-interval '5 seconds') then raise exception 'Wait a few seconds before another recovery.'; end if;
 update private.accounts set pin_hash=extensions.crypt(new_pin,extensions.gen_salt('bf',12)),failed=0,locked_until=null where id=p.user_id;
 delete from private.sessions where account_id=p.user_id;
 insert into private.audit(event_id,actor,action,details) values(eid,uid,'recover',jsonb_build_object('player',pid,'groups',jsonb_build_array(p.group_id)));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.tno_export(eid uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.recovery_export(eid); $$;

create or replace function public.tno_recover(eid uuid,pid uuid,new_pin text) returns jsonb language sql security invoker set search_path='' as $$ select private.recover_player(eid,pid,new_pin); $$;

-- Keep browser clients behind the fixed RPC entry points.
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on public.events,public.event_groups,public.players,public.player_secrets from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.login(text,text,boolean),private.logout(),private.command(text,uuid,jsonb),private.snapshot(uuid),private.recovery_export(uuid),private.recover_player(uuid,uuid,text) to authenticated;
grant execute on function private.board(uuid) to anon,authenticated;
revoke all on function public.tno_login(text,text,boolean),public.tno_logout(),public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid),public.tno_export(uuid),public.tno_recover(uuid,uuid,text),public.tno_board(uuid),public.tno_connection_check() from public,anon,authenticated;
grant execute on function public.tno_login(text,text,boolean),public.tno_logout(),public.tno_command(text,uuid,jsonb),public.tno_snapshot(uuid),public.tno_export(uuid),public.tno_recover(uuid,uuid,text) to authenticated;
grant execute on function public.tno_board(uuid),public.tno_connection_check() to anon,authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from anon,authenticated;
notify pgrst,'reload schema';
