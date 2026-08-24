create table if not exists local_intel.search_discovery_vertical_lanes (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references local_intel.search_queries(id) on delete cascade,
  discovery_work_id uuid references local_intel.search_discovery_queue(id) on delete set null,
  lane_key text not null check (lane_key ~ '^[a-z0-9_]+$'),
  lane_label text not null check (btrim(lane_label) <> ''),
  lane_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(lane_scope) = 'object'),
  status text not null default 'queued' check (status in ('queued','in_process','paused','complete')),
  claimed_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(search_query_id,lane_key)
);

create index if not exists search_discovery_vertical_lanes_claim_idx
  on local_intel.search_discovery_vertical_lanes(search_query_id,status,updated_at,lane_key);

alter table local_intel.search_discovery_vertical_lanes enable row level security;
revoke all on table local_intel.search_discovery_vertical_lanes from public, anon, authenticated;

create or replace function local_intel.get_search_discovery_lane_state_v1(p_search_query_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = local_intel, pg_catalog
as $$
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id',l.id,
      'lane_key',l.lane_key,
      'lane_label',l.lane_label,
      'lane_scope',l.lane_scope,
      'status',l.status,
      'claimed_at',l.claimed_at,
      'completed_at',l.completed_at,
      'metadata',l.metadata
    )
    order by l.lane_key
  ),
  '[]'::jsonb
)
from local_intel.search_discovery_vertical_lanes l
where l.search_query_id=p_search_query_id;
$$;
revoke all on function local_intel.get_search_discovery_lane_state_v1(uuid) from public, anon, authenticated;
grant execute on function local_intel.get_search_discovery_lane_state_v1(uuid) to service_role;

