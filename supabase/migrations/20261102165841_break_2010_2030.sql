-- Public defaults only. No register, quiz answers, private tasks or marking keys.
create or replace function private.mission_plan_cards() returns jsonb language sql immutable set search_path='' as $$
 select '[{"idx":0,"title":"The Locked Archive","minutes":20,"max_points":100,"instructions":"Work in three teams to decode Signals, Plotting and Registry evidence. Combine your digits in that order and explain your reasoning to your flight NCO. The NCO checks the existing code and authorises opening your sealed ARCHIVE envelope to recover its access slip. There is one ARCHIVE envelope per flight. Your NCO retains CASE RAVEN until the Evidence Room begins. Keep clues within your flight. Phones away unless an NCO asks otherwise.","equipment":"Four sealed ARCHIVE envelopes with one access slip each; three printed clue lanes per flight, response sheets and pens. Staff retain CASE RAVEN and FINAL REVIEW papers until their stages. Envelopes for those papers are optional; wax-style seals are optional decoration."},{"idx":1,"title":"The Evidence Room: Case investigation","minutes":20,"max_points":125,"instructions":"A fictional classified file called RAVEN has been stolen. Compare the witness statement, badge register, door log, clock notice and storage records. Identify the suspect, theft time, exact hiding place, false claim and the evidence chain. Submit one flight response. These fictional characters have no connection to players\u2019 secret roles.","equipment":"Printed case packs, response sheet and pens. Keep final-review evidence sealed until the later activity."},{"idx":2,"title":"The Evidence Room: Final Review","minutes":12,"max_points":100,"instructions":"Reopen the same case. Compare the new evidence with the original file. Decide which new report is false, explain why and identify who submitted it. State whether your original conclusion changes. Submit one final flight response.","equipment":"Retained case papers, sealed final-review pack, response sheet and pens."}]'::jsonb;
$$;
create or replace function private.mission_plan_timetable() returns jsonb language sql immutable set search_path='' as $$
 select '[{"id":"briefing","time":"19:00","minutes":10,"label":"Welcome and joining","action":"activity","mission":null,"slot":null},{"id":"roles","time":"19:10","minutes":5,"label":"Joining checks and role release","action":"release_roles","mission":null,"slot":null},{"id":"archive","time":"19:15","minutes":20,"label":"The Locked Archive","action":"mission","mission":0,"slot":null},{"id":"round1","time":"19:35","minutes":10,"label":"Round table 1","action":"discussion","mission":null,"slot":null},{"id":"murder1","time":"19:45","minutes":2,"label":"First murder: two-minute phone activity","action":"open_murder","mission":null,"slot":0},{"id":"first-results","time":"19:47","minutes":3,"label":"Publish shield winners, then first murders; click to present","action":"activity","mission":null,"slot":null},{"id":"vault","time":"19:50","minutes":20,"label":"The Evidence Room: Case investigation","action":"mission","mission":1,"slot":null},{"id":"task-send","time":"20:09","minutes":1,"label":"Send private Murder in Plain Sight tasks","action":"activity","mission":null,"slot":null},{"id":"break","time":"20:10","minutes":20,"label":"Break and Murder in Plain Sight attempts","action":"activity","mission":null,"slot":null},{"id":"task-close","time":"20:28","minutes":2,"label":"Close submissions and private review during break","action":"activity","mission":null,"slot":null},{"id":"round2","time":"20:30","minutes":10,"label":"Round table 2","action":"discussion","mission":null,"slot":null},{"id":"task-reveal","time":"20:40","minutes":3,"label":"Staged second murder reveals after round table 2","action":"activity","mission":null,"slot":null},{"id":"transmission","time":"20:43","minutes":12,"label":"The Evidence Room: Final Review","action":"mission","mission":2,"slot":null},{"id":"round3","time":"20:55","minutes":10,"label":"Final round table","action":"discussion","mission":null,"slot":null},{"id":"results","time":"21:05","minutes":5,"label":"Final reveals and awards","action":"finish","mission":null,"slot":null},{"id":"clearup","time":"21:10","minutes":5,"label":"Clear up and form up","action":"activity","mission":null,"slot":null},{"id":"parade","time":"21:15","minutes":15,"label":"Parade","action":"activity","mission":null,"slot":null}]'::jsonb;
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
