-- Atlas Phase 1: canonical maintenance object model
-- Applied to noel-core / atlas schema on 2026-07-12.

create table if not exists atlas.maintenance_objects (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  zone_id uuid references atlas.zones(id) on delete set null,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  maintenance_type text not null,
  condition text not null default 'reset',
  reset_effort_minutes integer not null,
  maintenance_effort_minutes integer not null,
  current_effort_minutes integer not null,
  remaining_effort_minutes integer not null,
  normal_return_interval_days integer not null,
  last_completed_at timestamptz,
  next_eligible_date date not null default current_date,
  priority_score numeric not null default 0,
  must_precede_task boolean not null default false,
  guest_facing boolean not null default false,
  crop_protective boolean not null default false,
  revenue_linked boolean not null default false,
  routine boolean not null default true,
  owner_priority integer not null default 0,
  active boolean not null default true,
  source text not null default 'phase1_canonical_seed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_id, maintenance_type),
  check (maintenance_type in ('weed','mow','edge','prune','spray','deadhead','water','pathway_cleanup','seasonal_bed_reset','venue_landscape_preparation')),
  check (condition in ('maintained','moderate','heavy','reset')),
  check (reset_effort_minutes > 0),
  check (maintenance_effort_minutes > 0),
  check (current_effort_minutes >= 0),
  check (remaining_effort_minutes >= 0),
  check (normal_return_interval_days > 0)
);

create index if not exists idx_maintenance_objects_eligible
  on atlas.maintenance_objects (maintenance_type, active, next_eligible_date, priority_score desc);
create index if not exists idx_maintenance_objects_zone
  on atlas.maintenance_objects (zone_id, maintenance_type);
create index if not exists idx_maintenance_objects_farm
  on atlas.maintenance_objects (farm_id, maintenance_type);

comment on table atlas.maintenance_objects is
  'Canonical recurring maintenance state: one row per maintainable farm object and maintenance type. Daily collections are derived from these rows rather than stored as future standalone chores.';

alter table atlas.maintenance_objects enable row level security;

insert into atlas.maintenance_objects (
  farm_id, zone_id, object_id, maintenance_type, condition,
  reset_effort_minutes, maintenance_effort_minutes,
  current_effort_minutes, remaining_effort_minutes,
  normal_return_interval_days, last_completed_at, next_eligible_date,
  priority_score, must_precede_task, guest_facing, crop_protective,
  revenue_linked, routine, source, metadata
)
select
  go.farm_id,
  go.zone_id,
  go.id,
  'weed',
  case
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('none','low','light') then 'maintained'
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('medium','moderate','low_to_medium') then 'moderate'
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('high','severe','bermuda_mat') then 'heavy'
    else 'reset'
  end,
  case
    when z.stable_key = 'berry_walk_flower_rows' then 60
    when z.stable_key = 'field_rows' and lower(coalesce(os.weed_pressure, 'unknown')) in ('high','severe','bermuda_mat') then 120
    when go.object_type in ('arch_bed','bed') and coalesce(go.length_ft, 0) <= 10 then 30
    when go.object_type = 'bed' then 60
    else 60
  end,
  25,
  case
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('none','low','light') then 25
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('medium','moderate','low_to_medium') then greatest(25, round((case
      when z.stable_key = 'berry_walk_flower_rows' then 60
      when z.stable_key = 'field_rows' then 120
      when go.object_type in ('arch_bed','bed') and coalesce(go.length_ft, 0) <= 10 then 30
      else 60 end + 25) / 2.0)::integer)
    else case
      when z.stable_key = 'berry_walk_flower_rows' then 60
      when z.stable_key = 'field_rows' then 120
      when go.object_type in ('arch_bed','bed') and coalesce(go.length_ft, 0) <= 10 then 30
      else 60 end
  end,
  case
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('none','low','light') then 25
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('medium','moderate','low_to_medium') then greatest(25, round((case
      when z.stable_key = 'berry_walk_flower_rows' then 60
      when z.stable_key = 'field_rows' then 120
      when go.object_type in ('arch_bed','bed') and coalesce(go.length_ft, 0) <= 10 then 30
      else 60 end + 25) / 2.0)::integer)
    else case
      when z.stable_key = 'berry_walk_flower_rows' then 60
      when z.stable_key = 'field_rows' then 120
      when go.object_type in ('arch_bed','bed') and coalesce(go.length_ft, 0) <= 10 then 30
      else 60 end
  end,
  21,
  case when os.last_weeded_at is not null then os.last_weeded_at::timestamptz else null end,
  case when os.last_weeded_at is not null then os.last_weeded_at + 21 else current_date end,
  case
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('severe','bermuda_mat') then 70
    when lower(coalesce(os.weed_pressure, 'unknown')) = 'high' then 50
    when lower(coalesce(os.weed_pressure, 'unknown')) in ('medium','moderate','low_to_medium') then 25
    else 10
  end + case when go.guest_visible then 15 else 0 end,
  exists (
    select 1
    from atlas.tasks t
    join atlas.task_objects tx on tx.task_id = t.id
    where tx.object_id = go.id
      and t.status in ('open','blocked')
      and (coalesce(t.metadata->>'planned_followup','') <> '' or coalesce(t.unlock_text,'') <> '')
  ),
  go.guest_visible,
  go.object_type in ('bed','arch_bed','area'),
  z.stable_key in ('field_rows','berry_walk_flower_rows','barn_beds','entry_billboard','follow_me','curve_garden','u_pick'),
  true,
  'phase1_existing_object_state',
  jsonb_build_object(
    'seeded_from_weed_pressure', coalesce(os.weed_pressure, 'unknown'),
    'object_stable_key', go.stable_key,
    'zone_stable_key', z.stable_key,
    'phase1_defaults', true
  )
