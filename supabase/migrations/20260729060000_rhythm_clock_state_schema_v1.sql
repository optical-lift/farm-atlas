-- Build 3: deterministic farm rhythm Clock.
-- Adds temporal state, append-only transitions, canonical satisfaction links,
-- immediate workflow-result hooks, duplicate-safe task release, and an hourly cron tick.
-- No live farm-specific rhythm values are seeded and no visual files are changed.

create table if not exists atlas.rhythm_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rhythm_binding_id uuid not null references atlas.rhythm_bindings(id) on delete restrict,
  rhythm_rule_id uuid not null references atlas.rhythm_rules(id) on delete restrict,
  rhythm_key text not null,
  subject_kind text not null check (subject_kind in (
    'farm', 'zone', 'growing_object', 'crop_cycle', 'project'
  )),
  subject_id uuid not null,
  state text not null default 'uninitialized' check (state in (
    'uninitialized',
    'resting',
    'coming_due',
    'due',
    'fallen_out_of_rhythm',
    'recovering',
    'paused'
  )),
  lease_started_at timestamptz,
  warning_at timestamptz,
  due_at timestamptz,
  failure_at timestamptz,
  recovery_started_at timestamptz,
  last_qualifying_satisfaction_id uuid,
  current_task_id uuid references atlas.tasks(id) on delete set null,
  current_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null,
  effective_rule_version integer not null check (effective_rule_version > 0),
  visibility_scope text not null default 'farm_shared' check (visibility_scope in (
    'owner', 'management', 'assigned_worker', 'farm_shared', 'project_shared', 'system_internal'
  )),
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_evaluated_at timestamptz,
  last_transition_at timestamptz,
  state_reason jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, rhythm_key, subject_kind, subject_id),
  unique (rhythm_binding_id, subject_kind, subject_id),
  check (length(btrim(rhythm_key)) > 0),
  check (jsonb_typeof(state_reason) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

comment on table atlas.rhythm_state is
  'Current governed lease state for one canonical subject and rhythm. Physical condition remains separate from temporal stewardship state.';
comment on column atlas.rhythm_state.last_qualifying_satisfaction_id is
  'Latest real canonical result, observation, evidence, or owner action that renewed this lease.';
comment on column atlas.rhythm_state.current_task_id is
  'One adopted or centrally released current task serving this rhythm; supporting work remains explicit elsewhere.';

create index if not exists rhythm_state_tick_idx
  on atlas.rhythm_state(farm_id, state, last_evaluated_at, id);
create index if not exists rhythm_state_boundary_idx
  on atlas.rhythm_state(farm_id, warning_at, due_at, failure_at);
create index if not exists rhythm_state_task_idx
  on atlas.rhythm_state(current_task_id)
  where current_task_id is not null;

create table if not exists atlas.rhythm_satisfactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rhythm_state_id uuid not null references atlas.rhythm_state(id) on delete restrict,
  rhythm_binding_id uuid not null references atlas.rhythm_bindings(id) on delete restrict,
  rhythm_rule_id uuid not null references atlas.rhythm_rules(id) on delete restrict,
  rhythm_key text not null,
  subject_kind text not null check (subject_kind in (
    'farm', 'zone', 'growing_object', 'crop_cycle', 'project'
  )),
  subject_id uuid not null,
  satisfaction_key text not null,
  satisfaction_kind text not null check (satisfaction_kind in (
    'full', 'conditional', 'modifier', 'game_master'
  )),
  satisfied_at timestamptz not null,
  renewal_interval_seconds integer check (renewal_interval_seconds is null or renewal_interval_seconds > 0),
  source_kind text not null,
  source_id uuid not null,
  source_event text not null,
  source_workflow_event_id uuid references atlas.workflow_events(id) on delete restrict,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  source_field_log_id uuid references atlas.field_logs(id) on delete set null,
  source_object_id uuid references atlas.growing_objects(id) on delete set null,
  source_crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  source_project_id uuid references atlas.projects(id) on delete set null,
  policy_match jsonb not null,
  evidence jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (farm_id, satisfaction_key),
  check (length(btrim(satisfaction_key)) > 0),
  check (length(btrim(source_kind)) > 0),
  check (length(btrim(source_event)) > 0),
  check (jsonb_typeof(policy_match) = 'object'),
  check (jsonb_typeof(evidence) = 'object')
);

