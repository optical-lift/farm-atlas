create table if not exists atlas.workflow_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  event_key text not null,
  source_kind text not null,
  source_id uuid not null,
  source_key text,
  source_event text not null,
  event_date date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_events_source_kind_check check (
    source_kind in ('task','object','maintenance','crop_cycle','production_succession','field_log')
  ),
  constraint workflow_events_event_key_unique unique (farm_id, event_key)
);

create index if not exists workflow_events_source_lookup_idx
  on atlas.workflow_events (farm_id, source_kind, source_id, source_event, created_at desc);

create index if not exists workflow_events_source_key_lookup_idx
  on atlas.workflow_events (farm_id, source_kind, source_key, source_event, created_at desc)
  where source_key is not null;

create table if not exists atlas.workflow_handoffs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  source_kind text not null,
  source_id uuid,
  source_key text,
  source_event text not null,
  source_filter jsonb not null default '{}'::jsonb,
  target_task_id uuid references atlas.tasks(id) on delete cascade,
  effect text not null,
  target_date date,
  delay_days integer not null default 0,
  active boolean not null default true,
  satisfied_at timestamptz,
  satisfied_by_event_id uuid references atlas.workflow_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_handoffs_source_kind_check check (
    source_kind in ('task','object','maintenance','crop_cycle','production_succession','field_log')
  ),
  constraint workflow_handoffs_effect_check check (
    effect in ('open_task','schedule_task','record_only')
  ),
  constraint workflow_handoffs_delay_days_check check (delay_days >= 0),
  constraint workflow_handoffs_source_selector_check check (
    source_id is not null or source_key is not null or source_filter <> '{}'::jsonb
  ),
  constraint workflow_handoffs_target_check check (
    effect = 'record_only' or target_task_id is not null
  ),
  constraint workflow_handoffs_stable_key_unique unique (farm_id, stable_key)
);

create index if not exists workflow_handoffs_pending_source_idx
  on atlas.workflow_handoffs (farm_id, source_kind, source_event, source_id, source_key)
  where active and satisfied_at is null;

create index if not exists workflow_handoffs_target_idx
  on atlas.workflow_handoffs (target_task_id)
  where target_task_id is not null;

alter table atlas.workflow_events enable row level security;
alter table atlas.workflow_handoffs enable row level security;

revoke all on atlas.workflow_events from public, anon, authenticated;
revoke all on atlas.workflow_handoffs from public, anon, authenticated;
grant select, insert, update, delete on atlas.workflow_events to service_role;
grant select, insert, update, delete on atlas.workflow_handoffs to service_role;

