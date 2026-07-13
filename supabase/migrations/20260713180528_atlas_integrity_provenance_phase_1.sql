
create table if not exists atlas.truth_sources (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  label text not null,
  source_type text not null check (
    source_type in (
      'field_observation',
      'user_confirmation',
      'field_log',
      'planting_claim',
      'document',
      'import',
      'system'
    )
  ),
  source_date date,
  authority_rank smallint not null default 50 check (authority_rank between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key)
);

create table if not exists atlas.truth_assertions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  subject_type text not null check (
    subject_type in (
      'farm',
      'zone',
      'growing_object',
      'crop_cycle',
      'plant_instance',
      'task',
      'resource',
      'project'
    )
  ),
  subject_id uuid,
  subject_stable_key text,
  field_key text not null,
  asserted_value jsonb not null,
  observed_at timestamptz not null default now(),
  confidence text not null default 'unknown' check (
    confidence in ('unknown', 'low', 'medium', 'high', 'confirmed')
  ),
  source_id uuid not null references atlas.truth_sources(id) on delete restrict,
  status text not null default 'active' check (
    status in ('active', 'superseded', 'disputed', 'review_required')
  ),
  superseded_by_id uuid references atlas.truth_assertions(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    subject_id is not null
    or nullif(btrim(subject_stable_key), '') is not null
  ),
  check (superseded_by_id is distinct from id)
);

create table if not exists atlas.integrity_audit_runs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  audit_version text not null,
  metrics jsonb not null,
  source_id uuid references atlas.truth_sources(id) on delete set null,
  created_by text not null default 'system',
  note text,
  created_at timestamptz not null default now(),
  unique (farm_id, audit_version)
);

create index if not exists truth_sources_farm_type_idx
  on atlas.truth_sources (farm_id, source_type);

create index if not exists truth_assertions_subject_idx
  on atlas.truth_assertions (farm_id, subject_type, subject_id);

create index if not exists truth_assertions_source_idx
  on atlas.truth_assertions (source_id);

create index if not exists truth_assertions_status_idx
  on atlas.truth_assertions (farm_id, status);

create unique index if not exists truth_assertions_one_active_field_idx
  on atlas.truth_assertions (
    farm_id,
    subject_type,
    coalesce(subject_id::text, subject_stable_key),
    field_key
  )
  where status = 'active';

create index if not exists integrity_audit_runs_farm_created_idx
  on atlas.integrity_audit_runs (farm_id, created_at desc);

drop trigger if exists truth_sources_set_updated_at on atlas.truth_sources;
create trigger truth_sources_set_updated_at
before update on atlas.truth_sources
for each row execute function atlas.set_updated_at();

drop trigger if exists truth_assertions_set_updated_at on atlas.truth_assertions;
create trigger truth_assertions_set_updated_at
before update on atlas.truth_assertions
for each row execute function atlas.set_updated_at();

alter table atlas.truth_sources enable row level security;
alter table atlas.truth_assertions enable row level security;
alter table atlas.integrity_audit_runs enable row level security;

revoke all on atlas.truth_sources from public, anon, authenticated;
revoke all on atlas.truth_assertions from public, anon, authenticated;
revoke all on atlas.integrity_audit_runs from public, anon, authenticated;

grant select, insert, update, delete on atlas.truth_sources to service_role;
grant select, insert, update, delete on atlas.truth_assertions to service_role;
grant select, insert on atlas.integrity_audit_runs to service_role;

