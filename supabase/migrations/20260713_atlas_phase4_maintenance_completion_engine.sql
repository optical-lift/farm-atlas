-- Atlas Phase 4: recurring maintenance completion and regeneration
-- Applied to noel-core / atlas schema on 2026-07-13.

create table if not exists atlas.maintenance_history (
  id uuid primary key default gen_random_uuid(),
  maintenance_object_id uuid not null references atlas.maintenance_objects(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  maintenance_type text not null,
  outcome text not null,
  condition_before text not null,
  condition_after text not null,
  estimated_minutes_before integer not null,
  actual_minutes integer,
  remaining_minutes_after integer not null,
  completed_at timestamptz not null default now(),
  source_task_id uuid references atlas.tasks(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  check (outcome in ('fully_completed','partially_completed','heavier_reset')),
  check (actual_minutes is null or actual_minutes >= 0),
  check (remaining_minutes_after >= 0)
);

create index if not exists idx_maintenance_history_object
  on atlas.maintenance_history (maintenance_object_id, completed_at desc);
create index if not exists idx_maintenance_history_source_task
  on atlas.maintenance_history (source_task_id) where source_task_id is not null;

alter table atlas.maintenance_history enable row level security;

create or replace function atlas.record_maintenance_completion(
  p_maintenance_object_id uuid,
  p_outcome text,
  p_actual_minutes integer default null,
  p_note text default null,
  p_source_task_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = atlas, public
as $$
declare
  v_mo atlas.maintenance_objects%rowtype;
  v_now timestamptz := now();
  v_today date := current_date;
  v_actual integer;
  v_remaining integer;
  v_condition_after text;
  v_next_eligible date;
  v_unlocked_task_ids uuid[] := '{}';
  v_history_id uuid;
begin
  if p_outcome not in ('fully_completed','partially_completed','heavier_reset') then
    raise exception 'Unsupported maintenance outcome: %', p_outcome;
  end if;

  select * into v_mo
  from atlas.maintenance_objects
  where id = p_maintenance_object_id
  for update;

  if not found then
    raise exception 'Maintenance object not found: %', p_maintenance_object_id;
  end if;

  v_actual := case when p_actual_minutes is null then null else greatest(0, p_actual_minutes) end;

  if p_outcome = 'fully_completed' then
    v_actual := coalesce(v_actual, v_mo.remaining_effort_minutes, v_mo.current_effort_minutes);
    v_remaining := v_mo.maintenance_effort_minutes;
    v_condition_after := 'maintained';
    v_next_eligible := v_today + v_mo.normal_return_interval_days;

    update atlas.maintenance_objects
    set condition = 'maintained',
        current_effort_minutes = maintenance_effort_minutes,
        remaining_effort_minutes = maintenance_effort_minutes,
        last_completed_at = v_now,
        next_eligible_date = v_next_eligible,
        owner_priority = 0,
        must_precede_task = false,
        metadata = metadata || jsonb_build_object(
          'last_completion_outcome', p_outcome,
          'last_actual_minutes', v_actual,
          'last_completion_note', p_note,
          'last_source_task_id', p_source_task_id,
          'last_completed_at', v_now
        ),
        updated_at = v_now
    where id = v_mo.id;

    with unlocked as (
      update atlas.tasks t
      set status = 'open',
          due_date = coalesce(t.due_date, v_today),
          blocker_text = null,
          metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
            'unlocked_by_maintenance_object_id', v_mo.id,
            'unlocked_at', v_now,
            'unlock_source', 'maintenance_completion'
          ),
          updated_at = v_now
      from atlas.maintenance_dependencies d
      where d.maintenance_object_id = v_mo.id
        and d.dependent_task_id = t.id
        and d.active = true
        and t.status = 'blocked'
      returning t.id
    )
    select coalesce(array_agg(id), '{}') into v_unlocked_task_ids from unlocked;

    update atlas.maintenance_dependencies
    set active = false,
        satisfied_at = v_now,
        metadata = metadata || jsonb_build_object('completed_by_maintenance_history_pending', true),
        updated_at = v_now
    where maintenance_object_id = v_mo.id
      and active = true;

  elsif p_outcome = 'partially_completed' then
    v_actual := greatest(1, coalesce(v_actual, least(v_mo.remaining_effort_minutes, greatest(1, v_mo.current_effort_minutes / 2))));
    v_remaining := greatest(1, v_mo.remaining_effort_minutes - v_actual);
    v_condition_after := v_mo.condition;
    v_next_eligible := v_today;

    update atlas.maintenance_objects
    set remaining_effort_minutes = v_remaining,
        current_effort_minutes = greatest(current_effort_minutes, v_remaining),
        next_eligible_date = v_today,
        metadata = metadata || jsonb_build_object(
          'last_completion_outcome', p_outcome,
          'last_actual_minutes', v_actual,
          'last_completion_note', p_note,
          'last_source_task_id', p_source_task_id,
          'partial_recorded_at', v_now
        ),
        updated_at = v_now
    where id = v_mo.id;

  else
    v_actual := coalesce(v_actual, v_mo.remaining_effort_minutes);
    v_remaining := greatest(v_mo.reset_effort_minutes, v_mo.current_effort_minutes, v_mo.remaining_effort_minutes, coalesce(v_actual, 0));
    v_condition_after := 'reset';
    v_next_eligible := v_today;

    update atlas.maintenance_objects
    set condition = 'reset',
        current_effort_minutes = v_remaining,
        remaining_effort_minutes = v_remaining,
        reset_effort_minutes = greatest(reset_effort_minutes, v_remaining),
        next_eligible_date = v_today,
        metadata = metadata || jsonb_build_object(
          'last_completion_outcome', p_outcome,
          'reported_heavier_minutes', v_actual,
          'last_completion_note', p_note,
          'last_source_task_id', p_source_task_id,
          'heavier_reset_reported_at', v_now
        ),
        updated_at = v_now
    where id = v_mo.id;
  end if;

  insert into atlas.maintenance_history (
    maintenance_object_id, farm_id, object_id, maintenance_type,
    outcome, condition_before, condition_after,
    estimated_minutes_before, actual_minutes, remaining_minutes_after,
    completed_at, source_task_id, note, metadata
  ) values (
    v_mo.id, v_mo.farm_id, v_mo.object_id, v_mo.maintenance_type,
    p_outcome, v_mo.condition, v_condition_after,
    v_mo.remaining_effort_minutes, v_actual, v_remaining,
    v_now, p_source_task_id, p_note,
    jsonb_build_object('next_eligible_date', v_next_eligible, 'unlocked_task_ids', v_unlocked_task_ids)
  ) returning id into v_history_id;

  update atlas.maintenance_dependencies
  set metadata = (metadata - 'completed_by_maintenance_history_pending') || jsonb_build_object('maintenance_history_id', v_history_id),
      updated_at = v_now
  where maintenance_object_id = v_mo.id
    and satisfied_at = v_now;

  return jsonb_build_object(
    'maintenance_object_id', v_mo.id,
    'history_id', v_history_id,
    'outcome', p_outcome,
    'condition', v_condition_after,
    'actual_minutes', v_actual,
    'remaining_minutes', v_remaining,
    'next_eligible_date', v_next_eligible,
    'unlocked_task_ids', v_unlocked_task_ids
  );
end;
$$;

revoke all on function atlas.record_maintenance_completion(uuid,text,integer,text,uuid) from public, anon, authenticated;
grant execute on function atlas.record_maintenance_completion(uuid,text,integer,text,uuid) to service_role;

create or replace function atlas.bridge_task_outcome_to_maintenance()
returns trigger
language plpgsql
security invoker
set search_path = atlas, public
as $$
declare
  v_object_id uuid;
  v_maintenance_id uuid;
  v_actual integer;
begin
  if lower(coalesce(new.task_type, '')) not in ('weeding','weed') or new.outcome not in ('done','partial') then
    return new;
  end if;

  begin
    v_actual := nullif(new.metadata->>'actual_minutes','')::integer;
  exception when others then
    v_actual := null;
  end;

  for v_object_id in select object_id from atlas.task_objects where task_id = new.task_id loop
    select id into v_maintenance_id
    from atlas.maintenance_objects
    where object_id = v_object_id and maintenance_type = 'weed' and active = true
    limit 1;

    if v_maintenance_id is not null then
      perform atlas.record_maintenance_completion(
        v_maintenance_id,
        case when new.outcome = 'done' then 'fully_completed' else 'partially_completed' end,
        v_actual,
        new.note,
        new.task_id
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_bridge_task_outcome_to_maintenance on atlas.task_outcome_events;
create trigger trg_bridge_task_outcome_to_maintenance
after insert on atlas.task_outcome_events
for each row execute function atlas.bridge_task_outcome_to_maintenance();

revoke all on function atlas.bridge_task_outcome_to_maintenance() from public, anon, authenticated;
