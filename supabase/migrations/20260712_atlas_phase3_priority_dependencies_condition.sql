-- Atlas Phase 3: priority, dependencies, owner override, and condition-sensitive effort
-- Applied to noel-core / atlas schema on 2026-07-12.

alter table atlas.maintenance_objects
  add column if not exists crop_loss_risk integer not null default 0,
  add column if not exists revenue_unlock_score integer not null default 0,
  add column if not exists planting_block_score integer not null default 0,
  add column if not exists guest_visibility_score integer not null default 0,
  add column if not exists weed_spread_risk integer not null default 0,
  add column if not exists upcoming_booking_score integer not null default 0,
  add column if not exists condition_reported_at timestamptz,
  add column if not exists estimate_source text not null default 'phase1_default';

create table if not exists atlas.maintenance_dependencies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  maintenance_object_id uuid not null references atlas.maintenance_objects(id) on delete cascade,
  dependent_task_id uuid not null references atlas.tasks(id) on delete cascade,
  dependency_type text not null default 'blocks_task',
  active boolean not null default true,
  satisfied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (maintenance_object_id, dependent_task_id),
  check (dependency_type in ('blocks_task','protects_crop','unlocks_revenue','guest_readiness'))
);

alter table atlas.maintenance_dependencies enable row level security;
create index if not exists idx_maintenance_dependencies_active
  on atlas.maintenance_dependencies (maintenance_object_id, active)
  where active = true;

update atlas.maintenance_objects mo
set crop_loss_risk = case
      when mo.crop_protective and mo.condition in ('heavy','reset') then 85
      when mo.crop_protective and mo.condition = 'moderate' then 55
      when mo.crop_protective then 25 else 0 end,
    revenue_unlock_score = case when mo.revenue_linked then 70 else 0 end,
    planting_block_score = case when mo.must_precede_task then 90 else 0 end,
    guest_visibility_score = case when mo.guest_facing then 45 else 0 end,
    weed_spread_risk = case
      when mo.condition = 'reset' then 90
      when mo.condition = 'heavy' then 75
      when mo.condition = 'moderate' then 35
      else 10 end,
    updated_at = now();

insert into atlas.maintenance_dependencies (
  farm_id, maintenance_object_id, dependent_task_id, dependency_type, metadata
)
select distinct
  mo.farm_id,
  mo.id,
  t.id,
  case when lower(coalesce(t.task_type,'')) ~ '(plant|sow|transplant)'
       then 'blocks_task' else 'unlocks_revenue' end,
  jsonb_build_object('source','phase3_existing_task_link','task_title',t.title,'object_key',go.stable_key)
from atlas.maintenance_objects mo
join atlas.growing_objects go on go.id = mo.object_id
join atlas.task_objects tx on tx.object_id = mo.object_id
join atlas.tasks t on t.id = tx.task_id
where mo.maintenance_type = 'weed'
  and t.status = 'blocked'
  and (lower(coalesce(t.task_type,'')) ~ '(plant|sow|transplant)'
       or coalesce(t.metadata->>'prerequisite_task_id','') <> ''
       or coalesce(t.blocker_text,'') <> '')
on conflict (maintenance_object_id, dependent_task_id) do update set
  active = true,
  dependency_type = excluded.dependency_type,
  metadata = atlas.maintenance_dependencies.metadata || excluded.metadata,
  updated_at = now();

insert into atlas.maintenance_dependencies (
  farm_id, maintenance_object_id, dependent_task_id, dependency_type, metadata
)
select distinct
  mo.farm_id, mo.id, dependent.id, 'blocks_task',
  jsonb_build_object('source','phase3_planned_followup_match','planned_followup',weed.metadata->>'planned_followup','task_title',dependent.title,'object_key',go.stable_key)
from atlas.maintenance_objects mo
join atlas.growing_objects go on go.id = mo.object_id
join atlas.task_objects weed_tx on weed_tx.object_id = mo.object_id
join atlas.tasks weed on weed.id = weed_tx.task_id
join atlas.tasks dependent
  on dependent.farm_id = mo.farm_id
 and dependent.status = 'blocked'
 and lower(dependent.title) = lower(weed.metadata->>'planned_followup')
