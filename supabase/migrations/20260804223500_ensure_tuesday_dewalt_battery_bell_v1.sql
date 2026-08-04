create or replace function atlas.ensure_tuesday_dewalt_battery_bell_v1(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm atlas.farms%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_zone text;
  v_local_date date;
  v_local_time time;
  v_due_date date;
  v_days_until integer;
  v_existing_task_id uuid;
  v_existing_occurrence_id uuid;
  v_occurrence_id uuid;
  v_series_key text := 'charge_dewalt_batteries_for_mowing_tuesday';
  v_occurrence_key text;
begin
  select * into v_farm
  from atlas.farms
  where stable_key = 'elm_farm'
    and status = 'active'
  limit 1;

  if v_farm.id is null then
    raise exception 'Elm Farm was not found.' using errcode = 'P0002';
  end if;

  select * into v_membership
  from atlas.farm_memberships
  where farm_id = v_farm.id
    and worker_key = 'anna'
    and active
  limit 1;

  if v_membership.id is null or v_membership.user_id is null then
    raise exception 'Anna active membership was not found.' using errcode = 'P0002';
  end if;

  v_zone := coalesce(nullif(v_farm.metadata ->> 'timezone', ''), 'America/Chicago');
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;

  v_local_date := (coalesce(p_as_of, now()) at time zone v_zone)::date;
  v_local_time := (coalesce(p_as_of, now()) at time zone v_zone)::time;
  v_days_until := (2 - extract(dow from v_local_date)::integer + 7) % 7;
  v_due_date := v_local_date + v_days_until;

  if v_days_until = 0 and v_local_time >= time '16:00' then
    v_due_date := v_due_date + 7;
  end if;

  select t.id, t.planned_occurrence_id
  into v_existing_task_id, v_existing_occurrence_id
  from atlas.tasks t
  where t.farm_id = v_farm.id
    and t.task_series_key = v_series_key
    and t.due_date = v_due_date
    and t.status in ('open', 'blocked', 'done')
  order by case when t.status in ('open', 'blocked') then 0 else 1 end, t.created_at desc
  limit 1;

  if v_existing_task_id is not null then
    return jsonb_build_object(
      'contractVersion', 'weekly_battery_bell_v1',
      'dueDate', v_due_date,
      'taskId', v_existing_task_id,
      'occurrenceId', v_existing_occurrence_id,
      'created', false
    );
  end if;

  v_occurrence_key := 'fixed:' || v_series_key || ':' || v_due_date::text;

  select pwo.id into v_existing_occurrence_id
  from atlas.planned_work_occurrences pwo
  where pwo.farm_id = v_farm.id
    and pwo.occurrence_key = v_occurrence_key
    and pwo.state not in ('cancelled', 'failed')
  limit 1;

  if v_existing_occurrence_id is not null then
    return jsonb_build_object(
      'contractVersion', 'weekly_battery_bell_v1',
      'dueDate', v_due_date,
      'taskId', null,
      'occurrenceId', v_existing_occurrence_id,
      'created', false
    );
  end if;

  v_occurrence_id := atlas.plan_fixed_assigned_worker_occurrence_v1(
    v_farm.id,
    v_membership.id,
    v_membership.user_id,
    'fixed:charge_dewalt_batteries_for_mowing',
    'fixed:charge_dewalt_batteries_for_mowing',
    v_occurrence_key,
    'Charge DeWalt Batteries for Mowing',
    'mowing_preparation',
    v_due_date,
    'high',
    'prepare',
    v_series_key,
    0.25,
    jsonb_build_object(
      'task_key', v_series_key,
      'display_action', 'Charge',
      'display_subject', 'DeWalt batteries for mowing',
      'display_detail', 'Tuesday before Wednesday mowing',
      'collection_label', 'Mowing preparation',
      'collection_zone', 'Mowing preparation',
      'display_location', 'Battery charging station',
      'quick_complete_allowed', true,
      'must_precede_action', 'mow',
      'work_order_anchor', 'evening',
      'notification_release_local_time', '16:00',
      'notification_close_local_time', null,
      'notification_nudge_after_minutes', null,
      'notification_group_key', 'charge_dewalt_batteries_for_mowing',
      'notification_group_label', 'Charge DeWalt batteries for mowing',
      'created_source', 'owner_instruction_20260804'
    )
  );

  return jsonb_build_object(
    'contractVersion', 'weekly_battery_bell_v1',
    'dueDate', v_due_date,
    'taskId', null,
    'occurrenceId', v_occurrence_id,
    'created', true
  );
end;
$function$;

update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'recreate_on_done', false,
      'completion_independent_schedule', true,
      'schedule_source', 'fixed_calendar'
    ),
    updated_at = now()
where task_series_key = 'charge_dewalt_batteries_for_mowing_tuesday';

update atlas.planned_work_occurrences
set task_payload = coalesce(task_payload, '{}'::jsonb) || jsonb_build_object(
      'metadata', coalesce(task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'recreate_on_done', false,
        'completion_independent_schedule', true,
        'schedule_source', 'fixed_calendar'
      )
    ),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'completionIndependentSchedule', true,
      'scheduleSource', 'fixed_calendar'
    ),
    updated_at = now()
where task_payload ->> 'task_series_key' = 'charge_dewalt_batteries_for_mowing_tuesday';

do $block$
begin
  if not exists (
    select 1 from cron.job where jobname = 'atlas_ensure_tuesday_dewalt_battery_bell'
  ) then
    perform cron.schedule(
      'atlas_ensure_tuesday_dewalt_battery_bell',
      '11 10 * * *',
      'select atlas.ensure_tuesday_dewalt_battery_bell_v1();'
    );
  end if;
end;
$block$;

select atlas.ensure_tuesday_dewalt_battery_bell_v1(now());
