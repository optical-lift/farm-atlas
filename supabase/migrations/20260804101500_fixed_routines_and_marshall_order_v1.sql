-- Preserve Marshall's handwritten appearance order and establish fixed calendar rhythms.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_marshall_membership_id uuid;
  v_project_id uuid;
  v_definition_id uuid;
  v_policy_id uuid;
  v_current_harvest_task_id uuid;
  v_prior_harvest_occurrence_id uuid;
  v_thursday_occurrence_id uuid;
  v_raised_bed_task_id uuid;
  v_raised_bed_occurrence_id uuid;
begin
  select farm.id
  into v_farm_id
  from atlas.farms farm
  where farm.stable_key = 'elm_farm';

  select membership.id, membership.user_id
  into v_anna_membership_id, v_anna_user_id
  from atlas.farm_memberships membership
  where membership.farm_id = v_farm_id
    and membership.worker_key = 'anna'
    and membership.active
  limit 1;

  select membership.id
  into v_marshall_membership_id
  from atlas.farm_memberships membership
  where membership.farm_id = v_farm_id
    and membership.worker_key = 'marshall'
    and membership.active
  limit 1;

  select project.id
  into v_project_id
  from atlas.projects project
  where project.farm_id = v_farm_id
    and project.stable_key = 'elm_south_dakota_departure_finish_20260805';

  if v_farm_id is null or v_anna_membership_id is null or v_marshall_membership_id is null then
    raise exception 'Elm Farm, Anna, and Marshall must exist before fixed routines are installed.';
  end if;

  -- Marshall's handwritten list stays in the exact order in which he wrote it.
  -- The floor-cure check is a derived prerequisite and sits immediately before installation.
  with desired(task_key, appearance_order) as (
    values
      ('marshall_20260804_router_departure_trim', 100),
      ('marshall_20260804_replace_part_on_elm_mower', 200),
      ('marshall_20260804_call_hamptons_sheila_mower', 300),
      ('marshall_20260804_stain_departure_trim', 400),
      ('owner_20260804_reimburse_melody', 500),
      ('marshall_20260804_cut_departure_trim_pieces', 600),
      ('marshall_20260804_fix_basement_sink_plumbing', 700),
      ('marshall_20260804_hang_venue_mirrors_acrylic', 800),
      ('marshall_20260804_remove_damaged_flooring_for_patches', 900),
      ('marshall_20260804_install_working_basement_dryer', 1000),
      ('marshall_20260804_buy_20ft_dryer_vent_hose', 1100),
      ('marshall_20260804_buy_card_table_bolts_washers', 1200),
      ('marshall_20260804_move_hutch_library_to_entry', 1300),
      ('marshall_20260804_install_existing_trim_rooms', 1400),
      ('marshall_20260802_install_venue_toilet', 1500),
      ('marshall_20260804_fix_basement_wall_elbow', 1600),
      ('marshall_20260804_replace_leaky_basement_ceiling_pipe', 1700),
      ('marshall_20260804_replace_valve_sealant', 1800),
      ('owner_20260801_inspect_floor_boards', 1850),
      ('marshall_20260805_install_flooring_patches', 1900),
      ('marshall_20260805_install_new_trim_bathroom_kitchen', 2000),
      ('marshall_20260725_install_attic_bathroom_door', 2100),
      ('marshall_20260804_move_mini_fridge_attic_kitchenette', 2200)
  )
  update atlas.tasks task
  set metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'departure_sort_order', desired.appearance_order,
        'day_order', desired.appearance_order,
        'day_work_order', desired.appearance_order,
        'run_sheet_order', desired.appearance_order,
        'work_order', desired.appearance_order,
        'appearance_order_source', 'marshall_handwritten_list_20260804'
      ),
      updated_at = now()
  from desired
  where task.farm_id = v_farm_id
    and task.metadata ->> 'task_key' = desired.task_key;

  with desired(task_key, appearance_order) as (
    values
      ('marshall_20260804_router_departure_trim', 100),
      ('marshall_20260804_replace_part_on_elm_mower', 200),
      ('marshall_20260804_call_hamptons_sheila_mower', 300),
      ('marshall_20260804_stain_departure_trim', 400),
      ('owner_20260804_reimburse_melody', 500),
      ('marshall_20260804_cut_departure_trim_pieces', 600),
      ('marshall_20260804_fix_basement_sink_plumbing', 700),
      ('marshall_20260804_hang_venue_mirrors_acrylic', 800),
      ('marshall_20260804_remove_damaged_flooring_for_patches', 900),
      ('marshall_20260804_install_working_basement_dryer', 1000),
      ('marshall_20260804_buy_20ft_dryer_vent_hose', 1100),
      ('marshall_20260804_buy_card_table_bolts_washers', 1200),
      ('marshall_20260804_move_hutch_library_to_entry', 1300),
      ('marshall_20260804_install_existing_trim_rooms', 1400),
      ('marshall_20260802_install_venue_toilet', 1500),
      ('marshall_20260804_fix_basement_wall_elbow', 1600),
      ('marshall_20260804_replace_leaky_basement_ceiling_pipe', 1700),
      ('marshall_20260804_replace_valve_sealant', 1800),
      ('owner_20260801_inspect_floor_boards', 1850),
      ('marshall_20260805_install_flooring_patches', 1900),
      ('marshall_20260805_install_new_trim_bathroom_kitchen', 2000),
      ('marshall_20260725_install_attic_bathroom_door', 2100),
      ('marshall_20260804_move_mini_fridge_attic_kitchenette', 2200)
  )
  update atlas.project_task_links link
  set sort_order = desired.appearance_order,
      metadata = coalesce(link.metadata, '{}'::jsonb) || jsonb_build_object(
        'appearanceOrderSource', 'marshall_handwritten_list_20260804'
      ),
      updated_at = now()
  from atlas.tasks task, desired
  where link.project_id = v_project_id
    and task.id = link.task_id
    and task.metadata ->> 'task_key' = desired.task_key;

  -- Reuse the existing raised-bed repair; move it to Wednesday morning.
  select task.id, task.planned_occurrence_id
  into v_raised_bed_task_id, v_raised_bed_occurrence_id
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.metadata ->> 'task_key' = 'marshall_20260804_repair_curve3_and_small_fm_beds'
    and task.status in ('open', 'blocked')
  order by task.created_at
  limit 1;

  if v_raised_bed_task_id is null then
    raise exception 'The canonical Curve Garden and Follow Me raised-bed repair task was not found.';
  end if;

  update atlas.tasks task
  set title = 'Marshall — Fix Curve Garden + FM Raised Beds',
      due_date = date '2026-08-05',
      work_lane = 'required',
      commitment_kind = 'hard_date',
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'display_action', 'Fix',
        'display_subject', 'Curve Garden + FM raised beds',
        'display_detail', 'Curve Arch 3 left + right · Follow Me Arch 2 smaller right bed',
        'work_order_anchor', 'morning',
        'day_work_order_mode', 'morning',
        'day_work_order_label', 'Wednesday morning',
        'owner_schedule_override', true,
        'owner_schedule_override_reason', 'Owner moved the existing repair to Wednesday morning before departure.',
        'owner_schedule_override_source', 'owner_instruction_20260804',
        'owner_schedule_override_date', '2026-08-05'
      ),
      updated_at = now()
  where task.id = v_raised_bed_task_id;

  if v_raised_bed_occurrence_id is not null then
    update atlas.planned_work_occurrences occurrence
    set title = 'Marshall — Fix Curve Garden + FM Raised Beds',
        planned_due_date = date '2026-08-05',
        not_before_date = date '2026-08-05',
        work_lane = 'required',
        commitment_kind = 'hard_date',
        task_payload = coalesce(occurrence.task_payload, '{}'::jsonb)
          || jsonb_build_object(
            'title', 'Marshall — Fix Curve Garden + FM Raised Beds',
            'due_date', '2026-08-05',
            'work_lane', 'required',
            'commitment_kind', 'hard_date',
            'metadata', coalesce(occurrence.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
              'display_action', 'Fix',
              'display_subject', 'Curve Garden + FM raised beds',
              'display_detail', 'Curve Arch 3 left + right · Follow Me Arch 2 smaller right bed',
              'work_order_anchor', 'morning',
              'day_work_order_mode', 'morning',
              'day_work_order_label', 'Wednesday morning',
              'owner_schedule_override', true,
              'owner_schedule_override_reason', 'Owner moved the existing repair to Wednesday morning before departure.'
            )
          ),
        metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
          'ownerScheduledFor', '2026-08-05',
          'ownerScheduledDaypart', 'morning'
        ),
        updated_at = now()
    where occurrence.id = v_raised_bed_occurrence_id;
  end if;

  -- Indoor plants: fixed Saturdays, independent of when the previous card is completed.
  insert into atlas.work_definitions (
    farm_id, stable_key, title_template, task_type, source_kind, action_key,
    work_class, default_priority, default_visibility_scope, active, metadata
  ) values (
    v_farm_id, 'anna_water_indoor_plants_saturday', 'Water Indoor Plants',
    'watering', 'recurring_task', 'water', 'standard', 'normal',
    'assigned_worker', true, jsonb_build_object(
      'assigned_to', 'Anna',
      'weekday', 'Saturday',
      'series_key', 'anna_water_indoor_plants_saturday',
      'schedule_source', 'fixed_calendar',
      'completion_independent_schedule', true
    )
  )
  on conflict (farm_id, stable_key) do update
  set title_template = excluded.title_template,
      task_type = excluded.task_type,
      source_kind = excluded.source_kind,
      action_key = excluded.action_key,
      work_class = excluded.work_class,
      default_priority = excluded.default_priority,
      default_visibility_scope = excluded.default_visibility_scope,
      active = true,
      metadata = atlas.work_definitions.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_definition_id;

  insert into atlas.work_release_policies (
    farm_id, work_definition_id, stable_key, gate_type, horizon_days,
    maximum_active_instances, gate_config, active, metadata
  ) values (
    v_farm_id, v_definition_id, 'anna_water_indoor_plants_saturday:release',
    'time_window', 14, 8,
    jsonb_build_object('automatic', true, 'source_kind', 'recurring_task'),
    true, jsonb_build_object('assigned_to', 'Anna', 'schedule_source', 'fixed_calendar')
  )
  on conflict (farm_id, stable_key) do update
  set work_definition_id = excluded.work_definition_id,
      gate_type = excluded.gate_type,
      horizon_days = excluded.horizon_days,
      maximum_active_instances = excluded.maximum_active_instances,
      gate_config = excluded.gate_config,
      active = true,
      metadata = atlas.work_release_policies.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_policy_id;

  insert into atlas.planned_work_occurrences (
    farm_id, work_definition_id, release_policy_id, occurrence_key,
    source_kind, title, planned_due_date, not_before_date, state,
    task_payload, relation_payload, metadata, work_lane,
    commitment_kind, effort_units
  )
  select
    v_farm_id,
    v_definition_id,
    v_policy_id,
    'recurring:anna_water_indoor_plants_saturday:' || due_date::text,
    'recurring_task',
    'Water Indoor Plants',
    due_date,
    due_date,
    'planned',
    jsonb_build_object(
      'farm_id', v_farm_id,
      'title', 'Water Indoor Plants',
      'task_type', 'watering',
      'status', 'open',
      'priority', 'normal',
      'due_date', due_date,
      'action_key', 'water',
      'work_class', 'standard',
      'work_lane', 'rhythm',
      'commitment_kind', 'persistent',
      'task_scope', 'farm_operation',
      'origin_kind', 'generated',
      'generated_from', 'recurring_task',
      'task_series_key', 'anna_water_indoor_plants_saturday',
      'engine_instance_key', 'recurring:anna_water_indoor_plants_saturday:' || due_date::text,
      'visibility_scope', 'assigned_worker',
      'assigned_membership_id', v_anna_membership_id,
      'assigned_user_id', v_anna_user_id,
      'metadata', jsonb_build_object(
        'task_key', 'anna_water_indoor_plants_' || to_char(due_date, 'YYYYMMDD'),
        'anna_task', true,
        'assigned_to', 'Anna',
        'assignee_key', 'anna',
        'executor_worker_key', 'anna',
        'executor_membership_id', v_anna_membership_id,
        'work_route', 'water',
        'work_rhythm', 'Watering',
        'collection_label', 'Watering',
        'collection_zone', 'Farmhouse',
        'display_action', 'Water',
        'display_subject', 'Indoor plants',
        'display_location', 'Indoor plants',
        'repeat_rule', 'weekly',
        'repeat_weekday', 'Saturday',
        'weekly_routine', true,
        'schedule_source', 'fixed_calendar',
        'completion_independent_schedule', true,
        'recreate_on_done', false,
        'work_order_anchor', 'morning'
      )
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'weekday', 'Saturday',
      'scheduleSource', 'fixed_calendar',
      'completionIndependentSchedule', true
    ),
    'rhythm',
    'persistent',
    0.5
  from (
    select generate_series(date '2026-08-08', date '2030-12-31', interval '7 days')::date as due_date
  ) schedule
  on conflict (farm_id, work_definition_id, occurrence_key) do update
  set release_policy_id = excluded.release_policy_id,
      title = excluded.title,
      planned_due_date = excluded.planned_due_date,
      not_before_date = excluded.not_before_date,
      task_payload = excluded.task_payload,
      metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
      work_lane = excluded.work_lane,
      commitment_kind = excluded.commitment_kind,
      effort_units = excluded.effort_units,
      state = case
        when atlas.planned_work_occurrences.state in ('released', 'completed') then atlas.planned_work_occurrences.state
        else 'planned'
      end,
      updated_at = now();

  -- Outdoor planters: every four calendar days. A Sunday date moves to Monday,
  -- while the underlying four-day cadence remains anchored to the base date.
  insert into atlas.work_definitions (
    farm_id, stable_key, title_template, task_type, source_kind, action_key,
    work_class, default_priority, default_visibility_scope, active, metadata
  ) values (
    v_farm_id, 'anna_water_outdoor_planters_every_4_days', 'Water Outdoor Planters',
    'watering', 'recurring_task', 'water', 'standard', 'high',
    'assigned_worker', true, jsonb_build_object(
      'assigned_to', 'Anna',
      'interval_days', 4,
      'series_key', 'anna_water_outdoor_planters_every_4_days',
      'sunday_policy', 'move_to_monday_keep_base_cadence',
      'schedule_source', 'fixed_calendar',
      'completion_independent_schedule', true
    )
  )
  on conflict (farm_id, stable_key) do update
  set title_template = excluded.title_template,
      task_type = excluded.task_type,
      source_kind = excluded.source_kind,
      action_key = excluded.action_key,
      work_class = excluded.work_class,
      default_priority = excluded.default_priority,
      default_visibility_scope = excluded.default_visibility_scope,
      active = true,
      metadata = atlas.work_definitions.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_definition_id;

  insert into atlas.work_release_policies (
    farm_id, work_definition_id, stable_key, gate_type, horizon_days,
    maximum_active_instances, gate_config, active, metadata
  ) values (
    v_farm_id, v_definition_id, 'anna_water_outdoor_planters_every_4_days:release',
    'time_window', 14, 8,
    jsonb_build_object('automatic', true, 'source_kind', 'recurring_task'),
    true, jsonb_build_object(
      'assigned_to', 'Anna',
      'schedule_source', 'fixed_calendar',
      'sunday_policy', 'move_to_monday_keep_base_cadence'
    )
  )
  on conflict (farm_id, stable_key) do update
  set work_definition_id = excluded.work_definition_id,
      gate_type = excluded.gate_type,
      horizon_days = excluded.horizon_days,
      maximum_active_instances = excluded.maximum_active_instances,
      gate_config = excluded.gate_config,
      active = true,
      metadata = atlas.work_release_policies.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_policy_id;

  insert into atlas.planned_work_occurrences (
    farm_id, work_definition_id, release_policy_id, occurrence_key,
    source_kind, title, planned_due_date, not_before_date, state,
    task_payload, relation_payload, metadata, work_lane,
    commitment_kind, effort_units
  )
  select
    v_farm_id,
    v_definition_id,
    v_policy_id,
    'recurring:anna_water_outdoor_planters_every_4_days:' || base_date::text,
    'recurring_task',
    'Water Outdoor Planters',
    due_date,
    due_date,
    'planned',
    jsonb_build_object(
      'farm_id', v_farm_id,
      'title', 'Water Outdoor Planters',
      'task_type', 'watering',
      'status', 'open',
      'priority', 'high',
      'due_date', due_date,
      'action_key', 'water',
      'work_class', 'standard',
      'work_lane', 'rhythm',
      'commitment_kind', 'persistent',
      'task_scope', 'farm_operation',
      'origin_kind', 'generated',
      'generated_from', 'recurring_task',
      'task_series_key', 'anna_water_outdoor_planters_every_4_days',
      'engine_instance_key', 'recurring:anna_water_outdoor_planters_every_4_days:' || base_date::text,
      'visibility_scope', 'assigned_worker',
      'assigned_membership_id', v_anna_membership_id,
      'assigned_user_id', v_anna_user_id,
      'metadata', jsonb_build_object(
        'task_key', 'anna_water_outdoor_planters_' || to_char(due_date, 'YYYYMMDD'),
        'anna_task', true,
        'assigned_to', 'Anna',
        'assignee_key', 'anna',
        'executor_worker_key', 'anna',
        'executor_membership_id', v_anna_membership_id,
        'work_route', 'water',
        'work_rhythm', 'Watering',
        'collection_label', 'Watering',
        'collection_zone', 'Outdoor planters',
        'display_action', 'Water',
        'display_subject', 'Outdoor planters',
        'display_location', 'Outdoor planters',
        'repeat_rule', 'every_4_days',
        'repeat_interval_days', 4,
        'base_due_date', base_date,
        'sunday_shifted', base_date <> due_date,
        'sunday_policy', 'move_to_monday_keep_base_cadence',
        'schedule_source', 'fixed_calendar',
        'completion_independent_schedule', true,
        'recreate_on_done', false,
        'work_order_anchor', 'morning'
      )
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'baseDueDate', base_date,
      'sundayShifted', base_date <> due_date,
      'sundayPolicy', 'move_to_monday_keep_base_cadence',
      'scheduleSource', 'fixed_calendar',
      'completionIndependentSchedule', true
    ),
    'rhythm',
    'persistent',
    0.5
  from (
    select
      base_date,
      case when extract(dow from base_date) = 0 then base_date + 1 else base_date end as due_date
    from (
      select generate_series(date '2026-08-05', date '2030-12-31', interval '4 days')::date as base_date
    ) base_schedule
  ) schedule
  on conflict (farm_id, work_definition_id, occurrence_key) do update
  set release_policy_id = excluded.release_policy_id,
      title = excluded.title,
      planned_due_date = excluded.planned_due_date,
      not_before_date = excluded.not_before_date,
      task_payload = excluded.task_payload,
      metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
      work_lane = excluded.work_lane,
      commitment_kind = excluded.commitment_kind,
      effort_units = excluded.effort_units,
      state = case
        when atlas.planned_work_occurrences.state in ('released', 'completed') then atlas.planned_work_occurrences.state
        else 'planned'
      end,
      updated_at = now();

  -- Harvest is one fixed Thursday rhythm. Tuesday and Friday definitions are retired;
  -- Thursday occurrences exist independently of the previous card's completion.
  update atlas.work_definitions definition
  set active = false,
      metadata = coalesce(definition.metadata, '{}'::jsonb) || jsonb_build_object(
        'retired_at', now(),
        'retired_reason', 'Replaced by fixed Thursday harvest rhythm',
        'replaced_by', 'anna_harvest_thursday_weekly_2026'
      ),
      updated_at = now()
  where definition.farm_id = v_farm_id
    and definition.stable_key in (
      'anna_harvest_tuesday_weekly_2026',
      'anna_harvest_friday_weekly_2026'
    );

  update atlas.work_release_policies policy
  set active = false,
      metadata = coalesce(policy.metadata, '{}'::jsonb) || jsonb_build_object(
        'retired_at', now(),
        'retired_reason', 'Replaced by fixed Thursday harvest rhythm'
      ),
      updated_at = now()
  where policy.farm_id = v_farm_id
    and policy.stable_key in (
      'anna_harvest_tuesday_weekly_2026:release',
      'anna_harvest_friday_weekly_2026:release'
    );

  select task.id, task.planned_occurrence_id
  into v_current_harvest_task_id, v_prior_harvest_occurrence_id
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.status in ('open', 'blocked')
    and task.title = 'Harvest — Cut Back Anything Blooming'
    and task.assigned_membership_id = v_anna_membership_id
  order by task.due_date, task.created_at
  limit 1;

  if v_current_harvest_task_id is null then
    raise exception 'The current Anna harvest task was not found.';
  end if;

  insert into atlas.work_definitions (
    farm_id, stable_key, title_template, task_type, source_kind, action_key,
    work_class, default_priority, default_visibility_scope, active, metadata
  ) values (
    v_farm_id, 'anna_harvest_thursday_weekly_2026',
    'Harvest — Cut Back Anything Blooming', 'harvest', 'recurring_task',
    'harvest', 'standard', 'high', 'assigned_worker', true,
    jsonb_build_object(
      'assigned_to', 'Anna',
      'weekday', 'Thursday',
      'season_end', '2026-11-12',
      'series_key', 'anna_harvest_thursday_weekly',
      'schedule_source', 'fixed_calendar',
      'completion_independent_schedule', true
    )
  )
  on conflict (farm_id, stable_key) do update
  set title_template = excluded.title_template,
      task_type = excluded.task_type,
      source_kind = excluded.source_kind,
      action_key = excluded.action_key,
      work_class = excluded.work_class,
      default_priority = excluded.default_priority,
      default_visibility_scope = excluded.default_visibility_scope,
      active = true,
      metadata = atlas.work_definitions.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_definition_id;

  insert into atlas.work_release_policies (
    farm_id, work_definition_id, stable_key, gate_type, horizon_days,
    maximum_active_instances, gate_config, active, metadata
  ) values (
    v_farm_id, v_definition_id, 'anna_harvest_thursday_weekly_2026:release',
    'time_window', 14, 8,
    jsonb_build_object('automatic', true, 'source_kind', 'recurring_task'),
    true, jsonb_build_object(
      'assigned_to', 'Anna',
      'weekday', 'Thursday',
      'schedule_source', 'fixed_calendar',
      'completion_independent_schedule', true
    )
  )
  on conflict (farm_id, stable_key) do update
  set work_definition_id = excluded.work_definition_id,
      gate_type = excluded.gate_type,
      horizon_days = excluded.horizon_days,
      maximum_active_instances = excluded.maximum_active_instances,
      gate_config = excluded.gate_config,
      active = true,
      metadata = atlas.work_release_policies.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_policy_id;

  insert into atlas.planned_work_occurrences (
    farm_id, work_definition_id, release_policy_id, occurrence_key,
    source_kind, title, planned_due_date, not_before_date, state,
    task_payload, relation_payload, metadata, work_lane,
    commitment_kind, effort_units
  )
  select
    v_farm_id,
    v_definition_id,
    v_policy_id,
    'recurring:anna_harvest_thursday_weekly:' || due_date::text,
    'recurring_task',
    'Harvest — Cut Back Anything Blooming',
    due_date,
    due_date,
    'planned',
    jsonb_build_object(
      'farm_id', v_farm_id,
      'title', 'Harvest — Cut Back Anything Blooming',
      'task_type', 'harvest',
      'status', 'open',
      'priority', 'high',
      'due_date', due_date,
      'action_key', 'harvest',
      'work_class', 'standard',
      'work_lane', 'rhythm',
      'commitment_kind', 'persistent',
      'task_scope', 'farm_operation',
      'origin_kind', 'generated',
      'generated_from', 'recurring_task',
      'task_series_key', 'anna_harvest_thursday_weekly',
      'engine_instance_key', 'recurring:anna_harvest_thursday_weekly:' || due_date::text,
      'visibility_scope', 'assigned_worker',
      'assigned_membership_id', v_anna_membership_id,
      'assigned_user_id', v_anna_user_id,
      'metadata', jsonb_build_object(
        'task_key', 'anna_harvest_thursday_weekly_' || to_char(due_date, 'YYYYMMDD'),
        'anna_task', true,
        'assigned_to', 'Anna',
        'assignee_key', 'anna',
        'executor_worker_key', 'anna',
        'executor_membership_id', v_anna_membership_id,
        'work_route', 'harvest',
        'work_rhythm', 'Harvest',
        'collection_label', 'Harvest',
        'collection_zone', 'Elm Farm',
        'display_action', 'Harvest',
        'display_subject', 'Cut Back Anything Blooming',
        'display_location', 'Harvest',
        'repeat_rule', 'weekly',
        'repeat_weekday', 'Thursday',
        'weekly_routine', true,
        'season_end', '2026-11-12',
        'schedule_source', 'fixed_calendar',
        'completion_independent_schedule', true,
        'recreate_on_done', false,
        'work_order_anchor', 'morning'
      )
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'weekday', 'Thursday',
      'scheduleSource', 'fixed_calendar',
      'completionIndependentSchedule', true
    ),
    'rhythm',
    'persistent',
    1
  from (
    select generate_series(date '2026-08-06', date '2026-11-12', interval '7 days')::date as due_date
  ) schedule
  on conflict (farm_id, work_definition_id, occurrence_key) do update
  set release_policy_id = excluded.release_policy_id,
      title = excluded.title,
      planned_due_date = excluded.planned_due_date,
      not_before_date = excluded.not_before_date,
      task_payload = excluded.task_payload,
      metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
      work_lane = excluded.work_lane,
      commitment_kind = excluded.commitment_kind,
      effort_units = excluded.effort_units,
      state = case
        when atlas.planned_work_occurrences.state in ('released', 'completed') then atlas.planned_work_occurrences.state
        else 'planned'
      end,
      updated_at = now();

  select occurrence.id
  into v_thursday_occurrence_id
  from atlas.planned_work_occurrences occurrence
  where occurrence.farm_id = v_farm_id
    and occurrence.work_definition_id = v_definition_id
    and occurrence.occurrence_key = 'recurring:anna_harvest_thursday_weekly:2026-08-06';

  -- Retire any other active task released from the old Tuesday/Friday calendar.
  update atlas.tasks task
  set status = 'archived',
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_reason', 'Duplicate old Tuesday/Friday harvest occurrence replaced by fixed Thursday rhythm',
        'archived_at', now()
      ),
      updated_at = now()
  where task.farm_id = v_farm_id
    and task.id <> v_current_harvest_task_id
    and task.status in ('open', 'blocked')
    and task.planned_occurrence_id in (
      select occurrence.id
      from atlas.planned_work_occurrences occurrence
      join atlas.work_definitions definition on definition.id = occurrence.work_definition_id
      where occurrence.farm_id = v_farm_id
        and definition.stable_key in (
          'anna_harvest_tuesday_weekly_2026',
          'anna_harvest_friday_weekly_2026'
        )
        and occurrence.planned_due_date >= date '2026-08-04'
    );

  update atlas.planned_work_occurrences occurrence
  set state = 'cancelled',
      released_task_id = null,
      metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelledAt', now(),
        'cancelledReason', 'Replaced by fixed Thursday harvest rhythm',
        'replacementOccurrenceId', v_thursday_occurrence_id
      ),
      updated_at = now()
  where occurrence.farm_id = v_farm_id
    and occurrence.work_definition_id in (
      select definition.id
      from atlas.work_definitions definition
      where definition.farm_id = v_farm_id
        and definition.stable_key in (
          'anna_harvest_tuesday_weekly_2026',
          'anna_harvest_friday_weekly_2026'
        )
    )
    and occurrence.planned_due_date >= date '2026-08-04'
    and occurrence.state <> 'completed';

  update atlas.tasks task
  set due_date = date '2026-08-06',
      planned_occurrence_id = v_thursday_occurrence_id,
      task_series_key = 'anna_harvest_thursday_weekly',
      engine_instance_key = 'recurring:anna_harvest_thursday_weekly:2026-08-06',
      work_lane = 'rhythm',
      commitment_kind = 'persistent',
      blocker_text = null,
      metadata = (coalesce(task.metadata, '{}'::jsonb)
        - 'dependency_downstream_title'
        - 'dependency_result') || jsonb_build_object(
          'task_key', 'anna_harvest_thursday_weekly_20260806',
          'repeat_weekday', 'Thursday',
          'repeat_rule', 'weekly',
          'weekly_routine', true,
          'season_end', '2026-11-12',
          'work_lane', 'rhythm',
          'commitment_kind', 'persistent',
          'schedule_source', 'fixed_calendar',
          'completion_independent_schedule', true,
          'recreate_on_done', false,
          'planned_occurrence_id', v_thursday_occurrence_id,
          'dependency_downstream_title', 'Bundle conditioned Thursday harvest',
          'dependency_result', 'Thursday harvest bundled and ready for bouquet work.'
        ),
      updated_at = now()
  where task.id = v_current_harvest_task_id;

  update atlas.planned_work_occurrences occurrence
  set state = 'released',
      released_at = coalesce(occurrence.released_at, now()),
      released_task_id = v_current_harvest_task_id,
      metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
        'releasedBy', 'fixed_thursday_harvest_reconciliation_v1',
        'reusedTaskId', v_current_harvest_task_id
      ),
      updated_at = now()
  where occurrence.id = v_thursday_occurrence_id;

  -- Keep the existing postharvest dependency, but remove stale Friday wording.
  update atlas.work_definitions definition
  set title_template = 'Bundle conditioned Thursday harvest',
      metadata = coalesce(definition.metadata, '{}'::jsonb) || jsonb_build_object(
        'result', 'Thursday harvest bundled and ready for bouquet work.',
        'weekday', 'Thursday'
      ),
      updated_at = now()
  where definition.farm_id = v_farm_id
    and definition.stable_key = 'postharvest_bundle_conditioned_harvest';

  update atlas.planned_work_occurrences occurrence
  set title = 'Bundle conditioned Thursday harvest',
      planned_due_date = date '2026-08-06',
      task_payload = coalesce(occurrence.task_payload, '{}'::jsonb) || jsonb_build_object(
        'title', 'Bundle conditioned Thursday harvest',
        'due_date', '2026-08-06',
        'metadata', coalesce(occurrence.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
          'task_key', 'anna_bundle_conditioned_thursday_harvest_20260806',
          'result_text', 'Thursday harvest bundled and ready for bouquet work.',
          'display_subject', 'Conditioned Thursday harvest'
        )
      ),
      metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
        'weekday', 'Thursday',
        'sourceScheduleReconciledAt', now()
      ),
      updated_at = now()
  where occurrence.farm_id = v_farm_id
    and occurrence.source_kind = 'task_dependency_clock'
    and occurrence.source_id = v_current_harvest_task_id
    and occurrence.state in ('planned', 'eligible');

  -- Evaluate only the actual current day. Future fixed cards remain held until their date.
  perform atlas.release_eligible_work_v1(v_farm_id, date '2026-08-04', 100);
end;
$migration$;

commit;
