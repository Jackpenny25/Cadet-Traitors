-- A batch must keep a manually locked decision while finishing other flights.
do $$
declare definition text; marker text := 'elsif cmd=''lock_murder'' then';
begin
 definition := pg_get_functiondef('private.control_check(uuid,uuid,text,jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'Expected murder control branch is missing.'; end if;
 definition := replace(definition, marker, marker || E'\n' || $branch$
  if w.status in ('resolved','published') then
   return private.control_answer(false,'murder_already_locked',
    'This decision is already locked and will be kept. Reveal any private outcome separately.',null,'{}',true);
  end if;
  if g.done and w.id is null then
   return private.control_answer(false,'deduction_complete',
    'Deduction is complete. No further murder decision is needed.',null,'{}',true);
  end if;
$branch$);
 execute definition;
end $$;
