-- Private drafts can be prepared before an event exists. Actual task text is
-- inserted privately, never bundled in source or exposed to player snapshots.
create table private.host_task_drafts(
 account_id uuid not null references private.accounts(id) on delete cascade,
 flight integer not null check(flight between 1 and 4),task text not null check(length(trim(task)) between 1 and 1500),
 explanation text not null default 'required' check(explanation in ('disabled','optional','required')),
 photo text not null default 'optional' check(photo in ('disabled','optional','required')),
 allow_nco boolean not null default false,revision bigint not null default 1,
 updated_at timestamptz not null default now(),primary key(account_id,flight)
);
alter table private.host_task_drafts enable row level security;
revoke all on private.host_task_drafts from public,anon,authenticated;
create function private.task_drafts(action text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=private.current_account();existing private.host_task_drafts;f integer;eid uuid;copied integer:=0;
begin
 if uid is null or not exists(select 1 from private.hosts where user_id=uid) then raise exception 'Only the main host may manage private task drafts.';end if;
 if args is null or jsonb_typeof(args)<>'object' or octet_length(args::text)>16000 then raise exception 'Invalid draft request.';end if;
 perform pg_advisory_xact_lock(hashtextextended('host-task-drafts:'||uid::text,0));
 if action='save' then
  f:=(args->>'flight')::int;
  if f is null or f not between 1 and 4 or coalesce(length(trim(args->>'task')),0) not between 1 and 1500 or coalesce(args->>'explanation','') not in ('disabled','optional','required') or coalesce(args->>'photo','') not in ('disabled','optional','required') then raise exception 'Choose a flight, write a task of 1 to 1500 characters and choose the evidence settings.';end if;
  select * into existing from private.host_task_drafts where account_id=uid and flight=f;
  if existing.account_id is not null and existing.revision is distinct from (args->>'revision')::bigint then raise exception 'This private draft changed on another device. Reload the drafts before saving.';end if;
  insert into private.host_task_drafts(account_id,flight,task,explanation,photo,allow_nco) values(uid,f,trim(args->>'task'),args->>'explanation',args->>'photo',coalesce((args->>'nco')::boolean,false))
  on conflict(account_id,flight) do update set task=excluded.task,explanation=excluded.explanation,photo=excluded.photo,allow_nco=excluded.allow_nco,revision=private.host_task_drafts.revision+1,updated_at=now();
 elsif action='copy' then
  eid:=(args->>'event')::uuid;
  perform 1 from public.events where id=eid and owner_id=uid for update;
  if not found then raise exception 'Choose one of your own events before copying drafts.';end if;
  if (select ended from private.games where event_id=eid) then raise exception 'This event has finished. Copy drafts into a new event or rehearsal instead.';end if;
  if (select count(*) from private.host_task_drafts where account_id=uid)<>4 then raise exception 'Save one private draft for each of the four flights first.';end if;
  if (select count(*) from private.group_state where event_id=eid and registered_flight between 1 and 4)<>4 then raise exception 'Map all four register flights in Setup before copying private drafts.';end if;
  insert into private.plain_tasks(event_id,group_id,draft,draft_explanation,draft_photo,draft_nco)
   select eid,s.group_id,d.task,d.explanation,d.photo,d.allow_nco from private.group_state s join private.host_task_drafts d on d.account_id=uid and d.flight=s.registered_flight where s.event_id=eid
   on conflict(group_id) do nothing;
  get diagnostics copied=row_count;
  insert into private.audit(event_id,actor,action,details) values(eid,uid,'copy_private_drafts',jsonb_build_object('copied',copied));
 elsif action<>'report' then raise exception 'Unknown private draft action.';end if;
 return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('flight',flight,'task',task,'explanation',explanation,'photo',photo,'nco',allow_nco,'revision',revision) order by flight) from private.host_task_drafts where account_id=uid),'[]'),'copied',copied);
end $$;
revoke all on function private.task_drafts(text,jsonb) from public,anon;
grant execute on function private.task_drafts(text,jsonb) to authenticated;
create function public.tno_task_drafts(action text default 'report',args jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.task_drafts(action,args);$$;
revoke all on function public.tno_task_drafts(text,jsonb) from public,anon;
grant execute on function public.tno_task_drafts(text,jsonb) to authenticated;
notify pgrst,'reload schema';