where mo.maintenance_type = 'weed'
  and coalesce(weed.metadata->>'planned_followup','') <> ''
on conflict (maintenance_object_id, dependent_task_id) do update set
  active = true,
  metadata = atlas.maintenance_dependencies.metadata || excluded.metadata,
  updated_at = now();

update atlas.maintenance_objects mo
set must_precede_task = exists (
      select 1 from atlas.maintenance_dependencies md
      where md.maintenance_object_id = mo.id and md.active and md.satisfied_at is null
    ),
    planting_block_score = case when exists (
      select 1 from atlas.maintenance_dependencies md
      where md.maintenance_object_id = mo.id and md.active and md.satisfied_at is null
    ) then 100 else mo.planting_block_score end,
    revenue_unlock_score = case when exists (
      select 1 from atlas.maintenance_dependencies md
      join atlas.tasks t on t.id = md.dependent_task_id
      where md.maintenance_object_id = mo.id and md.active and md.satisfied_at is null
        and (coalesce(t.metadata->>'revenue_role','') <> '' or lower(t.task_type) ~ '(harvest|sow|plant)')
    ) then greatest(mo.revenue_unlock_score,85) else mo.revenue_unlock_score end,
    updated_at = now();

create or replace function atlas.set_maintenance_condition(
  p_maintenance_object_id uuid,
  p_condition text,
  p_reported_minutes integer default null
)
returns atlas.maintenance_objects
language plpgsql
security invoker
set search_path = atlas, public
as $$
declare
  v_row atlas.maintenance_objects;
  v_minutes integer;
begin
  if p_condition not in ('maintained','moderate','heavy','reset') then
    raise exception 'Invalid maintenance condition: %', p_condition;
  end if;

  select * into v_row from atlas.maintenance_objects
  where id = p_maintenance_object_id for update;
  if not found then raise exception 'Unknown maintenance object'; end if;

  v_minutes := coalesce(p_reported_minutes,
    case p_condition
      when 'maintained' then v_row.maintenance_effort_minutes
      when 'moderate' then greatest(v_row.maintenance_effort_minutes,
        round((v_row.maintenance_effort_minutes + v_row.reset_effort_minutes) / 2.0)::integer)
      else v_row.reset_effort_minutes
    end);

  update atlas.maintenance_objects
  set condition = p_condition,
      current_effort_minutes = v_minutes,
      remaining_effort_minutes = v_minutes,
      condition_reported_at = now(),
      estimate_source = case when p_reported_minutes is null then 'condition_rule' else 'owner_reported' end,
      crop_loss_risk = case
        when crop_protective and p_condition in ('heavy','reset') then 90
        when crop_protective and p_condition = 'moderate' then 60
        when crop_protective then 25 else 0 end,
      weed_spread_risk = case
        when p_condition = 'reset' then 95
        when p_condition = 'heavy' then 80
        when p_condition = 'moderate' then 40
        else 10 end,
      updated_at = now()
  where id = p_maintenance_object_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function atlas.set_maintenance_condition(uuid,text,integer) from public, anon, authenticated;
grant execute on function atlas.set_maintenance_condition(uuid,text,integer) to service_role;

-- The Phase 3 version of preview_maintenance_schedule replaces the Phase 2
-- function and returns effective_priority_score, owner_priority, dependency IDs
-- and labels, estimate_source, and named priority reasons. Its effective score is
-- the sum of base priority, crop-loss risk, revenue unlocked, planting blockage,
-- guest visibility, weed-spread risk, booking proximity, days overdue, severity,
-- and a dominant owner-override weight. Equal score bands are grouped by zone.
-- See the applied database function definition for the complete PL/pgSQL body.

comment on table atlas.maintenance_dependencies is
  'Links recurring maintenance state to blocked work. The dependency survives regardless of which daily collection delivers the maintenance item.';