comment on table atlas.rhythm_satisfactions is
  'Canonical source links that actually satisfied a configured rhythm policy. Unrelated touches and partial work do not become satisfactions.';

alter table atlas.rhythm_state
  drop constraint if exists rhythm_state_last_qualifying_satisfaction_id_fkey;
alter table atlas.rhythm_state
  add constraint rhythm_state_last_qualifying_satisfaction_id_fkey
  foreign key (last_qualifying_satisfaction_id)
  references atlas.rhythm_satisfactions(id)
  on delete set null;

create index if not exists rhythm_satisfactions_state_time_idx
  on atlas.rhythm_satisfactions(rhythm_state_id, satisfied_at desc, id desc);
create index if not exists rhythm_satisfactions_workflow_idx
  on atlas.rhythm_satisfactions(source_workflow_event_id)
  where source_workflow_event_id is not null;

create table if not exists atlas.rhythm_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rhythm_state_id uuid not null references atlas.rhythm_state(id) on delete restrict,
  rhythm_binding_id uuid not null references atlas.rhythm_bindings(id) on delete restrict,
  rhythm_rule_id uuid not null references atlas.rhythm_rules(id) on delete restrict,
  rhythm_key text not null,
  subject_kind text not null check (subject_kind in (
    'farm', 'zone', 'growing_object', 'crop_cycle', 'project'
  )),
  subject_id uuid not null,
  transition_key text not null,
  transition_kind text not null check (transition_kind in (
    'initialized',
    'warning',
    'due',
    'failed',
    'recovering',
    'restored',
    'renewed',
    'paused',
    'reactivated',
    'rule_changed'
  )),
  from_state text not null,
  to_state text not null,
  boundary_kind text not null check (boundary_kind in (
    'initialization', 'warning', 'due', 'failure', 'satisfaction',
    'partial_result', 'pause', 'reactivation', 'rule_change'
  )),
  boundary_at timestamptz not null,
  evaluated_at timestamptz not null default now(),
  satisfaction_id uuid references atlas.rhythm_satisfactions(id) on delete set null,
  task_id uuid references atlas.tasks(id) on delete set null,
  planned_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null,
  journal_event_id uuid references atlas.journal_event_index(id) on delete set null,
  evaluator_version text not null default 'rhythm_clock_v1',
  visibility_scope text not null default 'farm_shared' check (visibility_scope in (
    'owner', 'management', 'assigned_worker', 'farm_shared', 'project_shared', 'system_internal'
  )),
  assigned_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id, transition_key),
  check (from_state in (
    'uninitialized','resting','coming_due','due','fallen_out_of_rhythm','recovering','paused'
  )),
  check (to_state in (
    'uninitialized','resting','coming_due','due','fallen_out_of_rhythm','recovering','paused'
  )),
  check (length(btrim(transition_key)) > 0),
  check (length(btrim(evaluator_version)) > 0),
  check (jsonb_typeof(payload) = 'object')
);

comment on table atlas.rhythm_transitions is
  'Append-only Clock transitions. Deterministic transition keys make warning, due, failure, recovery, and rule changes replay-safe.';

create index if not exists rhythm_transitions_state_idx
  on atlas.rhythm_transitions(rhythm_state_id, boundary_at desc, id desc);
create index if not exists rhythm_transitions_farm_time_idx
  on atlas.rhythm_transitions(farm_id, boundary_at desc, id desc);

alter table atlas.rhythm_state enable row level security;
alter table atlas.rhythm_satisfactions enable row level security;
alter table atlas.rhythm_transitions enable row level security;

create or replace function atlas.can_read_rhythm_state_v1(p_state_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case s.visibility_scope
      when 'owner' then atlas.is_farm_owner(s.farm_id)
      when 'management' then atlas.is_farm_manager_or_owner(s.farm_id)
      when 'assigned_worker' then atlas.is_farm_manager_or_owner(s.farm_id) or s.assigned_user_id = auth.uid()
      when 'project_shared' then s.subject_kind = 'project' and atlas.can_read_project(s.subject_id)
      when 'system_internal' then atlas.is_farm_owner(s.farm_id)
      else atlas.is_farm_member(s.farm_id)
    end
    from atlas.rhythm_state s
    where s.id = p_state_id
  ), false);
