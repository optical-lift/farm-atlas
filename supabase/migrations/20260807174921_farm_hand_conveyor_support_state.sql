create table if not exists atlas.worker_support_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  worker_membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete set null,
  event_type text not null check (event_type in ('need_lighter_work')),
  event_context jsonb not null default '{}'::jsonb,
  owner_acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists worker_support_events_worker_created_idx
  on atlas.worker_support_events(worker_membership_id, created_at desc);

create index if not exists worker_support_events_unacked_idx
  on atlas.worker_support_events(farm_id, created_at desc)
  where owner_acknowledged_at is null;

create table if not exists atlas.worker_day_states (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  worker_membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  work_date date not null,
  mode text not null default 'normal' check (mode in ('normal','recovery')),
  recovery_moves_remaining integer not null default 0 check (recovery_moves_remaining >= 0),
  last_support_event_id uuid references atlas.worker_support_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(worker_membership_id, work_date)
);

create index if not exists worker_day_states_farm_date_idx
  on atlas.worker_day_states(farm_id, work_date);

alter table atlas.project_pull_items
  add column if not exists activation_demand text,
  add column if not exists ambiguity_load text,
  add column if not exists setup_load text,
  add column if not exists completion_clarity text,
  add column if not exists familiarity text,
  add column if not exists can_fragment boolean not null default false;

alter table atlas.project_pull_items
  drop constraint if exists project_pull_items_activation_demand_check;
alter table atlas.project_pull_items
  add constraint project_pull_items_activation_demand_check check (activation_demand is null or activation_demand in ('low','medium','high'));
alter table atlas.project_pull_items
  drop constraint if exists project_pull_items_ambiguity_load_check;
alter table atlas.project_pull_items
  add constraint project_pull_items_ambiguity_load_check check (ambiguity_load is null or ambiguity_load in ('low','medium','high'));
alter table atlas.project_pull_items
  drop constraint if exists project_pull_items_setup_load_check;
alter table atlas.project_pull_items
  add constraint project_pull_items_setup_load_check check (setup_load is null or setup_load in ('low','medium','high'));
alter table atlas.project_pull_items
  drop constraint if exists project_pull_items_completion_clarity_check;
alter table atlas.project_pull_items
  add constraint project_pull_items_completion_clarity_check check (completion_clarity is null or completion_clarity in ('low','medium','high'));
alter table atlas.project_pull_items
  drop constraint if exists project_pull_items_familiarity_check;
alter table atlas.project_pull_items
  add constraint project_pull_items_familiarity_check check (familiarity is null or familiarity in ('low','medium','high'));

create or replace function atlas.report_worker_needs_lighter_work_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_event_id uuid;
  v_work_date date;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found';
  end if;
  if v_task.assigned_membership_id is null then
    raise exception 'Task has no assigned worker';
  end if;
  select * into v_membership from atlas.farm_memberships where id = v_task.assigned_membership_id;
  if v_membership.id is null then
    raise exception 'Assigned membership not found';
  end if;
  v_work_date := (now() at time zone 'America/Chicago')::date;

  insert into atlas.worker_support_events(farm_id, worker_membership_id, task_id, event_type, event_context)
  values (
    v_task.farm_id,
    v_task.assigned_membership_id,
    v_task.id,
    'need_lighter_work',
    jsonb_build_object(
      'task_title', v_task.title,
      'work_class', v_task.work_class,
      'work_lane', v_task.work_lane,
      'reported_at', now()
    )
  ) returning id into v_event_id;

  insert into atlas.worker_day_states(farm_id, worker_membership_id, work_date, mode, recovery_moves_remaining, last_support_event_id, metadata)
  values (v_task.farm_id, v_task.assigned_membership_id, v_work_date, 'recovery', 2, v_event_id, jsonb_build_object('entered_at', now()))
  on conflict (worker_membership_id, work_date) do update
  set mode = 'recovery',
      recovery_moves_remaining = greatest(atlas.worker_day_states.recovery_moves_remaining, 2),
      last_support_event_id = excluded.last_support_event_id,
      metadata = coalesce(atlas.worker_day_states.metadata, '{}'::jsonb) || jsonb_build_object('entered_at', now()),
      updated_at = now();

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lighter_work_reported_at', now(),
        'lighter_work_support_event_id', v_event_id,
        'lighter_work_state', 'reported'
      ),
      updated_at = now()
  where id = v_task.id;

  return jsonb_build_object(
    'eventId', v_event_id,
    'workerMembershipId', v_task.assigned_membership_id,
    'taskId', v_task.id,
    'mode', 'recovery',
    'recoveryMovesRemaining', 2
  );
end;
$$;

create or replace function atlas.acknowledge_worker_support_event_v1(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.worker_support_events%rowtype;
begin
  update atlas.worker_support_events
  set owner_acknowledged_at = coalesce(owner_acknowledged_at, now())
  where id = p_event_id
  returning * into v_event;
  if v_event.id is null then
    raise exception 'Support event not found';
  end if;
  return jsonb_build_object('eventId', v_event.id, 'acknowledgedAt', v_event.owner_acknowledged_at);
end;
$$;
