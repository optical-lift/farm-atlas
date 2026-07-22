-- Universal multi-farm task release architecture.
-- atlas.tasks is the execution queue. Future work lives as planned occurrences
-- until a mandatory release policy says it is actionable.

create table if not exists atlas.farm_task_release_settings (
  farm_id uuid primary key references atlas.farms(id) on delete cascade,
  maximum_task_horizon_days integer not null default 60
    check (maximum_task_horizon_days between 7 and 93),
  default_generated_horizon_days integer not null default 30
    check (default_generated_horizon_days between 1 and 93),
  maximum_active_top_level_tasks integer not null default 150
    check (maximum_active_top_level_tasks between 10 and 1000),
  maximum_active_tasks_per_member integer not null default 40
    check (maximum_active_tasks_per_member between 5 and 250),
  maximum_release_batch_size integer not null default 25
    check (maximum_release_batch_size between 1 and 250),
  timezone_name text not null default 'America/Chicago',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.work_definitions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  title_template text not null,
  task_type text not null default 'general',
  source_kind text,
  action_key text,
  work_class text,
  default_priority text not null default 'normal',
  default_visibility_scope text not null default 'farm_shared',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (default_visibility_scope in (
    'owner','management','assigned_worker','farm_shared','system_internal'
  ))
);

create table if not exists atlas.work_release_policies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  work_definition_id uuid not null
    references atlas.work_definitions(id) on delete cascade,
  stable_key text not null,
  gate_type text not null,
  horizon_days integer not null default 30
    check (horizon_days between 0 and 93),
  maximum_active_instances integer not null default 50
    check (maximum_active_instances between 1 and 1000),
  gate_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (gate_type in (
    'immediate','time_window','manual','event','state',
    'predecessor','composite','serial_queue'
  ))
);

create table if not exists atlas.planned_work_occurrences (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  work_definition_id uuid not null
    references atlas.work_definitions(id) on delete cascade,
  release_policy_id uuid not null
    references atlas.work_release_policies(id) on delete cascade,
  parent_occurrence_id uuid
    references atlas.planned_work_occurrences(id) on delete cascade,
  occurrence_key text not null,
  source_kind text,
  source_id uuid,
  source_event_key text,
  title text not null,
  planned_due_date date,
  not_before_date date,
  state text not null default 'planned',
  gate_satisfied_at timestamptz,
  released_at timestamptz,
  released_task_id uuid,
  task_payload jsonb not null default '{}'::jsonb,
  relation_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, work_definition_id, occurrence_key),
  check (state in (
    'planned','eligible','releasing','released','completed','cancelled','failed'
  ))
);

create table if not exists atlas.work_gate_evaluations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  occurrence_id uuid not null
    references atlas.planned_work_occurrences(id) on delete cascade,
  release_policy_id uuid not null
    references atlas.work_release_policies(id) on delete cascade,
  outcome text not null,
  reason text,
  gate_snapshot jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  check (outcome in (
    'eligible','released','deferred','capacity_blocked','gate_blocked','failed'
  ))
);

create table if not exists atlas.task_release_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  occurrence_id uuid not null
    references atlas.planned_work_occurrences(id) on delete cascade,
  release_policy_id uuid not null
    references atlas.work_release_policies(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  release_reason text not null,
  released_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (occurrence_id, task_id)
);

alter table atlas.planned_work_occurrences
  drop constraint if exists planned_work_occurrences_released_task_id_fkey;
alter table atlas.planned_work_occurrences
  add constraint planned_work_occurrences_released_task_id_fkey
  foreign key (released_task_id)
  references atlas.tasks(id)
  on delete set null
  deferrable initially deferred;

alter table atlas.tasks
  add column if not exists planned_occurrence_id uuid;
alter table atlas.tasks
  add column if not exists release_policy_id uuid;
alter table atlas.tasks
  add column if not exists released_at timestamptz;
alter table atlas.tasks
  add column if not exists release_reason text;

alter table atlas.tasks
  drop constraint if exists tasks_planned_occurrence_id_fkey;
alter table atlas.tasks
  add constraint tasks_planned_occurrence_id_fkey
  foreign key (planned_occurrence_id)
  references atlas.planned_work_occurrences(id)
  on delete set null;

alter table atlas.tasks
  drop constraint if exists tasks_release_policy_id_fkey;
alter table atlas.tasks
  add constraint tasks_release_policy_id_fkey
  foreign key (release_policy_id)
  references atlas.work_release_policies(id)
  on delete set null;

-- Workflow handoffs may target or originate from an unreleased occurrence.
alter table atlas.workflow_handoffs
  add column if not exists target_occurrence_id uuid;
alter table atlas.workflow_handoffs
  add column if not exists source_occurrence_id uuid;

