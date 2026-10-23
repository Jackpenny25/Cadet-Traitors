-- Harden the existing, host-only engine. Preserve every event and role record.
do $$
declare definition text; confirmation text:='if args->>''confirm''<>ev.title then'; release_check text;
begin
 definition:=replace(pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 if position(confirmation in definition)=0 then raise exception 'Expected event deletion guard was not found.'; end if;
 definition:=replace(definition,confirmation,'if args->>''confirm'' is distinct from ev.title then');
 release_check:=$guard$for gs in select * from private.group_state where event_id=eid loop
    if (select count(*) from public.players p join public.player_secrets s$guard$;
 if position(release_check in definition)=0 then raise exception 'Expected role release guard was not found.'; end if;
 definition:=replace(definition,release_check,$guard$for gs in select * from private.group_state where event_id=eid loop
    if (select count(*) from public.players where group_id=gs.group_id and status='Active')<=gs.traitors then raise exception 'Each group needs more active players than Traitors before roles can be released.'; end if;
    if (select count(*) from public.players p join public.player_secrets s$guard$);
 definition:=replace(definition,$name$textval:='Player '||lpad(number::text,2,'0');$name$,$name$textval:=(select name from private.accounts where id=uid);$name$);
 definition:=replace(definition,$name$values(eid,gid,pid,'Player '||lpad(number::text,2,'0'),number)$name$,$name$values(eid,gid,pid,(select name from private.accounts where id=pid),number)$name$);
 execute definition;
end $$;

-- Replace generated placeholders while preserving deliberately approved callsigns.
update public.players p set display_name=a.name from private.accounts a
 where p.user_id=a.id and p.display_name='Player '||lpad(p.player_number::text,2,'0');

-- Rehearsal actors have no Auth account, PIN, session or ability to sign in.
alter table public.players add column is_rehearsal_test boolean not null default false;
alter table public.players alter column user_id drop not null;
alter table public.players add constraint players_identity_kind check(
 (is_rehearsal_test and user_id is null) or (not is_rehearsal_test and user_id is not null)
);

do $$ begin execute replace(pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure),'private.game_command(','private.game_command_with_schedule('); end $$;
create or replace function private.game_command(cmd text,eid uuid,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account();ev public.events;cfg private.event_settings;gid uuid;pid uuid;number int;requested int;room int;added int:=0;votes int:=0;label text;result jsonb;g record;p record;b private.ballots_v2;target_id uuid;
begin
 if cmd not in ('add_test_players','test_votes') then return private.game_command_with_schedule(cmd,eid,args); end if;
 if uid is null then raise exception 'Sign in with your name and PIN first.'; end if;
 select * into ev from public.events where id=eid for update;
 select * into cfg from private.event_settings where event_id=eid;
 if ev.id is null or ev.owner_id<>uid or not cfg.practice then raise exception 'Only the main host can use test players in a separate rehearsal.'; end if;
 if (select ended from private.games where event_id=eid) then raise exception 'This rehearsal has ended.'; end if;
 if cmd='add_test_players' then
  if cfg.roles_released or exists(select 1 from public.players p join public.player_secrets r on r.player_id=p.id where p.event_id=eid) then raise exception 'Reset unreleased roles before adding test players. Released roles cannot be changed.'; end if;
  select sum(greatest(0,s.capacity-(select count(*) from public.players p where p.group_id=s.group_id))) into room from private.group_state s where s.event_id=eid;
  if coalesce((args->>'minimum')::boolean,false) then
   select sum(greatest(0,s.traitors+1-(select count(*) from public.players p where p.group_id=s.group_id and p.status='Active'))) into requested from private.group_state s where s.event_id=eid;
  elsif args ? 'target_total' then
   if (args->>'target_total')::int not between 1 and 100 then raise exception 'Choose a rehearsal total from 1 to 100.'; end if;
   requested:=(args->>'target_total')::int-(select count(*) from public.players where event_id=eid);
  else requested:=coalesce((args->>'count')::int,1); end if;
  if requested is null or requested not between 1 and 100 then raise exception 'The rehearsal already has enough players for that target, or the requested count is invalid.'; end if;
  if requested>room then raise exception 'There is not enough space in the four groups for that many test players.'; end if;
  label:=trim(coalesce(args->>'name',''));
  if length(label)>30 or (label<>'' and requested<>1) then raise exception 'Use a name of up to 30 characters for one test player, or leave it blank for a batch.'; end if;
  for i in 1..requested loop
   select s.group_id into gid from private.group_state s left join public.players p on p.group_id=s.group_id where s.event_id=eid
    group by s.group_id,s.capacity having count(p.id)<s.capacity order by count(p.id) filter(where p.status='Active'),count(p.id),s.group_id limit 1;
   if gid is null then raise exception 'The rehearsal is full.'; end if;
   select coalesce(max(player_number),0)+1 into number from public.players where event_id=eid;
   insert into public.players(event_id,group_id,user_id,display_name,player_number,is_rehearsal_test)
    values(eid,gid,null,case when label<>'' then label else 'Test Cadet '||lpad(number::text,2,'0') end,number,true);
   added:=added+1;
  end loop;
 else
  for g in select s.* from private.group_state s where s.event_id=eid and (not(args ? 'group') or s.group_id=(args->>'group')::uuid) order by s.group_id loop
   select * into b from private.ballots_v2 where id=g.ballot;
   if b.status is distinct from 'open' then continue; end if;
   if (args->'expected_ballots'->>g.group_id::text)::uuid is distinct from b.id then raise exception 'This ballot has changed. Refresh the rehearsal before generating test votes.'; end if;
   for p in select * from public.players where event_id=eid and group_id=g.group_id and status='Active' and is_rehearsal_test order by player_number loop
    select x.id into target_id from public.players x where x.event_id=eid and x.group_id=g.group_id and x.status='Active' and x.id<>p.id
     and (b.candidates is null or x.id=any(b.candidates)) order by x.player_number limit 1;
    if target_id is null then continue; end if;
    perform private.game_command_with_schedule('proxy_vote',eid,jsonb_build_object('group',g.group_id,'ballot',b.id,'voter',p.id,'target',target_id,'reason','Host-generated rehearsal test vote'));
    votes:=votes+1;
   end loop;
  end loop;
  if votes=0 then raise exception 'Open voting for a group with active test players first. Real players must submit their own votes.'; end if;
 end if;
 insert into private.audit(event_id,actor,action,details) values(eid,uid,cmd,jsonb_build_object('test_players_added',added,'test_votes',votes));
 return jsonb_build_object('id',eid,'test_players_added',added,'test_votes',votes);
end $$;
revoke all on function private.game_command_with_schedule(text,uuid,jsonb) from public,anon,authenticated;

do $$ begin execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),'private.snapshot(','private.snapshot_with_schedule('); end $$;
create or replace function private.snapshot(eid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.snapshot_with_schedule(eid);
 if eid is not null and (result->>'host')::boolean then
  result:=jsonb_set(result,'{players}',coalesce((select jsonb_agg(value||jsonb_build_object('test_player',coalesce((select is_rehearsal_test from public.players where id=(value->>'id')::uuid),false))) from jsonb_array_elements(result->'players')),'[]'::jsonb));
 end if;
 return result;
end $$;
revoke all on function private.snapshot_with_schedule(uuid) from public,anon,authenticated;

-- A rehearsal actor has no PIN to recover; real-player recovery stays unchanged.
do $$ declare definition text; marker text:=$guard$if p.id is null or not private.can_control(eid,p.group_id,'recover') then raise exception 'Not permitted to recover this player.'; end if;$guard$; begin
 definition:=replace(pg_get_functiondef('private.recover_player(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n');
 if position(marker in definition)=0 then raise exception 'Expected player recovery guard was not found.'; end if;
 definition:=replace(definition,marker,marker||E'\n if p.is_rehearsal_test then raise exception ''Test players have no login or PIN. Use their rehearsal controls instead.''; end if;');
 execute definition;
end $$;
notify pgrst,'reload schema';
