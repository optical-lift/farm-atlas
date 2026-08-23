create table if not exists local_intel.search_discovery_subject_work (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references local_intel.search_queries(id) on delete cascade,
  discovery_work_id uuid references local_intel.search_discovery_queue(id) on delete set null,
  seed_evidence_id uuid references local_intel.search_discovery_evidence(id) on delete set null,
  entity_id uuid references local_intel.entities(id) on delete set null,
  subject_key text not null,
  subject_kind text not null,
  subject_name text,
  organization_name text,
  requested_fields text[] not null default '{}'::text[],
  context jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','in_process','complete','paused')),
  claimed_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_query_id, subject_key)
);

create index if not exists search_discovery_subject_work_queue_idx
  on local_intel.search_discovery_subject_work(search_query_id,status,created_at,id);
create index if not exists search_discovery_subject_work_entity_idx
  on local_intel.search_discovery_subject_work(entity_id) where entity_id is not null;

alter table local_intel.search_discovery_subject_work enable row level security;
revoke all on table local_intel.search_discovery_subject_work from public,anon,authenticated;

create or replace function local_intel.enqueue_search_discovery_subject_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'local_intel','pg_catalog'
as $function$
declare
  v_query_id uuid := nullif(p_payload->>'search_query_id','')::uuid;
  v_work_id uuid := nullif(p_payload->>'discovery_work_id','')::uuid;
  v_seed_id uuid := nullif(p_payload->>'seed_evidence_id','')::uuid;
  v_entity_id uuid := nullif(p_payload->>'entity_id','')::uuid;
  v_subject_key text := btrim(coalesce(p_payload->>'subject_key',''));
  v_subject_kind text := btrim(coalesce(p_payload->>'subject_kind',''));
  v_requested_fields text[] := case
    when jsonb_typeof(p_payload->'requested_fields')='array'
      then array(select distinct btrim(value) from jsonb_array_elements_text(p_payload->'requested_fields') t(value) where btrim(value)<>'')
    else '{}'::text[] end;
  v_row local_intel.search_discovery_subject_work%rowtype;
begin
  if v_query_id is null or not exists (
    select 1 from local_intel.search_queries where id=v_query_id and status='in_process'
  ) then raise exception 'active search_query_id is required'; end if;
  if v_subject_key='' then raise exception 'subject_key is required'; end if;
  if v_subject_kind='' then raise exception 'subject_kind is required'; end if;
  if v_work_id is not null and not exists (
    select 1 from local_intel.search_discovery_queue where id=v_work_id and search_query_id=v_query_id
  ) then raise exception 'discovery_work_id does not belong to search query'; end if;
  if v_seed_id is not null and not exists (
    select 1 from local_intel.search_discovery_evidence where id=v_seed_id and search_query_id=v_query_id
  ) then raise exception 'seed_evidence_id does not belong to search query'; end if;
  if v_entity_id is not null and not exists (select 1 from local_intel.entities where id=v_entity_id) then
    raise exception 'unknown canonical entity_id';
  end if;

  insert into local_intel.search_discovery_subject_work(
    search_query_id,discovery_work_id,seed_evidence_id,entity_id,subject_key,subject_kind,
    subject_name,organization_name,requested_fields,context,metadata
  ) values (
    v_query_id,v_work_id,v_seed_id,v_entity_id,v_subject_key,v_subject_kind,
    nullif(btrim(p_payload->>'subject_name'),''),nullif(btrim(p_payload->>'organization_name'),''),
    v_requested_fields,
    case when jsonb_typeof(p_payload->'context')='object' then p_payload->'context' else '{}'::jsonb end,
    case when jsonb_typeof(p_payload->'metadata')='object' then p_payload->'metadata' else '{}'::jsonb end
  )
  on conflict (search_query_id,subject_key) do update set
    discovery_work_id=coalesce(excluded.discovery_work_id,local_intel.search_discovery_subject_work.discovery_work_id),
    seed_evidence_id=coalesce(excluded.seed_evidence_id,local_intel.search_discovery_subject_work.seed_evidence_id),
    entity_id=coalesce(excluded.entity_id,local_intel.search_discovery_subject_work.entity_id),
    subject_name=coalesce(excluded.subject_name,local_intel.search_discovery_subject_work.subject_name),
    organization_name=coalesce(excluded.organization_name,local_intel.search_discovery_subject_work.organization_name),
    requested_fields=(select array(select distinct x from unnest(local_intel.search_discovery_subject_work.requested_fields||excluded.requested_fields) x where btrim(x)<>'')),
    context=local_intel.search_discovery_subject_work.context||excluded.context,
    metadata=local_intel.search_discovery_subject_work.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