create or replace function atlas.apply_workflow_event_v1(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_event atlas.workflow_events%rowtype;
  v_handoff atlas.workflow_handoffs%rowtype;
  v_target atlas.tasks%rowtype;
  v_due_date date;
  v_transition jsonb;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  select * into v_event
  from atlas.workflow_events
  where id = p_event_id;

  if v_event.id is null then
    raise exception 'Workflow event was not found.' using errcode = 'P0002';
  end if;

  for v_handoff in
    select h.*
    from atlas.workflow_handoffs h
    where h.farm_id = v_event.farm_id
      and h.active
      and h.satisfied_at is null
      and h.source_kind = v_event.source_kind
      and h.source_event = v_event.source_event
      and (h.source_id is null or h.source_id = v_event.source_id)
      and (h.source_key is null or h.source_key = v_event.source_key)
      and (h.source_filter = '{}'::jsonb or v_event.payload @> h.source_filter)
    order by h.created_at, h.id
    for update skip locked
  loop
    update atlas.workflow_handoffs
    set satisfied_at = now(),
        satisfied_by_event_id = v_event.id,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'satisfaction_state', 'claimed',
          'satisfied_source_kind', v_event.source_kind,
          'satisfied_source_id', v_event.source_id,
          'satisfied_source_event', v_event.source_event,
          'satisfied_event_date', v_event.event_date
        )
    where id = v_handoff.id and satisfied_at is null;

    if not found then continue; end if;

    if v_handoff.effect = 'record_only' then
      v_applied := v_applied + 1;
      continue;
    end if;

    select * into v_target
    from atlas.tasks
    where id = v_handoff.target_task_id and farm_id = v_event.farm_id
    for update;

    if v_target.id is null or v_target.status in ('done','archived','skipped') then
      update atlas.workflow_handoffs
      set metadata = metadata || jsonb_build_object(
            'satisfaction_state', 'skipped_target_terminal_or_missing',
            'target_status', v_target.status
          ),
          updated_at = now()
      where id = v_handoff.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if lower(coalesce(v_handoff.metadata ->> 'mark_source_ready', 'false')) in ('true','yes','1') then
      update atlas.tasks
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'source_ready', true,
            'source_ready_at', now(),
            'source_ready_event_id', v_event.id,
            'source_ready_handoff_id', v_handoff.id,
            'workflow_gate_state', 'ready'
          ),
          blocker_text = null,
          updated_at = now()
      where id = v_target.id;
    end if;

    v_due_date := case
      when v_handoff.effect = 'open_task' then
        coalesce(v_target.due_date, v_handoff.target_date, v_event.event_date + v_handoff.delay_days, v_event.event_date)
      else
        coalesce(v_handoff.target_date, v_event.event_date + v_handoff.delay_days, v_target.due_date, v_event.event_date)
    end;

    if v_target.status = 'open' and v_target.due_date is not distinct from v_due_date then
      update atlas.workflow_handoffs
      set metadata = metadata || jsonb_build_object(
            'satisfaction_state', 'target_already_open',
            'resolved_due_date', v_due_date
          ),
          updated_at = now()
      where id = v_handoff.id;
      v_applied := v_applied + 1;
      continue;
    end if;

    v_transition := atlas.record_task_transition_v1_internal(
      v_target.id,
      'rescheduled',
      left('workflow:' || v_handoff.id::text || ':' || v_event.id::text, 160),
      v_due_date,
      coalesce(nullif(v_handoff.metadata ->> 'transition_note', ''), 'Opened by Atlas workflow handoff.'),
      coalesce(nullif(v_handoff.metadata ->> 'transition_reason', ''), 'Required prior farm work was recorded.'),
      'workflow',
      v_handoff.stable_key,
      jsonb_build_object(
        'completion_source', 'workflow_handoff',
        'workflow_event_id', v_event.id,
        'workflow_handoff_id', v_handoff.id,
        'source_kind', v_event.source_kind,
        'source_id', v_event.source_id,
        'source_event', v_event.source_event
      ),
      null
    );

    update atlas.workflow_handoffs
    set metadata = metadata || jsonb_build_object(
          'satisfaction_state', 'applied',
          'resolved_due_date', v_due_date,
          'target_transition_id', v_transition ->> 'transitionId'
        ),
        updated_at = now()
    where id = v_handoff.id;

    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('eventId', v_event.id, 'applied', v_applied, 'skipped', v_skipped);
end;
$function$;

