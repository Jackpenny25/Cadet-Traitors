-- Match the existing API pattern: a public invoker wrapper calls an internal
-- implementation that checks the bound PIN session and host membership.
alter function public.tno_roster(text,jsonb) set schema private;
alter function private.tno_roster(text,jsonb) rename to roster_admin;
revoke all on function private.roster_admin(text,jsonb) from public,anon;
grant execute on function private.roster_admin(text,jsonb) to authenticated;
create function public.tno_roster(action text default 'report',args jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select private.roster_admin(action,args);
$$;
revoke all on function public.tno_roster(text,jsonb) from public,anon;
grant execute on function public.tno_roster(text,jsonb) to authenticated;
notify pgrst,'reload schema';
