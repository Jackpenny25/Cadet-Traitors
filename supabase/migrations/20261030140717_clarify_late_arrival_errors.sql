-- Keep the existing host authorization and admission rules, but identify the
-- failed rule before trying to insert a player. Installing this changes no rows.
do $$
declare definition text; old_guard text;
begin
 definition:=pg_get_functiondef('private.game_command_v4(text,uuid,jsonb)'::regprocedure);
 old_guard:=$old$if not ishost or (select ended from private.games where event_id=eid) or coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Only the host can approve a logged late arrival.'; end if;$old$;
 if position(old_guard in definition)=0 then raise exception 'Expected late-arrival authorization guard is missing.'; end if;
 definition:=replace(definition,old_guard,$new$
  if not ishost then raise exception 'Only the main host can approve a late arrival. Ask the host to open Players and use Late arrival approval.'; end if;
  if (select ended from private.games where event_id=eid) then raise exception 'This event has finished. Open Event home and create a separate rehearsal instead of adding players to completed results.'; end if;
  if coalesce(length(trim(args->>'reason')),0) not between 1 and 200 then raise exception 'Enter a reason between 1 and 200 characters for admitting this late player, then approve the arrival again.'; end if;
 $new$);
 old_guard:=$old$if pid is null or gs.group_id is null or gs.done or exists(select 1 from public.players where event_id=eid and user_id=pid) or exists(select 1 from private.staff where event_id=eid and account_id=pid) or pid=ev.owner_id or (select count(*) from public.players where group_id=gid)>=gs.capacity then raise exception 'Check the registered account, group space and existing roster.'; end if;$old$;
 if position(old_guard in definition)=0 then raise exception 'Expected late-arrival eligibility guard is missing.'; end if;
 definition:=replace(definition,old_guard,$new$
  if pid is null then raise exception 'No registered account matches that name. Ask the cadet to choose Create account on the sign-in page first, then enter the exact name they registered.'; end if;
  if gs.group_id is null then raise exception 'Choose a group belonging to this event, then approve the late arrival again.'; end if;
  if exists(select 1 from public.players where event_id=eid and user_id=pid) then
   raise exception 'This account already has a player in this event. Ask them to sign in and open their existing dashboard from Event home; do not add them again.';
  end if;
  if exists(select 1 from private.staff where event_id=eid and account_id=pid) then
   raise exception 'This account is assigned as an NCO in this event. Use a separate cadet account, or remove its NCO assignments in Setup before admitting it as a player.';
  end if;
  if pid=ev.owner_id then raise exception 'The host account cannot also be a player in its own event. Use a separate cadet test account.'; end if;
  if gs.done then raise exception '% has completed deduction. Choose a group that is still playing; completed group results cannot accept a late arrival.',(select name from public.event_groups where id=gid); end if;
  if (select count(*) from public.players where group_id=gid)>=gs.capacity then
   raise exception '% is full (% players). Choose another group with space before approving this late arrival.',(select name from public.event_groups where id=gid),gs.capacity;
  end if;
 $new$);
 execute definition;
end $$;