alter table atlas.workflow_handoffs
  drop constraint if exists workflow_handoffs_target_occurrence_id_fkey;
alter table atlas.workflow_handoffs
  add constraint workflow_handoffs_target_occurrence_id_fkey
  foreign key (target_occurrence_id)
  references atlas.planned_work_occurrences(id)
  on delete set null;

alter table atlas.workflow_handoffs
  drop constraint if exists workflow_handoffs_source_occurrence_id_fkey;
alter table atlas.workflow_handoffs
  add constraint workflow_handoffs_source_occurrence_id_fkey
  foreign key (source_occurrence_id)
  references atlas.planned_work_occurrences(id)
  on delete set null;

alter table atlas.workflow_handoffs
  drop constraint if exists workflow_handoffs_target_task_id_fkey;
alter table atlas.workflow_handoffs
  add constraint workflow_handoffs_target_task_id_fkey
  foreign key (target_task_id)
  references atlas.tasks(id)
  on delete set null;

alter table atlas.workflow_handoffs
  drop constraint if exists workflow_handoffs_target_check;
alter table atlas.workflow_handoffs
  add constraint workflow_handoffs_target_check
  check (
    effect='record_only'
    or target_task_id is not null
    or target_occurrence_id is not null
  );

-- Serial queues now point at an occurrence before a task exists.
alter table atlas.task_release_queue_items
  add column if not exists planned_occurrence_id uuid;
alter table atlas.task_release_queue_items
  drop constraint if exists task_release_queue_items_planned_occurrence_id_fkey;
alter table atlas.task_release_queue_items
  add constraint task_release_queue_items_planned_occurrence_id_fkey
  foreign key (planned_occurrence_id)
  references atlas.planned_work_occurrences(id)
  on delete set null;
alter table atlas.task_release_queue_items
  alter column task_id drop not null;
alter table atlas.task_release_queue_items
  drop constraint if exists task_release_queue_items_task_id_fkey;
alter table atlas.task_release_queue_items
  add constraint task_release_queue_items_task_id_fkey
  foreign key (task_id)
  references atlas.tasks(id)
  on delete set null;

create unique index if not exists tasks_one_released_task_per_occurrence_uidx
  on atlas.tasks(planned_occurrence_id)
  where planned_occurrence_id is not null
    and status in ('open','blocked');
create index if not exists planned_work_release_scan_idx
  on atlas.planned_work_occurrences(
    farm_id,state,planned_due_date,not_before_date
  );
create index if not exists planned_work_policy_state_idx
  on atlas.planned_work_occurrences(
    release_policy_id,state,planned_due_date
  );
create index if not exists work_release_policies_farm_active_idx
  on atlas.work_release_policies(farm_id,active,gate_type);
create index if not exists task_release_events_farm_released_idx
  on atlas.task_release_events(farm_id,released_at desc);

insert into atlas.farm_task_release_settings(farm_id)
select f.id from atlas.farms f
on conflict(farm_id) do nothing;

alter table atlas.farm_task_release_settings enable row level security;
alter table atlas.work_definitions enable row level security;
alter table atlas.work_release_policies enable row level security;
alter table atlas.planned_work_occurrences enable row level security;
alter table atlas.work_gate_evaluations enable row level security;
alter table atlas.task_release_events enable row level security;

drop policy if exists farm_task_release_settings_member_read
  on atlas.farm_task_release_settings;
create policy farm_task_release_settings_member_read
  on atlas.farm_task_release_settings
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists work_definitions_member_read
  on atlas.work_definitions;
create policy work_definitions_member_read
  on atlas.work_definitions
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists work_release_policies_member_read
  on atlas.work_release_policies;
create policy work_release_policies_member_read
  on atlas.work_release_policies
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists planned_work_occurrences_member_read
  on atlas.planned_work_occurrences;
create policy planned_work_occurrences_member_read
  on atlas.planned_work_occurrences
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists work_gate_evaluations_member_read
  on atlas.work_gate_evaluations;
create policy work_gate_evaluations_member_read
  on atlas.work_gate_evaluations
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

drop policy if exists task_release_events_member_read
  on atlas.task_release_events;
create policy task_release_events_member_read
  on atlas.task_release_events
  for select to authenticated
  using (atlas.current_farm_role(farm_id) is not null);

revoke all on
  atlas.farm_task_release_settings,
  atlas.work_definitions,
  atlas.work_release_policies,
  atlas.planned_work_occurrences,
  atlas.work_gate_evaluations,
  atlas.task_release_events
from anon;

grant select on
  atlas.farm_task_release_settings,
  atlas.work_definitions,
  atlas.work_release_policies,
  atlas.planned_work_occurrences,
  atlas.work_gate_evaluations,
  atlas.task_release_events
to authenticated;