create or replace view atlas.v_integrity_summary
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  (
    select count(*)
    from atlas.tasks t
    where t.farm_id = f.id
      and t.status not in ('done', 'archived', 'cancelled', 'canceled')
  ) as active_tasks,
  (
    select count(*)
    from atlas.tasks t
    where t.farm_id = f.id
      and t.status not in ('done', 'archived', 'cancelled', 'canceled')
      and exists (
        select 1
        from atlas.task_objects task_object
        where task_object.task_id = t.id
      )
  ) as active_tasks_with_object,
  (
    select count(*)
    from atlas.tasks t
    where t.farm_id = f.id
      and t.status not in ('done', 'archived', 'cancelled', 'canceled')
      and (
        t.zone_id is not null
        or exists (
          select 1
          from atlas.task_objects task_object
          where task_object.task_id = t.id
        )
      )
  ) as active_tasks_with_scope,
  (
    select count(*)
    from atlas.field_logs field_log
    where field_log.farm_id = f.id
  ) as field_logs,
  (
    select count(*)
    from atlas.field_logs field_log
    where field_log.farm_id = f.id
      and exists (
        select 1
        from atlas.field_log_objects field_log_object
        where field_log_object.field_log_id = field_log.id
          and field_log_object.object_id is not null
      )
  ) as field_logs_with_object,
  (
    select count(*)
    from atlas.field_logs field_log
    where field_log.farm_id = f.id
      and exists (
        select 1
        from atlas.field_log_objects field_log_object
        where field_log_object.field_log_id = field_log.id
          and (
            field_log_object.object_id is not null
            or field_log_object.zone_id is not null
          )
      )
  ) as field_logs_with_scope,
  (
    select count(*)
    from atlas.growing_objects growing_object
    where growing_object.farm_id = f.id
  ) as growing_objects,
  (
    select count(*)
    from atlas.growing_objects growing_object
    where growing_object.farm_id = f.id
      and (
        exists (
          select 1
          from atlas.object_contents object_content
          where object_content.object_id = growing_object.id
        )
        or exists (
          select 1
          from atlas.crop_cycles crop_cycle
          where crop_cycle.object_id = growing_object.id
        )
      )
  ) as objects_with_contents,
  (
    select count(*)
    from atlas.object_contents object_content
    where object_content.farm_id = f.id
  ) as legacy_content_rows,
  (
    select count(*)
    from atlas.object_contents object_content
    where object_content.farm_id = f.id
      and (
        object_content.planting_claim_id is not null
        or object_content.crop_profile_id is not null
      )
  ) as legacy_content_with_identity,
  (
    select count(*)
    from atlas.crop_cycles crop_cycle
    where crop_cycle.farm_id = f.id
  ) as canonical_crop_cycles,
  (
    select count(*)
    from atlas.planting_claims planting_claim
    where planting_claim.farm_id = f.id
  ) as planting_claims,
  (
    select count(*)
    from atlas.planting_claims planting_claim
    where planting_claim.farm_id = f.id
      and (
        exists (
          select 1
          from atlas.object_contents object_content
          where object_content.planting_claim_id = planting_claim.id
        )
        or exists (
          select 1
          from atlas.crop_cycles crop_cycle
          where crop_cycle.planting_claim_id = planting_claim.id
        )
      )
  ) as planting_claims_with_object,
  (
    select count(*)
    from (
      select
        object_content.object_id,
        lower(regexp_replace(btrim(object_content.content_label), '\s+', ' ', 'g'))
      from atlas.object_contents object_content
      where object_content.farm_id = f.id
      group by
        object_content.object_id,
        lower(regexp_replace(btrim(object_content.content_label), '\s+', ' ', 'g'))
      having count(*) > 1
    ) duplicate_content
  ) as semantic_duplicate_content_groups,
  (
    select count(*)
    from (
      select
        task.generated_from,
        task.generated_from_id,
        lower(regexp_replace(btrim(task.title), '\s+', ' ', 'g')),
        task.due_date
      from atlas.tasks task
      where task.farm_id = f.id
        and task.status not in ('done', 'archived', 'cancelled', 'canceled')
        and task.generated_from is not null
      group by
        task.generated_from,
        task.generated_from_id,
        lower(regexp_replace(btrim(task.title), '\s+', ' ', 'g')),
        task.due_date
      having count(*) > 1
    ) generated_collision
  ) as generated_task_collision_groups,
  (
    select count(*)
    from atlas.resources resource
    where resource.farm_id = f.id
  ) as resources,
  (
    select count(*)
    from atlas.task_resource_requirements requirement
    join atlas.tasks task on task.id = requirement.task_id
    where task.farm_id = f.id
  ) as task_resource_links,
  (
    select count(distinct requirement.task_id)
    from atlas.task_resource_requirements requirement
    join atlas.tasks task on task.id = requirement.task_id
    where task.farm_id = f.id
  ) as tasks_with_resource_requirements,
  (
    select count(*)
    from atlas.truth_sources source
    where source.farm_id = f.id
  ) as truth_sources,
  (
    select count(*)
    from atlas.truth_assertions assertion
    where assertion.farm_id = f.id
  ) as truth_assertions
from atlas.farms f;

create or replace view atlas.v_integrity_issue_summary
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  'active_task_without_object'::text as issue_key,
  'warning'::text as severity,
  'task'::text as entity_type,
  count(*) as issue_count
from atlas.farms f
join atlas.tasks task on task.farm_id = f.id
where task.status not in ('done', 'archived', 'cancelled', 'canceled')
  and not exists (
    select 1
    from atlas.task_objects task_object
    where task_object.task_id = task.id
  )
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'active_task_without_scope',
  'critical',
  'task',
  count(*)
from atlas.farms f
join atlas.tasks task on task.farm_id = f.id
where task.status not in ('done', 'archived', 'cancelled', 'canceled')
  and task.zone_id is null
  and not exists (
    select 1
    from atlas.task_objects task_object
    where task_object.task_id = task.id
  )
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'field_log_without_object',
  'warning',
  'field_log',
  count(*)
