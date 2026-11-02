-- Public defaults only. No register, quiz answers, private tasks or marking keys.
create or replace function private.mission_plan_cards() returns jsonb language sql immutable set search_path='' as $$
 select 'PUBLIC_CARDS_JSON'::jsonb;
$$;
create or replace function private.mission_plan_timetable() returns jsonb language sql immutable set search_path='' as $$
 select 'PUBLIC_TIMETABLE_JSON'::jsonb;
$$;
create or replace function private.default_timetable() returns jsonb language sql immutable set search_path='' as $$
 select private.mission_plan_timetable();
$$;
revoke all on function private.mission_plan_cards(),private.mission_plan_timetable(),private.default_timetable() from public,anon,authenticated;

-- Preserve custom rows and action mappings in the owner's future-event template.
-- Retain activity IDs; only known running-order times, lengths and labels change.
update private.host_preferences p set timetable=(
 select jsonb_agg(item order by item->>'time') from (
  select saved.value||case when planned.value is not null then jsonb_build_object('time',planned.value->'time','minutes',planned.value->'minutes','label',planned.value->'label') else '{}'::jsonb end as item
  from jsonb_array_elements(p.timetable) saved
  left join lateral (select value from jsonb_array_elements(private.mission_plan_timetable()) where value->>'id'=saved.value->>'id') planned on true
  union all
  select value from jsonb_array_elements(private.mission_plan_timetable()) proposed
  where not exists(select 1 from jsonb_array_elements(p.timetable) saved where saved.value->>'id'=proposed.value->>'id')
 ) changed
),revision=revision+1;

-- New event mission cards use the current planned lengths as well as briefings.
-- Existing events, identities, stages, scores, evidence and decisions stay intact.
do $$declare def text;oldpart text:='set title=card->>''title'',instructions=card->>''instructions'',equipment=card->>''equipment''';
begin
 def:=pg_get_functiondef('private.game_command_before_raf_quiz(text,uuid,jsonb)'::regprocedure);
 if position(oldpart in def)=0 then raise exception 'Expected new-event card setup not found. No timetable update applied.';end if;
 execute replace(def,oldpart,oldpart||',minutes=(card->>''minutes'')::int');
end $$;
notify pgrst,'reload schema';