create or replace function local_intel.claim_search_discovery_lane_v1(
  p_search_query_id uuid,
  p_lane_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_goal integer;
  v_complete integer;
  v_lane local_intel.search_discovery_vertical_lanes%rowtype;
begin
  select coalesce((metadata->>'goal_count')::integer,0)
    into v_goal
  from local_intel.search_queries
  where id=p_search_query_id and status='in_process';

  if not found then return null; end if;

  select count(distinct entity_id)::integer
    into v_complete
  from local_intel.get_search_complete_return_v1(p_search_query_id)
  where entity_id is not null;

  if v_goal>0 and v_complete>=v_goal then
    update local_intel.search_discovery_vertical_lanes
       set status='complete',
           completed_at=coalesce(completed_at,now()),
           updated_at=now()
     where search_query_id=p_search_query_id
       and status<>'complete';

    update local_intel.search_discovery_queue
       set status='complete',
           completed_at=coalesce(completed_at,now()),
           updated_at=now()
     where search_query_id=p_search_query_id
       and status<>'complete';

    update local_intel.search_queries
       set status='complete',
           completed_at=coalesce(completed_at,now()),
           updated_at=now()
     where id=p_search_query_id and status='in_process';

    return jsonb_build_object(
      'status','complete',
      'complete_people',v_complete,
      'goal_count',v_goal
    );
  end if;

  with picked as (
    select id
    from local_intel.search_discovery_vertical_lanes
    where search_query_id=p_search_query_id
      and status='queued'
      and (nullif(btrim(p_lane_key),'') is null or lane_key=btrim(p_lane_key))
    order by
      coalesce((metadata->>'completed_batches')::integer,0),
      updated_at,
      lane_key
    for update skip locked
    limit 1
  )
  update local_intel.search_discovery_vertical_lanes l
     set status='in_process',
         claimed_at=now(),
         updated_at=now()
    from picked p
   where l.id=p.id
  returning l.* into v_lane;

  if v_lane.id is null then return null; end if;

  return to_jsonb(v_lane)||jsonb_build_object(
    'complete_people',v_complete,
    'goal_count',v_goal
  );
end;
$$;
revoke all on function local_intel.claim_search_discovery_lane_v1(uuid,text) from public, anon, authenticated;
grant execute on function local_intel.claim_search_discovery_lane_v1(uuid,text) to service_role;

create or replace function local_intel.finish_search_discovery_lane_v1(
  p_lane_id uuid,
  p_batch_stats jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_query_id uuid;
  v_lane_key text;
  v_goal integer;
  v_complete integer;
  v_batches integer;
  v_done boolean;
begin
  select search_query_id,lane_key,
         coalesce((metadata->>'completed_batches')::integer,0)+1
    into v_query_id,v_lane_key,v_batches
  from local_intel.search_discovery_vertical_lanes
  where id=p_lane_id and status='in_process'
  for update;

  if not found then
    raise exception 'unknown or unclaimed discovery lane %',p_lane_id;
  end if;

  select coalesce((metadata->>'goal_count')::integer,0)
    into v_goal
  from local_intel.search_queries
  where id=v_query_id
  for update;

  select count(distinct entity_id)::integer
    into v_complete
  from local_intel.get_search_complete_return_v1(v_query_id)
  where entity_id is not null;

  v_done := v_goal>0 and v_complete>=v_goal;

  update local_intel.search_discovery_vertical_lanes
     set status=case when v_done then 'complete' else 'queued' end,
         claimed_at=case when v_done then claimed_at else null end,
         completed_at=now(),
         metadata=metadata||jsonb_build_object(
           'completed_batches',v_batches,
           'last_batch_completed_at',now(),
           'last_batch_stats',coalesce(p_batch_stats,'{}'::jsonb)
         ),
         updated_at=now()
   where id=p_lane_id;

  update local_intel.search_discovery_queue
     set status=case when v_done then 'complete' else 'queued' end,
         claimed_at=case when v_done then claimed_at else null end,
         completed_at=now(),
         metadata=metadata||jsonb_build_object(
           'completed_lane_batches',
             coalesce((metadata->>'completed_lane_batches')::integer,0)+1,
           'last_lane_key',v_lane_key,
           'last_lane_batch_completed_at',now(),
           'last_lane_batch_stats',coalesce(p_batch_stats,'{}'::jsonb)
         ),
         updated_at=now()
   where search_query_id=v_query_id;

  if v_done then
    update local_intel.search_discovery_vertical_lanes
       set status='complete',
           completed_at=coalesce(completed_at,now()),
           updated_at=now()
     where search_query_id=v_query_id;

    update local_intel.search_queries
       set status='complete',
           completed_at=coalesce(completed_at,now()),
           updated_at=now()
     where id=v_query_id and status='in_process';
  end if;

  return local_intel.get_search_discovery_loop_state_v1(v_query_id)
    ||jsonb_build_object(
      'goal_reached',v_done,
      'lane_key',v_lane_key,
      'lanes',local_intel.get_search_discovery_lane_state_v1(v_query_id)
    );
end;
$$;
revoke all on function local_intel.finish_search_discovery_lane_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function local_intel.finish_search_discovery_lane_v1(uuid,jsonb) to service_role;

create or replace function local_intel.requeue_search_discovery_lane_v1(
  p_lane_id uuid,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_row local_intel.search_discovery_vertical_lanes%rowtype;
begin
  update local_intel.search_discovery_vertical_lanes
     set status='queued',
         claimed_at=null,
         metadata=metadata||jsonb_build_object(
           'last_executor_error',nullif(btrim(coalesce(p_error,'')),''),
           'last_requeued_at',now()
         ),
         updated_at=now()
   where id=p_lane_id and status='in_process'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'unknown or unclaimed discovery lane %',p_lane_id;
  end if;

  return to_jsonb(v_row);
end;
$$;
revoke all on function local_intel.requeue_search_discovery_lane_v1(uuid,text) from public, anon, authenticated;
grant execute on function local_intel.requeue_search_discovery_lane_v1(uuid,text) to service_role;

with target as (
  select q.id as search_query_id,
         (
           select d.id
           from local_intel.search_discovery_queue d
           where d.search_query_id=q.id
           order by d.created_at desc
           limit 1
         ) as discovery_work_id
  from local_intel.search_queries q
  where q.id='d4f8ebb7-5cda-4da7-8a64-e4a33b84f42e'::uuid
), lanes(lane_key,lane_label,lane_scope) as (
  values
  ('healthcare_social_assistance','Healthcare & Social Assistance',
    '{"primary_organization_vertical":"healthcare_social_assistance","organization_types":["hospitals","clinics","senior living","behavioral health","disability services","social assistance"],"target_functions":["human resources","administration","executive support","community relations","marketing","events","operations"],"exclude_primary_verticals":["education","government_public_utilities"]}'::jsonb),
  ('education','Education',
    '{"primary_organization_vertical":"education","organization_types":["public school districts","private schools","colleges","universities","training organizations"],"target_functions":["human resources","administration","executive support","community engagement","events","advancement","operations"],"exclude_primary_verticals":["government_public_utilities"]}'::jsonb),
  ('government_public_utilities','Government & Public Utilities',
    '{"primary_organization_vertical":"government_public_utilities","organization_types":["municipal government","county government","public agencies","public utilities","economic development"],"target_functions":["administration","human resources","public information","community engagement","events","executive support","operations"],"exclude_primary_verticals":[]}'::jsonb),
  ('finance_insurance','Finance & Insurance',
    '{"primary_organization_vertical":"finance_insurance","organization_types":["banks","credit unions","insurance firms","financial advisory firms"],"target_functions":["human resources","marketing","community relations","executive support","administration","operations"],"exclude_primary_verticals":[]}'::jsonb),
  ('manufacturing_distribution_construction','Manufacturing, Distribution & Construction',
    '{"primary_organization_vertical":"manufacturing_distribution_construction","organization_types":["manufacturers","warehouses","distributors","construction firms","engineering firms"],"target_functions":["human resources","administration","executive support","marketing","operations","employee engagement"],"exclude_primary_verticals":["retail_consumer_large_employers"]}'::jsonb),
  ('nonprofit_religious_community','Nonprofit, Religious & Community',
    '{"primary_organization_vertical":"nonprofit_religious_community","organization_types":["nonprofits","foundations","churches","associations","community organizations"],"target_functions":["executive leadership","development","membership","community engagement","events","administration","operations"],"exclude_primary_verticals":["healthcare_social_assistance","education"]}'::jsonb),
  ('tourism_hospitality_events','Tourism, Hospitality & Events',
    '{"primary_organization_vertical":"tourism_hospitality_events","organization_types":["hotels","resorts","tourism organizations","attractions","venues","restaurants","event organizations"],"target_functions":["group sales","meetings and conventions","events","human resources","marketing","community relations","administration"],"exclude_primary_verticals":[]}'::jsonb),
  ('professional_business_services','Professional & Business Services',
    '{"primary_organization_vertical":"professional_business_services","organization_types":["law firms","accounting firms","consultancies","technology firms","real estate firms","business services"],"target_functions":["human resources","office management","executive support","marketing","business development","administration","operations"],"exclude_primary_verticals":[]}'::jsonb),
  ('retail_consumer_large_employers','Retail, Consumer & Large Employers',
    '{"primary_organization_vertical":"retail_consumer_large_employers","organization_types":["retailers","consumer services","automotive groups","large private employers not owned by another lane"],"target_functions":["human resources","administration","executive support","marketing","community relations","operations","employee engagement"],"exclude_primary_verticals":["healthcare_social_assistance","education","finance_insurance","manufacturing_distribution_construction","tourism_hospitality_events"]}'::jsonb)
)
insert into local_intel.search_discovery_vertical_lanes(
  search_query_id,discovery_work_id,lane_key,lane_label,lane_scope,metadata
)
select t.search_query_id,t.discovery_work_id,l.lane_key,l.lane_label,l.lane_scope,
       jsonb_build_object(
         'target_completion_hours',24,
         'default_batch_size',100,
         'max_batch_size',250,
         'seeded_by','vertical_lane_parallelization_v1'
       )
from target t
cross join lanes l
on conflict (search_query_id,lane_key)
do update set
  discovery_work_id=coalesce(excluded.discovery_work_id,local_intel.search_discovery_vertical_lanes.discovery_work_id),
  lane_label=excluded.lane_label,
  lane_scope=excluded.lane_scope,
  metadata=local_intel.search_discovery_vertical_lanes.metadata||excluded.metadata,
  updated_at=now();

update local_intel.search_queries
set parameters=parameters||jsonb_build_object(
      'discovery_strategy','parallel_vertical_lanes',
      'vertical_lane_strategy','exclusive_primary_organization_vertical',
      'throughput',jsonb_build_object(
        'target_completion_hours',24,
        'discovery_batch_size',100,
        'maximum_discovery_batch_size',250,
        'subject_source_limit',4,
        'discovery_lane_workers',9,
        'subject_workers',12,
        'work_modes',jsonb_build_array('discovery','subject','balanced')
      )
    ),
    updated_at=now()
where id='d4f8ebb7-5cda-4da7-8a64-e4a33b84f42e'::uuid;

comment on table local_intel.search_discovery_vertical_lanes is
  'Mutually exclusive primary-organization discovery lanes sharing one search goal; lanes are independently claimable so vertical workers can run concurrently without duplicating territory.';
comment on function local_intel.claim_search_discovery_lane_v1(uuid,text) is
  'Claims one requested or least-worked vertical lane with SKIP LOCKED while preserving the shared query goal.';
comment on function local_intel.finish_search_discovery_lane_v1(uuid,jsonb) is
  'Finishes one vertical lane batch, records lane-specific throughput, and returns the lane to the queue unless the shared query goal is complete.';