from atlas.farms f
join atlas.field_logs field_log on field_log.farm_id = f.id
where not exists (
  select 1
  from atlas.field_log_objects field_log_object
  where field_log_object.field_log_id = field_log.id
    and field_log_object.object_id is not null
)
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'field_log_without_scope',
  'critical',
  'field_log',
  count(*)
from atlas.farms f
join atlas.field_logs field_log on field_log.farm_id = f.id
where not exists (
  select 1
  from atlas.field_log_objects field_log_object
  where field_log_object.field_log_id = field_log.id
    and (
      field_log_object.object_id is not null
      or field_log_object.zone_id is not null
    )
)
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'legacy_content_without_identity',
  'warning',
  'object_content',
  count(*)
from atlas.farms f
join atlas.object_contents object_content on object_content.farm_id = f.id
where object_content.planting_claim_id is null
  and object_content.crop_profile_id is null
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'planting_claim_without_object',
  'critical',
  'planting_claim',
  count(*)
from atlas.farms f
join atlas.planting_claims planting_claim on planting_claim.farm_id = f.id
where not exists (
    select 1
    from atlas.object_contents object_content
    where object_content.planting_claim_id = planting_claim.id
  )
  and not exists (
    select 1
    from atlas.crop_cycles crop_cycle
    where crop_cycle.planting_claim_id = planting_claim.id
  )
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'semantic_duplicate_content_group',
  'warning',
  'object_content',
  count(*)
from atlas.farms f
join (
  select
    object_content.farm_id,
    object_content.object_id,
    lower(regexp_replace(btrim(object_content.content_label), '\s+', ' ', 'g')) as normalized_label
  from atlas.object_contents object_content
  group by
    object_content.farm_id,
    object_content.object_id,
    lower(regexp_replace(btrim(object_content.content_label), '\s+', ' ', 'g'))
  having count(*) > 1
) duplicate_content on duplicate_content.farm_id = f.id
group by f.id, f.stable_key
having count(*) > 0

union all

select
  f.id,
  f.stable_key,
  'generated_task_collision_group',
  'critical',
  'task',
  count(*)
from atlas.farms f
join (
  select
    task.farm_id,
    task.generated_from,
    task.generated_from_id,
    lower(regexp_replace(btrim(task.title), '\s+', ' ', 'g')) as normalized_title,
    task.due_date
  from atlas.tasks task
  where task.status not in ('done', 'archived', 'cancelled', 'canceled')
    and task.generated_from is not null
  group by
    task.farm_id,
    task.generated_from,
    task.generated_from_id,
    lower(regexp_replace(btrim(task.title), '\s+', ' ', 'g')),
    task.due_date
  having count(*) > 1
) generated_collision on generated_collision.farm_id = f.id
group by f.id, f.stable_key
having count(*) > 0;

create or replace view atlas.v_integrity_report
with (security_invoker = true)
as
select
  summary.*,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'issue_key', issue.issue_key,
          'severity', issue.severity,
          'entity_type', issue.entity_type,
          'issue_count', issue.issue_count
        )
        order by
          case issue.severity
            when 'critical' then 0
            when 'warning' then 1
            else 2
          end,
          issue.issue_key
      )
      from atlas.v_integrity_issue_summary issue
      where issue.farm_id = summary.farm_id
    ),
    '[]'::jsonb
  ) as issue_summary,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'stable_key', source.stable_key,
          'label', source.label,
          'source_type', source.source_type,
          'source_date', source.source_date,
          'authority_rank', source.authority_rank
        )
        order by source.authority_rank desc, source.label
      )
      from atlas.truth_sources source
      where source.farm_id = summary.farm_id
    ),
    '[]'::jsonb
  ) as sources,
  (
    select audit.created_at
    from atlas.integrity_audit_runs audit
    where audit.farm_id = summary.farm_id
      and audit.audit_version = 'phase_1_baseline_v1'
    order by audit.created_at
    limit 1
  ) as baseline_captured_at,
  (
    select audit.metrics
    from atlas.integrity_audit_runs audit
    where audit.farm_id = summary.farm_id
      and audit.audit_version = 'phase_1_baseline_v1'
    order by audit.created_at
    limit 1
  ) as baseline_metrics
from atlas.v_integrity_summary summary;

revoke all on atlas.v_integrity_summary from public, anon, authenticated;
revoke all on atlas.v_integrity_issue_summary from public, anon, authenticated;
revoke all on atlas.v_integrity_report from public, anon, authenticated;

grant select on atlas.v_integrity_summary to service_role;
grant select on atlas.v_integrity_issue_summary to service_role;
grant select on atlas.v_integrity_report to service_role;