from atlas.growing_objects go
join atlas.zones z on z.id = go.zone_id
left join atlas.object_state os on os.object_id = go.id
where go.object_type in ('bed','arch_bed','area','path','corridor')
  and lower(coalesce(os.weed_pressure, 'unknown')) <> 'unknown'
on conflict (object_id, maintenance_type) do update set
  farm_id = excluded.farm_id,
  zone_id = excluded.zone_id,
  condition = excluded.condition,
  reset_effort_minutes = excluded.reset_effort_minutes,
  maintenance_effort_minutes = excluded.maintenance_effort_minutes,
  current_effort_minutes = excluded.current_effort_minutes,
  remaining_effort_minutes = excluded.remaining_effort_minutes,
  normal_return_interval_days = excluded.normal_return_interval_days,
  last_completed_at = excluded.last_completed_at,
  next_eligible_date = excluded.next_eligible_date,
  priority_score = excluded.priority_score,
  must_precede_task = excluded.must_precede_task,
  guest_facing = excluded.guest_facing,
  crop_protective = excluded.crop_protective,
  revenue_linked = excluded.revenue_linked,
  routine = excluded.routine,
  metadata = atlas.maintenance_objects.metadata || excluded.metadata,
  updated_at = now();

-- Keep the immediate July 13-14 work unchanged. Retire only the old pre-generated future rotation.
update atlas.tasks
set status = 'archived',
    metadata = jsonb_set(
      metadata || jsonb_build_object(
        'archived_reason', 'Replaced by canonical maintenance object model',
        'maintenance_model_migration', 'atlas_phase1_maintenance_object_model',
        'archived_at', now()
      ),
      '{checklist_status}',
      '"archived"'::jsonb,
      true
    ),
    updated_at = now()
where status = 'open'
  and task_type = 'weeding'
  and due_date > date '2026-07-14'
  and generated_from in (
    'weeding_crisis_rotation',
    'weeding_crisis_child',
    'weeding_maintenance_rotation',
    'weeding_maintenance_child',
    'weeding_rotation'
  );