create or replace function local_intel.claim_search_discovery_subject_v1(p_search_query_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'local_intel','pg_catalog'
as $function$
declare
  v_row local_intel.search_discovery_subject_work%rowtype;
begin
  if not exists (select 1 from local_intel.search_queries where id=p_search_query_id and status='in_process') then
    return null;
  end if;
  with picked as (
    select id from local_intel.search_discovery_subject_work
    where search_query_id=p_search_query_id and status='queued'
    order by created_at,id
    for update skip locked
    limit 1
  )
  update local_intel.search_discovery_subject_work w
     set status='in_process',claimed_at=now(),updated_at=now()
    from picked p where w.id=p.id
  returning w.* into v_row;
  if v_row.id is null then return null; end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function local_intel.finish_search_discovery_subject_v1(
  p_subject_work_id uuid,
  p_stats jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'local_intel','pg_catalog'
as $function$
declare
  v_row local_intel.search_discovery_subject_work%rowtype;
begin
  update local_intel.search_discovery_subject_work
     set status='complete',completed_at=now(),
         metadata=metadata||jsonb_build_object('last_subject_stats',coalesce(p_stats,'{}'::jsonb),'released_at',now()),
         updated_at=now()
   where id=p_subject_work_id and status='in_process'
  returning * into v_row;
  if v_row.id is null then raise exception 'subject work is not in_process'; end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function local_intel.requeue_search_discovery_subject_v1(
  p_subject_work_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'local_intel','pg_catalog'
as $function$
declare
  v_row local_intel.search_discovery_subject_work%rowtype;
begin
  update local_intel.search_discovery_subject_work
     set status='queued',claimed_at=null,
         metadata=metadata||jsonb_build_object('last_error',p_error,'last_error_at',now()),
         updated_at=now()
   where id=p_subject_work_id and status='in_process'
  returning * into v_row;
  if v_row.id is null then raise exception 'subject work is not in_process'; end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function local_intel.get_search_discovery_loop_state_v1(p_search_query_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'local_intel','pg_catalog'
as $function$
with q as (
  select id,status,metadata from local_intel.search_queries where id=p_search_query_id
), c as (
  select count(distinct entity_id)::integer as complete_people
  from local_intel.get_search_complete_return_v1(p_search_query_id)
  where entity_id is not null
), h as (
  select count(*) filter (where status='holding')::integer as holds,
         count(*) filter (where status='resolved')::integer as resolved_holds
  from local_intel.search_field_holds where search_query_id=p_search_query_id
), e as (
  select count(*)::integer as evidence_rows,
         count(*) filter (where reconciliation_status='candidate')::integer as candidate_rows,
         count(*) filter (where reconciliation_status='applied')::integer as applied_rows
  from local_intel.search_discovery_evidence where search_query_id=p_search_query_id
), s as (
  select count(*) filter (where status='queued')::integer as subject_queued,
         count(*) filter (where status='in_process')::integer as subject_in_process,
         count(*) filter (where status='complete')::integer as subject_complete,
         count(*) filter (where status='paused')::integer as subject_paused
  from local_intel.search_discovery_subject_work where search_query_id=p_search_query_id
), d as (
  select status as discovery_status,metadata as discovery_metadata
  from local_intel.search_discovery_queue where search_query_id=p_search_query_id
  order by created_at desc limit 1
)
select jsonb_build_object(
  'search_query_id',q.id,'query_status',q.status,'goal_count',coalesce((q.metadata->>'goal_count')::integer,0),
  'complete_people',coalesce(c.complete_people,0),'holds',coalesce(h.holds,0),'resolved_holds',coalesce(h.resolved_holds,0),
  'evidence_rows',coalesce(e.evidence_rows,0),'candidate_rows',coalesce(e.candidate_rows,0),'applied_rows',coalesce(e.applied_rows,0),
  'subject_queued',coalesce(s.subject_queued,0),'subject_in_process',coalesce(s.subject_in_process,0),
  'subject_complete',coalesce(s.subject_complete,0),'subject_paused',coalesce(s.subject_paused,0),
  'discovery_status',d.discovery_status,'discovery_metadata',coalesce(d.discovery_metadata,'{}'::jsonb)
)
from q cross join c cross join h cross join e cross join s left join d on true;
$function$;

revoke all on function local_intel.enqueue_search_discovery_subject_v1(jsonb) from public,anon,authenticated;
revoke all on function local_intel.claim_search_discovery_subject_v1(uuid) from public,anon,authenticated;
revoke all on function local_intel.finish_search_discovery_subject_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function local_intel.requeue_search_discovery_subject_v1(uuid,text) from public,anon,authenticated;
grant execute on function local_intel.enqueue_search_discovery_subject_v1(jsonb) to service_role;
grant execute on function local_intel.claim_search_discovery_subject_v1(uuid) to service_role;
grant execute on function local_intel.finish_search_discovery_subject_v1(uuid,jsonb) to service_role;
grant execute on function local_intel.requeue_search_discovery_subject_v1(uuid,text) to service_role;
