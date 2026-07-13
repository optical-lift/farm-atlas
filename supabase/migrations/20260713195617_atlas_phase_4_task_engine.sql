-- Atlas Phase 4: canonical task identity and transactional task transitions.
--
-- The task is the action opportunity; the linked farm object is the physical
-- truth. One service-only RPC owns completion, checklist cascade, object
-- memory, field logging, project-step completion, and recurring-task creation.

alter table atlas.tasks
  add column if not exists action_key text,
  add column if not exists work_class text,
  add column if not exists parent_task_id uuid,
  add column if not exists task_series_key text,
  add column if not exists engine_instance_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_parent_task_id_fkey'
      and conrelid = 'atlas.tasks'::regclass
  ) then
    alter table atlas.tasks
      add constraint tasks_parent_task_id_fkey
      foreign key (parent_task_id) references atlas.tasks(id) on delete set null;
  end if;
end
$$;

create index if not exists tasks_parent_task_id_idx
  on atlas.tasks (parent_task_id, status, due_date);

create index if not exists tasks_action_schedule_idx
  on atlas.tasks (farm_id, action_key, status, due_date);

create index if not exists tasks_series_schedule_idx
  on atlas.tasks (farm_id, task_series_key, due_date)
  where task_series_key is not null;

create unique index if not exists tasks_active_engine_instance_idx
  on atlas.tasks (farm_id, engine_instance_key)
  where engine_instance_key is not null
    and status in ('open', 'blocked');