with elm_farm as (
  select id
  from atlas.farms
  where stable_key = 'elm_farm'
),
source_seed (
  stable_key,
  label,
  source_type,
  source_date,
  authority_rank,
  metadata
) as (
  values
    (
      'atlas_constitution_original',
      'Atlas Constitution',
      'document',
      null::date,
      90::smallint,
      jsonb_build_object(
        'source_file', 'Atlas Constitution.docx',
        'phase', 1
      )
    ),
    (
      'atlas_supabase_schema_documentation_original',
      'Atlas Supabase Schema Documentation',
      'document',
      null::date,
      85::smallint,
      jsonb_build_object(
        'source_file', 'Atlas_Supabase_Schema_Documentation.docx',
        'phase', 1
      )
    ),
    (
      'atlas_farm_state_input_list_original',
      'Atlas Farm-State Input List',
      'document',
      null::date,
      95::smallint,
      jsonb_build_object(
        'source_file', 'Atlas Farm-State Input List.docx',
        'phase', 1
      )
    ),
    (
      'atlas_phase_1_baseline_2026_07_13',
      'Atlas Phase 1 integrity baseline',
      'system',
      date '2026-07-13',
      100::smallint,
      jsonb_build_object(
        'phase', 1,
        'audit_version', 'phase_1_baseline_v1'
      )
    )
)
insert into atlas.truth_sources (
  farm_id,
  stable_key,
  label,
  source_type,
  source_date,
  authority_rank,
  metadata
)
select
  elm_farm.id,
  source_seed.stable_key,
  source_seed.label,
  source_seed.source_type,
  source_seed.source_date,
  source_seed.authority_rank,
  source_seed.metadata
from elm_farm
cross join source_seed
on conflict (farm_id, stable_key) do nothing;

insert into atlas.truth_assertions (
  farm_id,
  subject_type,
  subject_id,
  subject_stable_key,
  field_key,
  asserted_value,
  confidence,
  source_id,
  status,
  metadata
)
select
  farm.id,
  'farm',
  farm.id,
  farm.stable_key,
  'source_of_truth',
  to_jsonb('supabase'::text),
  'confirmed',
  source.id,
  'active',
  jsonb_build_object('phase', 1, 'seeded_from_original_document', true)
from atlas.farms farm
join atlas.truth_sources source
  on source.farm_id = farm.id
 and source.stable_key = 'atlas_supabase_schema_documentation_original'
where farm.stable_key = 'elm_farm'
on conflict do nothing;

insert into atlas.truth_assertions (
  farm_id,
  subject_type,
  subject_id,
  subject_stable_key,
  field_key,
  asserted_value,
  confidence,
  source_id,
  status,
  metadata
)
select
  farm.id,
  'farm',
  farm.id,
  farm.stable_key,
  'state_to_action_chain',
  '["farm","zone","growing_object","state","work_class","action","log","updated_state","next_valid_move"]'::jsonb,
  'confirmed',
  source.id,
  'active',
  jsonb_build_object('phase', 1, 'seeded_from_original_document', true)
from atlas.farms farm
join atlas.truth_sources source
  on source.farm_id = farm.id
 and source.stable_key = 'atlas_constitution_original'
where farm.stable_key = 'elm_farm'
on conflict do nothing;

insert into atlas.truth_assertions (
  farm_id,
  subject_type,
  subject_id,
  subject_stable_key,
  field_key,
  asserted_value,
  confidence,
  source_id,
  status,
  metadata
)
select
  farm.id,
  'zone',
  zone.id,
  zone.stable_key,
  'bed_layout',
  jsonb_build_object(
    'bed_count', 18,
    'bed_length_ft', 30
  ),
  'confirmed',
  source.id,
  'active',
  jsonb_build_object('phase', 1, 'seeded_from_original_document', true)
from atlas.farms farm
join atlas.zones zone
  on zone.farm_id = farm.id
 and zone.stable_key = 'field_rows'
join atlas.truth_sources source
  on source.farm_id = farm.id
 and source.stable_key = 'atlas_farm_state_input_list_original'
where farm.stable_key = 'elm_farm'
on conflict do nothing;

insert into atlas.integrity_audit_runs (
  farm_id,
  audit_version,
  metrics,
  source_id,
  created_by,
  note
)
select
  summary.farm_id,
  'phase_1_baseline_v1',
  to_jsonb(summary) - 'farm_id' - 'farm_key',
  source.id,
  'phase_1_migration',
  null
from atlas.v_integrity_summary summary
join atlas.truth_sources source
  on source.farm_id = summary.farm_id
 and source.stable_key = 'atlas_phase_1_baseline_2026_07_13'
where summary.farm_key = 'elm_farm'
on conflict (farm_id, audit_version) do nothing;