$$;

create or replace function atlas.can_read_rhythm_transition_v1(p_transition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case t.visibility_scope
      when 'owner' then atlas.is_farm_owner(t.farm_id)
      when 'management' then atlas.is_farm_manager_or_owner(t.farm_id)
      when 'assigned_worker' then atlas.is_farm_manager_or_owner(t.farm_id) or t.assigned_user_id = auth.uid()
      when 'project_shared' then t.subject_kind = 'project' and atlas.can_read_project(t.subject_id)
      when 'system_internal' then atlas.is_farm_owner(t.farm_id)
      else atlas.is_farm_member(t.farm_id)
    end
    from atlas.rhythm_transitions t
    where t.id = p_transition_id
  ), false);
$$;

revoke all on function atlas.can_read_rhythm_state_v1(uuid) from public, anon;
revoke all on function atlas.can_read_rhythm_transition_v1(uuid) from public, anon;
grant execute on function atlas.can_read_rhythm_state_v1(uuid) to authenticated;
grant execute on function atlas.can_read_rhythm_transition_v1(uuid) to authenticated;

drop policy if exists rhythm_state_read_visible on atlas.rhythm_state;
create policy rhythm_state_read_visible on atlas.rhythm_state
for select to authenticated
using (atlas.can_read_rhythm_state_v1(id));

drop policy if exists rhythm_satisfactions_read_visible on atlas.rhythm_satisfactions;
create policy rhythm_satisfactions_read_visible on atlas.rhythm_satisfactions
for select to authenticated
using (atlas.can_read_rhythm_state_v1(rhythm_state_id));

drop policy if exists rhythm_transitions_read_visible on atlas.rhythm_transitions;
create policy rhythm_transitions_read_visible on atlas.rhythm_transitions
for select to authenticated
using (atlas.can_read_rhythm_transition_v1(id));

grant select on atlas.rhythm_state, atlas.rhythm_satisfactions, atlas.rhythm_transitions to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on atlas.rhythm_state, atlas.rhythm_satisfactions, atlas.rhythm_transitions
  from authenticated, anon;
revoke all on atlas.rhythm_state, atlas.rhythm_satisfactions, atlas.rhythm_transitions from anon;

create or replace function atlas.prevent_rhythm_history_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if current_setting('atlas.rhythm_history_internal_write', true) = 'on' then
    return new;
  end if;
  raise exception 'Rhythm transition and satisfaction history is append-only.' using errcode = '55000';
end;
$$;

revoke all on function atlas.prevent_rhythm_history_mutation_v1() from public, anon, authenticated;

drop trigger if exists rhythm_satisfactions_append_only_v1 on atlas.rhythm_satisfactions;
create trigger rhythm_satisfactions_append_only_v1
before update or delete on atlas.rhythm_satisfactions
for each row execute function atlas.prevent_rhythm_history_mutation_v1();

drop trigger if exists rhythm_transitions_append_only_v1 on atlas.rhythm_transitions;
create trigger rhythm_transitions_append_only_v1
before update or delete on atlas.rhythm_transitions
for each row execute function atlas.prevent_rhythm_history_mutation_v1();

create or replace function atlas.rhythm_boundary_at_v1(
  p_started_at timestamptz,
  p_offset_seconds integer,
  p_timezone_name text default 'America/Chicago',
  p_boundary_mode text default 'exact_timestamp'
)
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when p_started_at is null or p_offset_seconds is null then null
    when coalesce(p_boundary_mode, 'exact_timestamp') in ('local_wall_clock', 'local_day') then
      ((p_started_at at time zone coalesce(nullif(p_timezone_name, ''), 'America/Chicago'))
        + make_interval(secs => p_offset_seconds))
        at time zone coalesce(nullif(p_timezone_name, ''), 'America/Chicago')
    else p_started_at + make_interval(secs => p_offset_seconds)
  end;
$$;

revoke all on function atlas.rhythm_boundary_at_v1(timestamptz, integer, text, text)
  from public, anon, authenticated;

create or replace function atlas.rhythm_safe_uuid_v1(p_value text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function atlas.rhythm_safe_uuid_v1(text)
  from public, anon, authenticated;