create or replace function atlas.derive_task_engine_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_parent_text text;
  v_identity_part text;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  new.action_key := nullif(btrim(coalesce(
    new.action_key,
    new.metadata ->> 'action_key',
    new.metadata ->> 'work_route',
    new.task_type,
    'general'
  )), '');

  new.work_class := nullif(btrim(coalesce(
    new.work_class,
    new.metadata ->> 'work_class',
    new.metadata ->> 'effort_band',
    new.metadata ->> 'condition',
    'standard'
  )), '');

  new.task_series_key := nullif(btrim(coalesce(
    new.task_series_key,
    new.metadata ->> 'recurrence_series_key',
    new.metadata ->> 'recurring_series_key',
    new.metadata ->> 'trigger_sequence_key'
  )), '');

  if new.parent_task_id is null then
    v_parent_text := nullif(btrim(new.metadata ->> 'parent_task_id'), '');
    if v_parent_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and v_parent_text::uuid <> new.id
      and exists (select 1 from atlas.tasks p where p.id = v_parent_text::uuid)
    then
      new.parent_task_id := v_parent_text::uuid;
    end if;
  end if;

  if new.engine_instance_key is null
    and new.generated_from is not null
    and new.generated_from_id is not null
    and new.due_date is not null
  then
    v_identity_part := coalesce(
      nullif(new.metadata ->> 'followup_task_key', ''),
      nullif(new.metadata ->> 'collection_member_key', ''),
      nullif(new.metadata ->> 'task_key', ''),
      md5(lower(btrim(new.title)))
    );
    new.engine_instance_key := concat_ws(
      ':',
      new.generated_from,
      new.generated_from_id::text,
      v_identity_part,
      new.due_date::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_derive_task_engine_fields on atlas.tasks;
create trigger trg_derive_task_engine_fields
before insert or update of task_type, due_date, generated_from, generated_from_id, metadata,
  action_key, work_class, parent_task_id, task_series_key, engine_instance_key
on atlas.tasks
for each row execute function atlas.derive_task_engine_fields();

update atlas.tasks t
set
  action_key = nullif(btrim(coalesce(
    t.action_key,
    t.metadata ->> 'action_key',
    t.metadata ->> 'work_route',
    t.task_type,
    'general'
  )), ''),
  work_class = nullif(btrim(coalesce(
    t.work_class,
    t.metadata ->> 'work_class',
    t.metadata ->> 'effort_band',
    t.metadata ->> 'condition',
    'standard'
  )), ''),
  task_series_key = nullif(btrim(coalesce(
    t.task_series_key,
    t.metadata ->> 'recurrence_series_key',
    t.metadata ->> 'recurring_series_key',
    t.metadata ->> 'trigger_sequence_key'
  )), ''),
  engine_instance_key = case
    when t.engine_instance_key is not null then t.engine_instance_key
    when t.generated_from is not null
      and t.generated_from_id is not null
      and t.due_date is not null
      and t.status in ('open', 'blocked')
    then concat_ws(
      ':',
      t.generated_from,
      t.generated_from_id::text,
      coalesce(
        nullif(t.metadata ->> 'followup_task_key', ''),
        nullif(t.metadata ->> 'collection_member_key', ''),
        nullif(t.metadata ->> 'task_key', ''),
        md5(lower(btrim(t.title)))
      ),
      t.due_date::text
    )
    else null
  end,
  updated_at = t.updated_at;

update atlas.tasks child
set parent_task_id = parent.id,
    updated_at = child.updated_at
from atlas.tasks parent
where child.parent_task_id is null
  and child.metadata ->> 'parent_task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and parent.id = (child.metadata ->> 'parent_task_id')::uuid
  and parent.id <> child.id;

-- Phase 4 owns parent/child transitions inside record_task_transition_v1().
-- Retire the legacy after-update cascade so every child completion receives
-- the same audit row, object updates, and structured-capture behavior.
drop trigger if exists trg_complete_child_checklist_when_parent_done on atlas.tasks;
drop function if exists atlas.complete_child_checklist_when_parent_done();

alter table atlas.task_outcome_events
  drop constraint if exists task_outcome_events_outcome_check;

alter table atlas.task_outcome_events
  add constraint task_outcome_events_outcome_check
  check (outcome in (
    'done', 'partial', 'blocked', 'not_relevant', 'changed_plan',
    'rescheduled', 'unfinished', 'reopened'
  ));

create table if not exists atlas.task_transitions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  transition text not null check (transition in (
    'done', 'partial', 'blocked', 'not_relevant', 'changed_plan',
    'rescheduled', 'unfinished', 'checklist_done', 'checklist_open', 'note'
  )),
  previous_status text,
  next_status text,
  previous_due_date date,
  target_date date,
  action_key text,
  work_class text,
  note text,
  reason text,
  field_log_id uuid references atlas.field_logs(id) on delete set null,
  task_outcome_event_id uuid references atlas.task_outcome_events(id) on delete set null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by text not null default 'atlas_phase_4',
  created_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create index if not exists task_transitions_task_timeline_idx
  on atlas.task_transitions (task_id, created_at desc);

create index if not exists task_transitions_field_log_idx
  on atlas.task_transitions (field_log_id)
  where field_log_id is not null;

alter table atlas.task_transitions enable row level security;
revoke all on table atlas.task_transitions from public, anon, authenticated;
grant select, insert, update on table atlas.task_transitions to service_role;

create or replace function atlas.bridge_task_outcome_to_maintenance()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
declare
  v_object_id uuid;
  v_maintenance_id uuid;
  v_result jsonb;
  v_actual integer;
  v_action_key text;
begin
  select coalesce(t.action_key, t.metadata ->> 'work_route', t.task_type)
  into v_action_key
  from atlas.tasks t
  where t.id = new.task_id;

  if lower(coalesce(v_action_key, '')) not in ('weed', 'weeding') then
    return new;
  end if;

  if new.outcome not in ('done', 'partial') then
    return new;
  end if;

  begin
    v_actual := nullif(new.metadata ->> 'actual_minutes', '')::integer;
  exception when others then
    v_actual := null;
  end;

  for v_object_id in
    select tx.object_id
    from atlas.task_objects tx
    where tx.task_id = new.task_id
  loop
    select mo.id into v_maintenance_id
    from atlas.maintenance_objects mo
    where mo.object_id = v_object_id
      and mo.maintenance_type = 'weed'
      and mo.active = true
    limit 1;

    if v_maintenance_id is not null then
      v_result := atlas.record_maintenance_completion(
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

create or replace function atlas.record_task_transition_v1(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_lane_key text default null,
  p_work_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_now timestamptz := now();
  v_today date := current_date;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_note text := nullif(btrim(p_note), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_lane text := nullif(btrim(p_lane_key), '');
  v_work text := nullif(btrim(p_work_key), '');
  v_action text;
  v_work_class text;
  v_next_status text;
  v_event_outcome text;
  v_metadata jsonb;
  v_field_log_id uuid := p_existing_field_log_id;
  v_outcome_event_id uuid;
  v_transition_id uuid;
  v_object_ids uuid[] := '{}';
  v_child_ids uuid[] := '{}';
  v_child_count integer := 0;
  v_next_task_id uuid;
  v_next_due date;
  v_repeat_days integer;
  v_minimum_days integer := 1;
  v_weekday integer;
  v_series_key text;
  v_instance_key text;
  v_object_event_type text;
  v_logs_work boolean;
  v_child record;
  v_object record;
  v_completion_source text;
  v_planting_required boolean := false;
  v_planted_amount numeric;
  v_planted_unit text;
  v_planting_method text;
  v_crop_label text;
  v_variety text;
  v_crop_profile_id uuid;
  v_placement_object_id uuid;
  v_placement_zone_id uuid;
  v_placement_label text;
  v_planting_claim_id uuid;
  v_object_content_id uuid;
  v_object_event_id uuid;
  v_planting_summary text;
  v_value_text text;
begin
  if p_task_id is null then
    raise exception 'Task id is required.' using errcode = '22023';
  end if;

  if p_transition not in (
    'done', 'partial', 'blocked', 'not_relevant', 'changed_plan',
    'rescheduled', 'unfinished', 'checklist_done', 'checklist_open', 'note'
  ) then
    raise exception 'Unsupported task transition: %', p_transition using errcode = '22023';
  end if;

  if v_key is null or length(v_key) > 160 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Note must be 4000 characters or fewer.' using errcode = '22023';
  end if;

  if p_payload is null then
    p_payload := '{}'::jsonb;
  elsif jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Task transition payload must be a JSON object.' using errcode = '22023';
  end if;

  if p_transition in ('rescheduled', 'unfinished') and p_target_date is null then
    raise exception 'A target date is required for this transition.' using errcode = '22023';
  end if;

  select * into v_task
  from atlas.tasks t
  where t.id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text || ':' || v_key, 0));

  select * into v_existing
  from atlas.task_transitions tt
  where tt.farm_id = v_task.farm_id
    and tt.idempotency_key = v_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'transitionId', v_existing.id,
      'taskId', v_existing.task_id,
      'status', v_existing.next_status,
      'fieldLogId', v_existing.field_log_id,
      'taskOutcomeEventId', v_existing.task_outcome_event_id,
      'childTaskIds', coalesce(v_existing.payload -> 'child_task_ids', '[]'::jsonb),
      'nextTaskId', v_existing.payload ->> 'next_task_id',
      'deduplicated', true
    );
  end if;

  if p_existing_field_log_id is not null and not exists (
    select 1 from atlas.field_logs fl
    where fl.id = p_existing_field_log_id
      and fl.farm_id = v_task.farm_id
  ) then
    raise exception 'Existing field log does not belong to this farm.' using errcode = '22023';
  end if;

  v_action := coalesce(nullif(v_task.action_key, ''), nullif(v_task.metadata ->> 'work_route', ''), v_task.task_type, 'general');
  v_work_class := coalesce(nullif(v_task.work_class, ''), nullif(v_task.metadata ->> 'effort_band', ''), 'standard');
  v_metadata := coalesce(v_task.metadata, '{}'::jsonb) || jsonb_build_object(
    'last_transition', jsonb_build_object(
      'transition', p_transition,
      'note', v_note,
      'reason', v_reason,
      'target_date', p_target_date,
      'action_key', v_action,
      'work_class', v_work_class,
      'recorded_at', v_now,
      'idempotency_key', v_key
    ),
    'transition_count', case
      when coalesce(v_task.metadata ->> 'transition_count', '') ~ '^\d+$'
        then (v_task.metadata ->> 'transition_count')::integer + 1
      else 1
    end
  );

  select coalesce(array_agg(tro.object_id order by tro.object_id), '{}')
  into v_object_ids
  from atlas.task_objects tro
  where tro.task_id = v_task.id;

  v_completion_source := coalesce(nullif(p_payload ->> 'completion_source', ''), 'checklist');
  v_planting_required := p_transition = 'checklist_done'
    and lower(coalesce(v_task.metadata ->> 'planting_log_required', 'false')) in ('true', 'yes', '1')
    and v_task.metadata -> 'planting_log' is null;

  if v_planting_required then
    v_value_text := coalesce(
      nullif(p_payload ->> 'plantedAmount', ''),
      nullif(v_task.metadata ->> 'planting_log_default_amount', '')
    );
    if v_value_text ~ '^\d+(\.\d+)?$' then
      v_planted_amount := v_value_text::numeric;
    end if;

    v_value_text := coalesce(
      nullif(p_payload ->> 'plantedObjectId', ''),
      nullif(v_task.metadata ->> 'planting_log_default_object_id', '')
    );
    if v_value_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_placement_object_id := v_value_text::uuid;
    end if;

    v_value_text := coalesce(
      nullif(p_payload ->> 'plantedZoneId', ''),
      nullif(v_task.metadata ->> 'planting_log_default_zone_id', '')
    );
    if v_value_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_placement_zone_id := v_value_text::uuid;
    end if;

    if v_placement_object_id is not null then
      select go.zone_id, go.label
      into v_placement_zone_id, v_placement_label
      from atlas.growing_objects go
      where go.id = v_placement_object_id
        and go.farm_id = v_task.farm_id;

      if v_placement_label is null then
        raise exception 'Selected bed was not found.' using errcode = '22023';
      end if;
    elsif v_placement_zone_id is not null then
      select z.label into v_placement_label
      from atlas.zones z
      where z.id = v_placement_zone_id
        and z.farm_id = v_task.farm_id;
    end if;

    v_placement_label := coalesce(
      nullif(p_payload ->> 'plantedLocation', ''),
      v_placement_label,
      nullif(v_task.metadata ->> 'planting_log_default_location', ''),
      nullif(v_task.metadata ->> 'display_detail', '')
    );

    if v_planted_amount is null
      or v_placement_zone_id is null
      or (
        lower(coalesce(v_task.metadata ->> 'planting_log_object_required', 'true')) not in ('false', 'no', '0')
        and v_placement_object_id is null
      )
    then
      if v_completion_source <> 'parent_attestation' then
        raise exception 'Count, zone, and real bed are required before completing this planting step.' using errcode = '22023';
      end if;

      v_metadata := v_metadata || jsonb_build_object(
        'structured_capture_status', 'attested_without_structured_capture'
      );
    else
      v_crop_label := coalesce(nullif(v_task.metadata ->> 'planting_log_crop_label', ''), 'Plant');
      v_variety := coalesce(
        nullif(v_task.metadata ->> 'planting_log_variety', ''),
        nullif(v_task.metadata ->> 'checklist_label', ''),
        v_task.title
      );
      v_planted_unit := coalesce(nullif(v_task.metadata ->> 'planting_log_unit', ''), 'plants');
      v_planting_method := lower(coalesce(nullif(v_task.metadata ->> 'planting_method', ''), 'transplant'));
      if v_planting_method not in ('direct_sow', 'transplant', 'clump', 'division', 'start', 'bulb', 'seed_scatter', 'full_bed_claim') then
        v_planting_method := 'transplant';
      end if;

      select cp.id into v_crop_profile_id
      from atlas.crop_profiles cp
      where lower(cp.crop_label) = lower(v_crop_label)
      order by case when lower(coalesce(cp.variety, '')) = lower(coalesce(v_variety, '')) then 0 else 1 end
      limit 1;

      v_planting_summary := 'Planted ' || v_planted_amount::text || ' ' || v_planted_unit || ' ' || v_variety || ' in ' || v_placement_label;

      insert into atlas.field_logs (
        farm_id, log_date, action_types, summary_sentence, note,
        created_by, source, metadata
      ) values (
        v_task.farm_id, v_today, array['plant', 'planting', 'checklist'],
        v_planting_summary, v_planting_summary, 'atlas_phase_4',
        'atlas_task_engine', jsonb_build_object(
          'version', 'task_transition_v1',
          'task_id', v_task.id,
          'parent_task_id', v_task.parent_task_id,
          'crop_label', v_crop_label,
          'variety', v_variety,
          'amount', v_planted_amount,
          'unit', v_planted_unit,
          'location', v_placement_label,
          'zone_id', v_placement_zone_id,
          'object_id', v_placement_object_id
        )
      ) returning id into v_field_log_id;

      insert into atlas.planting_claims (
        farm_id, field_log_id, crop_profile_id, crop_label, variety,
        planted_date, planting_method, amount, unit, status,
        confidence, note, metadata
      ) values (
        v_task.farm_id, v_field_log_id, v_crop_profile_id, v_crop_label,
        v_variety, v_today, v_planting_method, v_planted_amount,
        v_planted_unit, 'planted', 'field_logged', v_planting_summary,
        jsonb_build_object(
          'task_id', v_task.id,
          'parent_task_id', v_task.parent_task_id,
          'location', v_placement_label,
          'zone_id', v_placement_zone_id,
          'object_id', v_placement_object_id,
          'completion_source', v_completion_source
        )
      ) returning id into v_planting_claim_id;

      if v_placement_object_id is not null then
        insert into atlas.planting_claim_objects (
          planting_claim_id, object_id, coverage_kind, coverage_amount, coverage_unit
        ) values (
          v_planting_claim_id, v_placement_object_id, 'whole_object',
          v_planted_amount, v_planted_unit
        );

        insert into atlas.object_contents (
          farm_id, object_id, planting_claim_id, crop_profile_id,
          content_label, content_type, variety, planted_date, status,
          confidence, start_method, note, metadata
        ) values (
          v_task.farm_id, v_placement_object_id, v_planting_claim_id,
          v_crop_profile_id, v_crop_label, 'planting', v_variety,
          v_today, 'planted', 'field_logged', v_planting_method,
          v_planting_summary, jsonb_build_object(
            'task_id', v_task.id,
            'parent_task_id', v_task.parent_task_id,
            'amount', v_planted_amount,
            'unit', v_planted_unit,
            'location', v_placement_label
          )
        ) returning id into v_object_content_id;

        insert into atlas.object_activity_events (
          farm_id, object_id, object_content_id, field_log_id,
          event_type, event_date, note, quantity, unit,
          created_by, source, idempotency_key, metadata
        ) values (
          v_task.farm_id, v_placement_object_id, v_object_content_id,
          v_field_log_id, 'planted', v_today, v_planting_summary,
          v_planted_amount, v_planted_unit, 'atlas_phase_4',
          'atlas_task_engine', left(v_key, 110) || ':planting',
          jsonb_build_object(
            'task_id', v_task.id,
            'parent_task_id', v_task.parent_task_id,
            'planting_claim_id', v_planting_claim_id,
            'completion_source', v_completion_source
          )
        ) returning id into v_object_event_id;

        if not (v_placement_object_id = any(v_object_ids)) then
          v_object_ids := array_append(v_object_ids, v_placement_object_id);
        end if;

        insert into atlas.object_state (
          object_id, farm_id, life_status, weed_pressure, water_status,
          last_touched_at, last_checked_at, decision_required,
          harvest_confidence, presentability, metadata
        ) values (
          v_placement_object_id, v_task.farm_id, 'planted', 'unknown',
          'unknown', v_today, v_today, false, 'unknown', 'unknown',
          jsonb_build_object(
            'last_task_id', v_task.id,
            'last_planting_claim_id', v_planting_claim_id,
            'last_object_event_id', v_object_event_id
          )
        ) on conflict (object_id) do update set
          life_status = 'planted',
          last_touched_at = greatest(coalesce(atlas.object_state.last_touched_at, excluded.last_touched_at), excluded.last_touched_at),
          last_checked_at = greatest(coalesce(atlas.object_state.last_checked_at, excluded.last_checked_at), excluded.last_checked_at),
          metadata = atlas.object_state.metadata || excluded.metadata,
          updated_at = v_now;
      end if;

      v_metadata := v_metadata || jsonb_build_object(
        'planting_log', jsonb_build_object(
          'summary', v_planting_summary,
          'crop_label', v_crop_label,
          'variety', v_variety,
          'amount', v_planted_amount,
          'unit', v_planted_unit,
          'location', v_placement_label,
          'zone_id', v_placement_zone_id,
          'object_id', v_placement_object_id,
          'field_log_id', v_field_log_id,
          'planting_claim_id', v_planting_claim_id,
          'object_content_id', v_object_content_id,
          'object_event_id', v_object_event_id,
          'recorded_at', v_now
        ),
        'structured_capture_status', 'recorded'
      );
    end if;
  end if;

  v_next_status := case
    when p_transition in ('done', 'checklist_done') then 'done'
    when p_transition = 'blocked' then 'blocked'
    when p_transition in ('not_relevant', 'changed_plan') then 'archived'
    when p_transition = 'note' then v_task.status
    else 'open'
  end;

  v_event_outcome := case
    when p_transition = 'checklist_done' then 'done'
    when p_transition = 'checklist_open' then 'reopened'
    else p_transition
  end;

  if p_transition = 'checklist_done' then
    v_metadata := v_metadata || jsonb_build_object(
      'checklist_status', 'done',
      'checklist_completed_at', v_now,
      'completion_source', coalesce(p_payload ->> 'completion_source', 'checklist')
    );
  elsif p_transition = 'checklist_open' then
    v_metadata := v_metadata || jsonb_build_object(
      'checklist_status', 'open',
      'checklist_completed_at', null,
      'completion_source', null
    );
  end if;

  -- Complete children through this same transition engine before closing the
  -- parent. This preserves one auditable transition per checklist item and
  -- lets planting children perform their structured capture atomically.
  if p_transition = 'done' then
    for v_child in
      select c.*
      from atlas.tasks c
      where (c.parent_task_id = v_task.id or c.metadata ->> 'parent_task_id' = v_task.id::text)
        and c.status <> 'archived'
        and not (
          c.status = 'done'
          or coalesce(c.metadata ->> 'checklist_status', '') = 'done'
        )
      for update
    loop
      perform atlas.record_task_transition_v1(
        v_child.id,
        'checklist_done',
        left(v_key, 110) || ':child:' || v_child.id::text,
        null,
        null,
        null,
        'checklist',
        'parent_done',
        jsonb_build_object(
          'completion_source', 'parent_attestation',
          'parent_task_id', v_task.id
        ),
        null
      );

      v_child_ids := array_append(v_child_ids, v_child.id);
      v_child_count := v_child_count + 1;
    end loop;
  end if;

  update atlas.tasks t
  set
    status = v_next_status,
    due_date = case when p_transition in ('rescheduled', 'unfinished') then p_target_date else t.due_date end,
    completed_at = case when v_next_status = 'done' then v_now when v_next_status = 'open' then null else t.completed_at end,
    completed_by = case when v_next_status = 'done' then 'atlas_phase_4' when v_next_status = 'open' then null else t.completed_by end,
    blocker_text = case when p_transition = 'blocked' then coalesce(v_reason, v_note, 'Blocked') when v_next_status = 'open' then null else t.blocker_text end,
    note = case when v_note is not null then v_note else t.note end,
    metadata = v_metadata,
    updated_at = v_now
  where t.id = v_task.id;

  if p_transition in ('rescheduled', 'unfinished') then
    update atlas.tasks c
    set due_date = p_target_date,
        updated_at = v_now
    where (c.parent_task_id = v_task.id or c.metadata ->> 'parent_task_id' = v_task.id::text)
      and c.status in ('open', 'blocked')
      and coalesce(c.metadata ->> 'checklist_status', 'open') <> 'done';
  end if;

  if p_transition = 'checklist_open' and v_task.parent_task_id is not null then
    update atlas.tasks parent
    set status = 'open',
        completed_at = null,
        completed_by = null,
        metadata = coalesce(parent.metadata, '{}'::jsonb) || jsonb_build_object(
          'reopened_by_child_task_id', v_task.id,
          'reopened_at', v_now
        ),
        updated_at = v_now
    where parent.id = v_task.parent_task_id
      and parent.status = 'done';
  end if;

  if p_transition <> 'note' then
    insert into atlas.task_outcome_events (
      farm_id, task_id, outcome, lane_key, work_key, blocker_reason, note,
      task_title, task_type, zone_id, due_date, priority, source, metadata
    ) values (
      v_task.farm_id, v_task.id, v_event_outcome, v_lane, coalesce(v_work, v_action),
      case when p_transition = 'blocked' then coalesce(v_reason, v_note) end,
      v_note, v_task.title, v_task.task_type, v_task.zone_id, v_task.due_date,
      v_task.priority, 'atlas_task_engine',
      jsonb_build_object(
        'version', 'task_transition_v1',
        'transition', p_transition,
        'prior_status', v_task.status,
        'object_ids', to_jsonb(v_object_ids),
        'child_task_ids', to_jsonb(v_child_ids),
        'target_date', p_target_date,
        'actual_minutes', p_payload -> 'actual_minutes'
      )
    ) returning id into v_outcome_event_id;
  end if;

  v_logs_work := p_transition in ('done', 'partial') and p_transition not in ('checklist_done', 'checklist_open');

  if v_logs_work and v_field_log_id is null then
    insert into atlas.field_logs (
      farm_id, log_date, action_types, summary_sentence, note,
      created_by, source, metadata
    ) values (
      v_task.farm_id,
      v_today,
      array[v_action, case when p_transition = 'done' then 'completed' else 'partial' end],
      initcap(replace(v_action, '_', ' ')) || ' · ' || v_task.title,
      v_note,
      'atlas_phase_4',
      'atlas_task_engine',
      jsonb_build_object(
        'version', 'task_transition_v1',
        'task_id', v_task.id,
        'task_outcome_event_id', v_outcome_event_id,
        'transition', p_transition,
        'action_key', v_action,
        'work_class', v_work_class,
        'object_ids', to_jsonb(v_object_ids)
      )
    ) returning id into v_field_log_id;
  end if;

  if v_field_log_id is not null then
    if cardinality(v_object_ids) > 0 then
      insert into atlas.field_log_objects (field_log_id, zone_id, object_id, role)
      select v_field_log_id, go.zone_id, go.id, 'task_object'
      from atlas.growing_objects go
      where go.id = any(v_object_ids)
      on conflict do nothing;
    elsif v_task.zone_id is not null then
      insert into atlas.field_log_objects (field_log_id, zone_id, object_id, role)
      select v_field_log_id, v_task.zone_id, null, 'task_zone'
      where not exists (
        select 1 from atlas.field_log_objects flo
        where flo.field_log_id = v_field_log_id
          and flo.zone_id = v_task.zone_id
          and flo.object_id is null
      );
    end if;
  end if;

  v_object_event_type := case
    when lower(v_action) in ('weed', 'weeding') then 'weeded'
    when lower(v_action) in ('water', 'watering') then 'watered'
    when lower(v_action) in ('mow', 'mowing', 'maintain', 'maintenance') then 'maintained'
    when lower(v_action) in ('check', 'checked', 'crop_cycle', 'observe', 'observed') then 'checked'
    when lower(v_action) in ('harvest', 'harvested') then 'harvested'
    else null
  end;

  if v_logs_work and v_object_event_type is not null then
    for v_object in
      select go.id, go.zone_id
      from atlas.growing_objects go
      where go.id = any(v_object_ids)
    loop
      insert into atlas.object_activity_events (
        farm_id, object_id, field_log_id, event_type, event_date, note,
        created_by, source, idempotency_key, metadata
      ) values (
        v_task.farm_id,
        v_object.id,
        v_field_log_id,
        v_object_event_type,
        v_today,
        v_note,
        'atlas_phase_4',
        'atlas_task_engine',
        left(v_key, 110) || ':object:' || v_object.id::text,
        jsonb_build_object(
          'version', 'task_transition_v1',
          'task_id', v_task.id,
          'task_outcome_event_id', v_outcome_event_id,
          'transition', p_transition,
          'action_key', v_action,
          'work_class', v_work_class
        )
      ) on conflict (farm_id, idempotency_key) where idempotency_key is not null do nothing;

      insert into atlas.object_state (
        object_id, farm_id, life_status, weed_pressure, water_status,
        last_touched_at, last_weeded_at, last_watered_at, last_checked_at,
        decision_required, harvest_confidence, presentability, metadata
      ) values (
        v_object.id,
        v_task.farm_id,
        'open',
        case when v_object_event_type = 'weeded' and p_transition = 'done' then 'maintained' else 'unknown' end,
        case when v_object_event_type = 'watered' then 'irrigated' else 'unknown' end,
        v_today,
        case when v_object_event_type = 'weeded' then v_today end,
        case when v_object_event_type = 'watered' then v_today end,
        case when v_object_event_type = 'checked' then v_today end,
        p_transition = 'blocked',
        'unknown',
        'unknown',
        jsonb_build_object(
          'last_task_transition_id', v_transition_id,
          'last_task_id', v_task.id,
          'last_task_action_key', v_action,
          'last_task_transition', p_transition,
          'last_task_touched_at', v_now
        )
      )
      on conflict (object_id) do update set
        last_touched_at = greatest(coalesce(atlas.object_state.last_touched_at, excluded.last_touched_at), excluded.last_touched_at),
        last_weeded_at = case when excluded.last_weeded_at is null then atlas.object_state.last_weeded_at else greatest(coalesce(atlas.object_state.last_weeded_at, excluded.last_weeded_at), excluded.last_weeded_at) end,
        last_watered_at = case when excluded.last_watered_at is null then atlas.object_state.last_watered_at else greatest(coalesce(atlas.object_state.last_watered_at, excluded.last_watered_at), excluded.last_watered_at) end,
        last_checked_at = case when excluded.last_checked_at is null then atlas.object_state.last_checked_at else greatest(coalesce(atlas.object_state.last_checked_at, excluded.last_checked_at), excluded.last_checked_at) end,
        weed_pressure = case when v_object_event_type = 'weeded' and p_transition = 'done' then 'maintained' else atlas.object_state.weed_pressure end,
        water_status = case when v_object_event_type = 'watered' then 'irrigated' else atlas.object_state.water_status end,
        decision_required = case when p_transition = 'blocked' then true when p_transition = 'done' then false else atlas.object_state.decision_required end,
        metadata = atlas.object_state.metadata || excluded.metadata,
        updated_at = v_now;
    end loop;
  end if;

  if v_next_status = 'done' then
    update atlas.project_steps
    set status = 'done', completed_at = v_now, updated_at = v_now
    where linked_task_id = v_task.id;
  end if;

  if p_transition = 'done'
    and lower(coalesce(v_task.metadata ->> 'recreate_on_done', 'false')) in ('true', 'yes', '1')
  then
    begin
      v_repeat_days := coalesce(
        nullif(v_task.metadata ->> 'recreate_after_days', '')::integer,
        nullif(v_task.metadata ->> 'repeat_after_days', '')::integer
      );
    exception when others then
      v_repeat_days := null;
    end;

    begin
      v_minimum_days := greatest(1, coalesce(
        nullif(v_task.metadata ->> 'minimum_days_between_recurrences', '')::integer,
        nullif(v_task.metadata ->> 'min_days_since_last_mow', '')::integer,
        1
      ));
    exception when others then
      v_minimum_days := 1;
    end;

    v_weekday := case lower(coalesce(v_task.metadata ->> 'recreate_weekday', v_task.metadata ->> 'repeat_anchor_day', ''))
      when 'sunday' then 0 when '0' then 0
      when 'monday' then 1 when '1' then 1
      when 'tuesday' then 2 when '2' then 2
      when 'wednesday' then 3 when '3' then 3
      when 'thursday' then 4 when '4' then 4
      when 'friday' then 5 when '5' then 5
      when 'saturday' then 6 when '6' then 6
      else null
    end;

    if v_weekday is not null then
      v_next_due := v_today + v_minimum_days;
      while extract(dow from v_next_due)::integer <> v_weekday loop
        v_next_due := v_next_due + 1;
      end loop;
    elsif v_repeat_days is not null and v_repeat_days > 0 then
      v_next_due := v_today + v_repeat_days;
    end if;

    if v_next_due is not null then
      v_series_key := coalesce(
        nullif(v_task.task_series_key, ''),
        nullif(v_task.metadata ->> 'recurrence_series_key', ''),
        v_task.id::text
      );
      v_instance_key := 'recurring:' || v_series_key || ':' || v_next_due::text;

      select t.id into v_next_task_id
      from atlas.tasks t
      where t.farm_id = v_task.farm_id
        and t.engine_instance_key = v_instance_key
        and t.status in ('open', 'blocked')
      limit 1;

      if v_next_task_id is null then
        insert into atlas.tasks (
          farm_id, zone_id, title, task_type, status, priority, due_date,
          unlock_text, blocker_text, generated_from, generated_from_id,
          note, metadata, action_key, work_class, task_series_key,
          engine_instance_key, updated_at
        ) values (
          v_task.farm_id, v_task.zone_id, v_task.title, v_task.task_type,
          'open', v_task.priority, v_next_due, v_task.unlock_text, null,
          'recurring_task', v_task.id, v_task.note,
          (coalesce(v_task.metadata, '{}'::jsonb) - 'last_transition') || jsonb_build_object(
            'recurring_parent_task_id', v_task.id,
            'recurrence_series_key', v_series_key,
            'recreated_from_completed_at', v_now,
            'previous_due_date', v_task.due_date
          ),
          v_action, v_work_class, v_series_key, v_instance_key, v_now
        ) returning id into v_next_task_id;

        insert into atlas.task_objects (task_id, object_id, role)
        select v_next_task_id, tro.object_id, tro.role
        from atlas.task_objects tro
        where tro.task_id = v_task.id
        on conflict (task_id, object_id) do nothing;

        insert into atlas.task_resource_requirements (
          task_id, resource_id, template_id, requirement_role,
          requirement_source, quantity_needed, unit, status, note, metadata
        )
        select
          v_next_task_id, trr.resource_id, trr.template_id, trr.requirement_role,
          trr.requirement_source, trr.quantity_needed, trr.unit,
          case when trr.status = 'used' then 'needed' else trr.status end,
          trr.note, trr.metadata
        from atlas.task_resource_requirements trr
        where trr.task_id = v_task.id;
      end if;
    end if;
  end if;

  insert into atlas.task_transitions (
    farm_id, task_id, transition, previous_status, next_status,
    previous_due_date, target_date, action_key, work_class,
    note, reason, field_log_id, task_outcome_event_id,
    idempotency_key, payload
  ) values (
    v_task.farm_id, v_task.id, p_transition, v_task.status, v_next_status,
    v_task.due_date, p_target_date, v_action, v_work_class,
    v_note, v_reason, v_field_log_id, v_outcome_event_id,
    v_key,
    p_payload || jsonb_build_object(
      'object_ids', to_jsonb(v_object_ids),
      'child_task_ids', to_jsonb(v_child_ids),
      'children_closed', v_child_count,
      'next_task_id', v_next_task_id
    )
  ) returning id into v_transition_id;

  if v_logs_work and cardinality(v_object_ids) > 0 then
    update atlas.object_state os
    set metadata = os.metadata || jsonb_build_object('last_task_transition_id', v_transition_id),
        updated_at = v_now
    where os.object_id = any(v_object_ids);
  end if;

  return jsonb_build_object(
    'transitionId', v_transition_id,
    'taskId', v_task.id,
    'status', v_next_status,
    'fieldLogId', v_field_log_id,
    'taskOutcomeEventId', v_outcome_event_id,
    'childTaskIds', to_jsonb(v_child_ids),
    'childrenClosed', v_child_count,
    'nextTaskId', v_next_task_id,
    'deduplicated', false
  );
end;
$$;

revoke all on function atlas.record_task_transition_v1(
  uuid, text, text, date, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function atlas.record_task_transition_v1(
  uuid, text, text, date, text, text, text, text, jsonb, uuid
) to service_role;

create or replace view atlas.v_task_cards
with (security_invoker = true)
as
select
  f.stable_key as farm_key,
  t.id as task_id,
  t.title,
  t.task_type,
  t.status,
  t.priority,
  t.due_date,
  t.unlock_text,
  t.blocker_text,
  t.note,
  t.generated_from,
  t.generated_from_id,
  t.created_at,
  t.updated_at,
  z.id as zone_id,
  z.stable_key as zone_key,
  z.label as zone_label,
  coalesce(jsonb_agg(distinct jsonb_build_object(
    'object_id', go.id,
    'object_key', go.stable_key,
    'object_label', go.label,
    'object_type', go.object_type,
    'object_mode', go.object_mode,
    'life_status', os.life_status,
    'weed_pressure', os.weed_pressure,
    'water_status', os.water_status,
    'last_touched_at', os.last_touched_at,
    'last_weeded_at', os.last_weeded_at,
    'last_watered_at', os.last_watered_at,
    'last_checked_at', os.last_checked_at,
    'decision_required', os.decision_required,
    'presentability', os.presentability,
    'state_metadata', os.metadata
  )) filter (where go.id is not null), '[]'::jsonb) as objects,
  coalesce(jsonb_agg(distinct jsonb_build_object(
    'requirement_id', trr.id,
    'requirement_role', trr.requirement_role,
    'requirement_source', trr.requirement_source,
    'quantity_needed', trr.quantity_needed,
    'unit', trr.unit,
    'status', trr.status,
    'note', trr.note,
    'resource_key', r.stable_key,
    'resource_label', r.label,
    'resource_type', r.resource_type,
    'resource_category', r.resource_category,
    'resource_status', r.status,
    'resource_quantity', r.quantity,
    'resource_unit', r.unit,
    'condition_notes', r.condition_notes,
    'restock_needed', r.restock_needed
  )) filter (where trr.id is not null), '[]'::jsonb) as resource_requirements,
  coalesce(jsonb_agg(distinct jsonb_build_object(
    'template_id', art.id,
    'template_key', art.stable_key,
    'template_label', art.label,
    'action_type', art.action_type,
    'required_resource_categories', art.required_resource_categories,
    'optional_resource_categories', art.optional_resource_categories,
    'required_resource_keys', art.required_resource_keys,
    'optional_resource_keys', art.optional_resource_keys,
    'creates_follow_up_task_types', art.creates_follow_up_task_types,
    'hard_parts', art.hard_parts,
    'unlocks', art.unlocks,
    'card_language', art.metadata ->> 'card_language'
  )) filter (where art.id is not null), '[]'::jsonb) as action_templates,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'field_log_id', fl.id,
      'log_date', fl.log_date,
      'action_types', fl.action_types,
      'summary_sentence', fl.summary_sentence,
      'note', fl.note,
      'created_at', fl.created_at
    ) order by fl.created_at desc)
    from atlas.field_logs fl
    where fl.farm_id = t.farm_id
      and fl.metadata ->> 'task_id' = t.id::text
  ), '[]'::jsonb) as task_logs,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', toe.id,
      'outcome', toe.outcome,
      'lane_key', toe.lane_key,
      'work_key', toe.work_key,
      'blocker_reason', toe.blocker_reason,
      'note', toe.note,
      'created_at', toe.created_at
    ) order by toe.created_at desc)
    from atlas.task_outcome_events toe
    where toe.task_id = t.id
  ), '[]'::jsonb) as task_outcomes,
  t.metadata,
  t.action_key,
  t.work_class,
  t.parent_task_id,
  t.task_series_key,
  t.engine_instance_key,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'transition_id', tt.id,
      'transition', tt.transition,
      'previous_status', tt.previous_status,
      'next_status', tt.next_status,
      'previous_due_date', tt.previous_due_date,
      'target_date', tt.target_date,
      'action_key', tt.action_key,
      'work_class', tt.work_class,
      'note', tt.note,
      'reason', tt.reason,
      'field_log_id', tt.field_log_id,
      'created_at', tt.created_at
    ) order by tt.created_at desc)
    from atlas.task_transitions tt
    where tt.task_id = t.id
  ), '[]'::jsonb) as task_transitions
from atlas.farms f
join atlas.tasks t on t.farm_id = f.id
left join atlas.zones z on z.id = t.zone_id
left join atlas.task_objects tro on tro.task_id = t.id
left join atlas.growing_objects go on go.id = tro.object_id
left join atlas.object_state os on os.object_id = go.id
left join atlas.task_resource_requirements trr on trr.task_id = t.id
left join atlas.resources r on r.id = trr.resource_id
left join atlas.action_requirement_templates art on art.id = trr.template_id
group by
  f.stable_key,
  t.id,
  z.id,
  z.stable_key,
  z.label;

revoke all on table atlas.v_task_cards from public, anon, authenticated;
grant select on table atlas.v_task_cards to service_role;

revoke all on function atlas.derive_task_engine_fields() from public, anon, authenticated;
