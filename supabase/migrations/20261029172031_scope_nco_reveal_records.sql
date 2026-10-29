-- Published outcomes from other flights do not belong in an NCO's control room.
-- Delegate authentication and all original field filtering to the existing API.
do $$ begin
 execute replace(pg_get_functiondef('private.snapshot(uuid)'::regprocedure),
  'private.snapshot(', 'private.snapshot_before_nco_scope(');
end $$;

create or replace function private.snapshot(eid uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; records jsonb;
begin
 result := private.snapshot_before_nco_scope(eid);
 if eid is null or (result->>'host')::boolean then return result; end if;
 select coalesce(jsonb_agg(r.value), '[]'::jsonb) into records
 from jsonb_array_elements(result->'reveals') r
 where exists(select 1 from jsonb_array_elements(result->'groups') g
  where g.value->>'id'=r.value->>'group_id');
 result := jsonb_set(result, '{reveals}', records);
 if (result->>'organiser')::boolean then
  select coalesce(jsonb_agg(p.value || jsonb_build_object('test_player',
   coalesce((select is_rehearsal_test from public.players where id=(p.value->>'id')::uuid),false))), '[]'::jsonb)
  into records from jsonb_array_elements(result->'players') p;
  result := jsonb_set(result, '{players}', records);
 end if;
 return result;
end $$;
revoke all on function private.snapshot_before_nco_scope(uuid), private.snapshot(uuid) from public,anon,authenticated;
grant execute on function private.snapshot(uuid) to authenticated;
notify pgrst, 'reload schema';
