-- Second-murder publication is retained by FS Penny even when a flight NCO
-- can publish their flight's quiz and first-murder outcomes.
do $$declare def text:=pg_get_functiondef('private.game_command(text,uuid,jsonb)'::regprocedure);
begin
 if position('Only FS Penny may reveal the standard second murder' in def)=0 then
  def:=replace(def,' if normal_second then',
   ' if cmd=''publish'' and owner is distinct from uid and exists(select 1 from private.reveals r join private.murder_windows w on w.id=r.opportunity where r.id=(args->>''reveal'')::uuid and w.event_id=eid and w.slot=1 and w.mode=''standard'') then raise exception ''Only FS Penny may reveal the standard second murder. Its result remains private.'';end if;'||E'\n'||' if normal_second then');
 end if;
 if position('Only FS Penny may reveal the standard second murder' in def)=0 then raise exception 'Could not safely restrict standard second-murder publication.';end if;
 execute def;
end $$;