create or replace function atlas.emit_workflow_event_v1(
  p_farm_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_source_key text,
  p_source_event text,
  p_event_date date,
  p_event_key text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_event_id uuid;
begin
  if p_farm_id is null or p_source_id is null then
    raise exception 'Workflow event requires farm and source ids.' using errcode = '22023';
  end if;
  if p_source_kind not in ('task','object','maintenance','crop_cycle','production_succession','field_log') then
    raise exception 'Unsupported workflow source kind: %', p_source_kind using errcode = '22023';
  end if;
  if nullif(btrim(p_source_event), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'Workflow event and event key are required.' using errcode = '22023';
  end if;

  insert into atlas.workflow_events (
    farm_id, event_key, source_kind, source_id, source_key, source_event, event_date, payload
  ) values (
    p_farm_id, left(p_event_key, 240), p_source_kind, p_source_id,
    nullif(btrim(p_source_key), ''), lower(btrim(p_source_event)),
    coalesce(p_event_date, (now() at time zone 'America/Chicago')::date),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (farm_id, event_key) do update
    set payload = atlas.workflow_events.payload || excluded.payload
  returning id into v_event_id;

  perform atlas.apply_workflow_event_v1(v_event_id);
  return v_event_id;
end;
$function$;

create or replace function atlas.emit_task_outcome_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_source_key text;
begin
  select coalesce(nullif(t.engine_instance_key, ''), nullif(t.task_series_key, ''), nullif(t.metadata ->> 'task_key', ''), t.id::text)
  into v_source_key from atlas.tasks t where t.id = new.task_id;

  perform atlas.emit_workflow_event_v1(
    new.farm_id, 'task', new.task_id, v_source_key, new.outcome,
    coalesce(new.due_date, (new.created_at at time zone 'America/Chicago')::date),
    'task-outcome:' || new.id::text,
    jsonb_build_object(
      'task_outcome_event_id', new.id, 'task_title', new.task_title,
      'task_type', new.task_type, 'work_key', new.work_key,
      'lane_key', new.lane_key, 'metadata', new.metadata
    )
  );
  return new;
end;
$function$;

drop trigger if exists trg_emit_task_outcome_workflow_event_v1 on atlas.task_outcome_events;
create trigger trg_emit_task_outcome_workflow_event_v1
after insert on atlas.task_outcome_events
for each row execute function atlas.emit_task_outcome_workflow_event_v1();

create or replace function atlas.emit_object_activity_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_source_key text;
begin
  select coalesce(nullif(go.stable_key, ''), go.id::text)
  into v_source_key from atlas.growing_objects go where go.id = new.object_id;

  perform atlas.emit_workflow_event_v1(
    new.farm_id, 'object', new.object_id, v_source_key, new.event_type, new.event_date,
    'object-activity:' || new.id::text,
    jsonb_build_object(
      'object_activity_event_id', new.id, 'field_log_id', new.field_log_id,
      'crop_cycle_id', new.crop_cycle_id, 'quantity', new.quantity,
      'unit', new.unit, 'metadata', new.metadata
    )
  );
  return new;
end;
$function$;

drop trigger if exists trg_emit_object_activity_workflow_event_v1 on atlas.object_activity_events;
create trigger trg_emit_object_activity_workflow_event_v1
after insert on atlas.object_activity_events
for each row execute function atlas.emit_object_activity_workflow_event_v1();

create or replace function atlas.emit_maintenance_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_source_key text;
begin
  select coalesce(nullif(go.stable_key, ''), new.maintenance_object_id::text)
  into v_source_key
  from atlas.maintenance_objects mo
  left join atlas.growing_objects go on go.id = mo.object_id
  where mo.id = new.maintenance_object_id;

  perform atlas.emit_workflow_event_v1(
    new.farm_id, 'maintenance', new.maintenance_object_id, v_source_key,
    lower(new.maintenance_type || ':' || new.outcome),
    coalesce((new.completed_at at time zone 'America/Chicago')::date, current_date),
    'maintenance-history:' || new.id::text,
    jsonb_build_object(
      'maintenance_history_id', new.id, 'object_id', new.object_id,
      'source_task_id', new.source_task_id, 'maintenance_type', new.maintenance_type,
      'outcome', new.outcome, 'condition_before', new.condition_before,
      'condition_after', new.condition_after, 'metadata', new.metadata
    )
  );
  return new;
end;
$function$;

drop trigger if exists trg_emit_maintenance_workflow_event_v1 on atlas.maintenance_history;
create trigger trg_emit_maintenance_workflow_event_v1
after insert on atlas.maintenance_history
for each row execute function atlas.emit_maintenance_workflow_event_v1();

create or replace function atlas.emit_field_log_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_action text;
begin
  perform atlas.emit_workflow_event_v1(
    new.farm_id, 'field_log', new.id, coalesce(nullif(new.idempotency_key, ''), new.id::text),
    'logged', new.log_date, 'field-log:' || new.id::text || ':logged',
    jsonb_build_object(
      'field_log_id', new.id, 'action_types', to_jsonb(coalesce(new.action_types, array[]::text[])),
      'source', new.source, 'metadata', new.metadata
    )
  );

  foreach v_action in array coalesce(new.action_types, array[]::text[]) loop
    if nullif(btrim(v_action), '') is not null then
      perform atlas.emit_workflow_event_v1(
        new.farm_id, 'field_log', new.id, coalesce(nullif(new.idempotency_key, ''), new.id::text),
        'action:' || lower(btrim(v_action)), new.log_date,
        'field-log:' || new.id::text || ':action:' || md5(lower(btrim(v_action))),
        jsonb_build_object(
          'field_log_id', new.id, 'action_type', lower(btrim(v_action)),
          'source', new.source, 'metadata', new.metadata
        )
      );
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists trg_emit_field_log_workflow_event_v1 on atlas.field_logs;
create trigger trg_emit_field_log_workflow_event_v1
after insert on atlas.field_logs
for each row execute function atlas.emit_field_log_workflow_event_v1();

create or replace function atlas.emit_crop_cycle_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_event_date date := coalesce(new.sown_date, new.planted_date, (new.updated_at at time zone 'America/Chicago')::date);
begin
  if tg_op = 'INSERT' or new.cycle_state is distinct from old.cycle_state then
    perform atlas.emit_workflow_event_v1(
      new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key,
      'cycle_state:' || lower(coalesce(new.cycle_state, 'unknown')), v_event_date,
      'crop-cycle:' || new.id::text || ':cycle-state:' || lower(coalesce(new.cycle_state, 'unknown')) || ':' || new.updated_at::text,
      jsonb_build_object('crop_cycle_id', new.id, 'cycle_state', new.cycle_state, 'lifecycle_status', new.lifecycle_status, 'metadata', new.metadata)
    );
  end if;

  if tg_op = 'INSERT' or new.lifecycle_status is distinct from old.lifecycle_status then
    perform atlas.emit_workflow_event_v1(
      new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key,
      'lifecycle_status:' || lower(coalesce(new.lifecycle_status, 'unknown')), v_event_date,
      'crop-cycle:' || new.id::text || ':lifecycle-status:' || lower(coalesce(new.lifecycle_status, 'unknown')) || ':' || new.updated_at::text,
      jsonb_build_object('crop_cycle_id', new.id, 'cycle_state', new.cycle_state, 'lifecycle_status', new.lifecycle_status, 'metadata', new.metadata)
    );
  end if;

  if new.sown_date is not null and (tg_op = 'INSERT' or old.sown_date is null or new.sown_date is distinct from old.sown_date) then
    perform atlas.emit_workflow_event_v1(new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key, 'sown', new.sown_date,
      'crop-cycle:' || new.id::text || ':sown:' || new.sown_date::text,
      jsonb_build_object('crop_cycle_id', new.id, 'object_id', new.object_id, 'crop_profile_id', new.crop_profile_id, 'metadata', new.metadata));
  end if;

  if new.planted_date is not null and (tg_op = 'INSERT' or old.planted_date is null or new.planted_date is distinct from old.planted_date) then
    perform atlas.emit_workflow_event_v1(new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key, 'planted', new.planted_date,
      'crop-cycle:' || new.id::text || ':planted:' || new.planted_date::text,
      jsonb_build_object('crop_cycle_id', new.id, 'object_id', new.object_id, 'crop_profile_id', new.crop_profile_id, 'metadata', new.metadata));
  end if;

  if new.germination_checked_date is not null and (tg_op = 'INSERT' or old.germination_checked_date is null or new.germination_checked_date is distinct from old.germination_checked_date) then
    perform atlas.emit_workflow_event_v1(new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key, 'germination_checked', new.germination_checked_date,
      'crop-cycle:' || new.id::text || ':germination-checked:' || new.germination_checked_date::text,
      jsonb_build_object('crop_cycle_id', new.id, 'object_id', new.object_id, 'crop_profile_id', new.crop_profile_id, 'metadata', new.metadata));
  end if;

  if new.harvest_started_date is not null and (tg_op = 'INSERT' or old.harvest_started_date is null or new.harvest_started_date is distinct from old.harvest_started_date) then
    perform atlas.emit_workflow_event_v1(new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key, 'harvest_started', new.harvest_started_date,
      'crop-cycle:' || new.id::text || ':harvest-started:' || new.harvest_started_date::text,
      jsonb_build_object('crop_cycle_id', new.id, 'object_id', new.object_id, 'crop_profile_id', new.crop_profile_id, 'metadata', new.metadata));
  end if;

  if new.cleared_date is not null and (tg_op = 'INSERT' or old.cleared_date is null or new.cleared_date is distinct from old.cleared_date) then
    perform atlas.emit_workflow_event_v1(new.farm_id, 'crop_cycle', new.id, new.crop_cycle_key, 'cleared', new.cleared_date,
      'crop-cycle:' || new.id::text || ':cleared:' || new.cleared_date::text,
      jsonb_build_object('crop_cycle_id', new.id, 'object_id', new.object_id, 'crop_profile_id', new.crop_profile_id, 'metadata', new.metadata));
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_emit_crop_cycle_workflow_event_v1 on atlas.crop_cycles;
create trigger trg_emit_crop_cycle_workflow_event_v1
after insert or update of cycle_state, lifecycle_status, sown_date, planted_date, germination_checked_date, harvest_started_date, cleared_date
on atlas.crop_cycles
for each row execute function atlas.emit_crop_cycle_workflow_event_v1();

create or replace function atlas.emit_production_succession_workflow_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm_id uuid;
  v_plan_key text;
  v_source_key text;
begin
  select pp.farm_id, pp.stable_key into v_farm_id, v_plan_key
  from atlas.production_plans pp where pp.id = new.production_plan_id;
  v_source_key := coalesce(v_plan_key, new.production_plan_id::text) || ':succession:' || new.sequence_number::text;

  if tg_op = 'INSERT' or new.state is distinct from old.state then
    perform atlas.emit_workflow_event_v1(
      v_farm_id, 'production_succession', new.id, v_source_key,
      'state:' || lower(coalesce(new.state, 'unknown')),
      coalesce(new.actual_sow_date, new.planned_window_start, (new.updated_at at time zone 'America/Chicago')::date),
      'production-succession:' || new.id::text || ':state:' || lower(coalesce(new.state, 'unknown')) || ':' || new.updated_at::text,
      jsonb_build_object('production_succession_id', new.id, 'production_plan_id', new.production_plan_id,
        'sequence_number', new.sequence_number, 'state', new.state, 'crop_cycle_id', new.crop_cycle_id,
        'sow_task_id', new.sow_task_id, 'metadata', new.metadata)
    );
  end if;

  if new.actual_sow_date is not null and (tg_op = 'INSERT' or old.actual_sow_date is null or new.actual_sow_date is distinct from old.actual_sow_date) then
    perform atlas.emit_workflow_event_v1(
      v_farm_id, 'production_succession', new.id, v_source_key, 'sown', new.actual_sow_date,
      'production-succession:' || new.id::text || ':sown:' || new.actual_sow_date::text,
      jsonb_build_object('production_succession_id', new.id, 'production_plan_id', new.production_plan_id,
        'sequence_number', new.sequence_number, 'crop_cycle_id', new.crop_cycle_id,
        'sow_task_id', new.sow_task_id, 'metadata', new.metadata)
    );
  end if;

  if new.crop_cycle_id is not null and (tg_op = 'INSERT' or old.crop_cycle_id is null or new.crop_cycle_id is distinct from old.crop_cycle_id) then
    perform atlas.emit_workflow_event_v1(
      v_farm_id, 'production_succession', new.id, v_source_key, 'crop_cycle_linked',
      coalesce(new.actual_sow_date, new.planned_window_start, (new.updated_at at time zone 'America/Chicago')::date),
      'production-succession:' || new.id::text || ':crop-cycle:' || new.crop_cycle_id::text,
      jsonb_build_object('production_succession_id', new.id, 'production_plan_id', new.production_plan_id,
        'crop_cycle_id', new.crop_cycle_id, 'sow_task_id', new.sow_task_id, 'metadata', new.metadata)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_emit_production_succession_workflow_event_v1 on atlas.production_successions;
create trigger trg_emit_production_succession_workflow_event_v1
after insert or update of state, actual_sow_date, crop_cycle_id
on atlas.production_successions
for each row execute function atlas.emit_production_succession_workflow_event_v1();

create or replace function atlas.guard_downstream_task_not_checklist_child_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'atlas'
as $function$
declare v_downstream boolean;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  v_downstream :=
    new.generated_from in ('cascade_trigger','task_follow_up','workflow_handoff','readiness_gate')
    or new.metadata ? 'trigger_condition'
    or new.metadata ? 'trigger_on_parent_status'
    or new.metadata ? 'source_task_id'
    or new.metadata ? 'source_cutting_task_id'
    or new.metadata ? 'source_purchase_task_id'
    or new.metadata ? 'source_sowing_task_id'
    or lower(coalesce(new.metadata ->> 'cascade_trigger', 'false')) in ('true','yes','1')
    or lower(coalesce(new.metadata ->> 'requires_source_ready', 'false')) in ('true','yes','1')
    or lower(coalesce(new.metadata ->> 'relationship_kind', '')) in ('downstream','handoff','readiness_gate');

  if v_downstream and (new.parent_task_id is not null or nullif(new.metadata ->> 'parent_task_id', '') is not null) then
    raise exception 'Downstream workflow tasks cannot use parent_task_id; use atlas.workflow_handoffs.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_downstream_task_not_checklist_child_v1 on atlas.tasks;
create trigger trg_guard_downstream_task_not_checklist_child_v1
before insert or update of parent_task_id, generated_from, metadata on atlas.tasks
for each row execute function atlas.guard_downstream_task_not_checklist_child_v1();

create or replace function atlas.create_delayed_followup_task()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_spec jsonb;
  v_delay_days integer;
  v_due_date date;
  v_zone_id uuid;
  v_object_key text;
  v_object_id uuid;
  v_followup_id uuid;
  v_instance_key text;
begin
  if new.status <> 'done' or old.status = 'done' then return new; end if;
  v_spec := coalesce(new.metadata -> 'follow_up_task', '{}'::jsonb);
  if jsonb_typeof(v_spec) <> 'object' or coalesce(v_spec ->> 'title', '') = '' then return new; end if;

  begin
    v_delay_days := greatest(0, coalesce((v_spec ->> 'delay_days')::integer, 0));
  exception when others then v_delay_days := 0;
  end;

  v_due_date := (coalesce(new.completed_at, now()) at time zone 'America/Chicago')::date + v_delay_days;
  select z.id into v_zone_id from atlas.zones z
  where z.farm_id = new.farm_id and z.stable_key = nullif(v_spec ->> 'zone_key', '') limit 1;
  v_instance_key := 'followup:' || new.id::text || ':' || md5(v_spec::text) || ':' || v_due_date::text;

  select t.id into v_followup_id from atlas.tasks t
  where t.farm_id = new.farm_id and t.engine_instance_key = v_instance_key limit 1;

  if v_followup_id is null then
    insert into atlas.tasks (
      farm_id, zone_id, title, task_type, status, priority, due_date,
      unlock_text, generated_from, generated_from_id, note, metadata,
      action_key, work_class, parent_task_id, task_series_key,
      engine_instance_key, assigned_membership_id, visibility_scope, updated_at
    ) values (
      new.farm_id, v_zone_id, v_spec ->> 'title',
      coalesce(nullif(v_spec ->> 'task_type', ''), 'general'), 'open',
      coalesce(nullif(v_spec ->> 'priority', ''), 'normal'), v_due_date,
      nullif(v_spec ->> 'unlock_text', ''), 'task_follow_up', new.id,
      nullif(v_spec ->> 'note', ''),
      (coalesce(v_spec -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'triggered_by_task_id', new.id, 'triggered_by_task_title', new.title,
        'triggered_at', now(), 'delay_days', v_delay_days,
        'assigned_to', coalesce(nullif(v_spec ->> 'assigned_to', ''), 'Anna'),
        'display_action', coalesce(nullif(v_spec ->> 'display_action', ''), 'Start'),
        'display_subject', coalesce(nullif(v_spec ->> 'display_subject', ''), v_spec ->> 'title'),
        'collection_zone', coalesce(nullif(v_spec ->> 'collection_zone', ''), 'Grow Room'),
        'work_route', coalesce(nullif(v_spec ->> 'action_key', ''), 'seed_starting'),
        'relationship_kind', 'downstream', 'source_task_id', new.id
      )),
      coalesce(nullif(v_spec ->> 'action_key', ''), 'seed_starting'),
      coalesce(nullif(v_spec ->> 'work_class', ''), 'standard'),
      null,
      coalesce(nullif(v_spec ->> 'series_key', ''), 'followup_' || new.id::text),
      v_instance_key, new.assigned_membership_id,
      coalesce(new.visibility_scope, 'farm_shared'), now()
    ) returning id into v_followup_id;

    v_object_key := nullif(v_spec ->> 'object_key', '');
    if v_object_key is not null then
      select go.id into v_object_id from atlas.growing_objects go
      where go.farm_id = new.farm_id and go.stable_key = v_object_key limit 1;
      if v_object_id is not null then
        insert into atlas.task_objects (task_id, object_id, role)
        values (v_followup_id, v_object_id, 'target')
        on conflict (task_id, object_id) do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$function$;
