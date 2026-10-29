-- Repair the apostrophe damaged by the Windows text encoding during deployment.
-- Character codes keep this corrective migration safe across shell encodings.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.mission_plan_cards()'::regprocedure);
  execute replace(definition, chr(226) || chr(8364) || chr(8482), chr(8217));
end $$;

update private.missions
set instructions = replace(instructions, chr(226) || chr(8364) || chr(8482), chr(8217))
where position(chr(226) || chr(8364) || chr(8482) in instructions) > 0;
