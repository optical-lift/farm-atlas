-- Keep Marshall's finish sprint in handwritten order and create non-drifting farm rhythms.

begin;

create or replace function atlas.plan_fixed_assigned_worker_occurrence_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_definition_key text,
  p_policy_key text,
  p_occurrence_key text,
  p_title text,
  p_task_type text,
  p_due_date date,
  p_priority text,
  p_action_key text,
  p_series_key text,
  p_effort_units numeric,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_occurrence_id uuid;
begin
  v_occurrence_id := atlas.plan_work_occurrence_v1(
    p_farm_id,
    p_definition_key,
    p_policy_key,
    p_occurrence_key,
    p_title,
    p_task_type,
    p_due_date,
    'recurring_task',
    null,
    'time_window',
    14,
    8,
    jsonb_build_object(
      'farm_id', p_farm_id,
      'title', p_title,
      'task_type', p_task_type,
      'status', 'open',
      'priority', p_priority,
      'due_date', p_due_date,
      'action_key', p_action_key,
      'work_class', 'standard',
      'work_lane', 'rhythm',
      'commitment_kind', 'persistent',
      'task_scope', 'farm_operation',
      'origin_kind', 'generated',
      'generated_from', 'recurring_task',
      'task_series_key', p_series_key,
      'engine_instance_key', p_occurrence_key,
      'visibility_scope', 'assigned_worker',
      'assigned_membership_id', p_membership_id,
      'assigned_user_id', p_user_id,
      'metadata', coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'anna_task', true,
        'assigned_to', 'Anna',
        'assignee_key', 'anna',
        'executor_worker_key', 'anna',
        'executor_membership_id', p_membership_id,
        'work_route', p_action_key,
        'work_rhythm', initcap(p_action_key),
        'schedule_source', 'fixed_calendar',
        'completion_independent_schedule', true,
        'recreate_on_done', false
      )
    ),
    '{}'::jsonb,
    jsonb_build_object('automatic', true, 'source_kind', 'recurring_task'),
    p_due_date,
    jsonb_build_object(
      'scheduleSource', 'fixed_calendar',
      'completionIndependentSchedule', true
    )
  );

  update atlas.planned_work_occurrences
  set work_lane = 'rhythm',
      commitment_kind = 'persistent',
      effort_units = p_effort_units,
      updated_at = now()
  where id = v_occurrence_id;

  return v_occurrence_id;
end;
$function$;

revoke all on function atlas.plan_fixed_assigned_worker_occurrence_v1(
  uuid,uuid,uuid,text,text,text,text,text,date,text,text,text,numeric,jsonb
) from public, anon, authenticated;
grant execute on function atlas.plan_fixed_assigned_worker_occurrence_v1(
  uuid,uuid,uuid,text,text,text,text,text,date,text,text,text,numeric,jsonb
) to service_role;

do $migration$
declare
  v_farm_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_marshall_membership_id uuid;
  v_project_id uuid;
  v_raised_bed_task_id uuid;
  v_raised_bed_occurrence_id uuid;
  v_current_harvest_task_id uuid;
  v_thursday_occurrence_id uuid;
  v_thursday_policy_id uuid;
  v_base_date date;
  v_due_date date;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  select id,user_id into v_anna_membership_id,v_anna_user_id
  from atlas.farm_memberships
  where farm_id=v_farm_id and worker_key='anna' and active
  limit 1;

  select id into v_marshall_membership_id
  from atlas.farm_memberships
  where farm_id=v_farm_id and worker_key='marshall' and active
  limit 1;

  select id into v_project_id
  from atlas.projects
  where farm_id=v_farm_id
    and stable_key='elm_south_dakota_departure_finish_20260805';

  if v_farm_id is null or v_anna_membership_id is null or v_marshall_membership_id is null then
    raise exception 'Elm Farm, Anna, and Marshall are required.';
  end if;

  -- Exact order of appearance in Marshall's handwritten list.
  with desired(task_key,appearance_order) as (values
    ('marshall_20260804_router_departure_trim',100),
    ('marshall_20260804_replace_part_on_elm_mower',200),
    ('marshall_20260804_call_hamptons_sheila_mower',300),
    ('marshall_20260804_stain_departure_trim',400),
    ('owner_20260804_reimburse_melody',500),
    ('marshall_20260804_cut_departure_trim_pieces',600),
    ('marshall_20260804_fix_basement_sink_plumbing',700),
    ('marshall_20260804_hang_venue_mirrors_acrylic',800),
    ('marshall_20260804_remove_damaged_flooring_for_patches',900),
    ('marshall_20260804_install_working_basement_dryer',1000),
    ('marshall_20260804_buy_20ft_dryer_vent_hose',1100),
    ('marshall_20260804_buy_card_table_bolts_washers',1200),
    ('marshall_20260804_move_hutch_library_to_entry',1300),
    ('marshall_20260804_install_existing_trim_rooms',1400),
    ('marshall_20260802_install_venue_toilet',1500),
    ('marshall_20260804_fix_basement_wall_elbow',1600),
    ('marshall_20260804_replace_leaky_basement_ceiling_pipe',1700),
    ('marshall_20260804_replace_valve_sealant',1800),
    ('owner_20260801_inspect_floor_boards',1850),
    ('marshall_20260805_install_flooring_patches',1900),
    ('marshall_20260805_install_new_trim_bathroom_kitchen',2000),
    ('marshall_20260725_install_attic_bathroom_door',2100),
    ('marshall_20260804_move_mini_fridge_attic_kitchenette',2200)
  )
  update atlas.tasks task
  set metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'departure_sort_order',desired.appearance_order,
        'day_order',desired.appearance_order,
        'day_work_order',desired.appearance_order,
        'run_sheet_order',desired.appearance_order,
        'work_order',desired.appearance_order,
        'appearance_order_source','marshall_handwritten_list_20260804'
      ),
      updated_at=now()
  from desired
  where task.farm_id=v_farm_id
    and task.metadata->>'task_key'=desired.task_key;

  with desired(task_key,appearance_order) as (values
    ('marshall_20260804_router_departure_trim',100),
    ('marshall_20260804_replace_part_on_elm_mower',200),
    ('marshall_20260804_call_hamptons_sheila_mower',300),
    ('marshall_20260804_stain_departure_trim',400),
    ('owner_20260804_reimburse_melody',500),
    ('marshall_20260804_cut_departure_trim_pieces',600),
    ('marshall_20260804_fix_basement_sink_plumbing',700),
    ('marshall_20260804_hang_venue_mirrors_acrylic',800),
    ('marshall_20260804_remove_damaged_flooring_for_patches',900),
    ('marshall_20260804_install_working_basement_dryer',1000),
    ('marshall_20260804_buy_20ft_dryer_vent_hose',1100),
    ('marshall_20260804_buy_card_table_bolts_washers',1200),
    ('marshall_20260804_move_hutch_library_to_entry',1300),
    ('marshall_20260804_install_existing_trim_rooms',1400),
    ('marshall_20260802_install_venue_toilet',1500),
    ('marshall_20260804_fix_basement_wall_elbow',1600),
    ('marshall_20260804_replace_leaky_basement_ceiling_pipe',1700),
    ('marshall_20260804_replace_valve_sealant',1800),
    ('owner_20260801_inspect_floor_boards',1850),
    ('marshall_20260805_install_flooring_patches',1900),
    ('marshall_20260805_install_new_trim_bathroom_kitchen',2000),
    ('marshall_20260725_install_attic_bathroom_door',2100),
    ('marshall_20260804_move_mini_fridge_attic_kitchenette',2200)
  )
  update atlas.project_task_links link
  set sort_order=desired.appearance_order,
      metadata=coalesce(link.metadata,'{}'::jsonb)||jsonb_build_object(
        'appearanceOrderSource','marshall_handwritten_list_20260804'
      ),
      updated_at=now()
  from atlas.tasks task,desired
  where link.project_id=v_project_id
    and task.id=link.task_id
    and task.metadata->>'task_key'=desired.task_key;

  -- Reuse the existing Curve Garden/Follow Me repair card.
  select id,planned_occurrence_id
  into v_raised_bed_task_id,v_raised_bed_occurrence_id
  from atlas.tasks
  where farm_id=v_farm_id
    and metadata->>'task_key'='marshall_20260804_repair_curve3_and_small_fm_beds'
    and status in ('open','blocked')
  order by created_at
  limit 1;

  if v_raised_bed_task_id is null then
    raise exception 'The canonical Curve Garden and Follow Me raised-bed repair task was not found.';
  end if;

  update atlas.tasks
  set title='Marshall — Fix Curve Garden + FM Raised Beds',
      due_date = date '2026-08-05',
      work_lane='required',
      commitment_kind='hard_date',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Fix',
        'display_subject','Curve Garden + FM raised beds',
        'display_detail','Curve Arch 3 left + right · Follow Me Arch 2 smaller right bed',
        'work_order_anchor','morning',
        'day_work_order_mode','morning',
        'day_work_order_label','Wednesday morning',
        'owner_schedule_override',true,
        'owner_schedule_override_reason','Owner moved the existing repair to Wednesday morning before departure.',
        'owner_schedule_override_date','2026-08-05'
      ),
      updated_at=now()
  where id=v_raised_bed_task_id;

  update atlas.planned_work_occurrences
  set title='Marshall — Fix Curve Garden + FM Raised Beds',
      planned_due_date=date '2026-08-05',
      not_before_date=date '2026-08-05',
      work_lane='required',
      commitment_kind='hard_date',
      task_payload=coalesce(task_payload,'{}'::jsonb)||jsonb_build_object(
        'title','Marshall — Fix Curve Garden + FM Raised Beds',
        'due_date','2026-08-05',
        'work_lane','required',
        'commitment_kind','hard_date',
        'metadata',coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'display_action','Fix',
          'display_subject','Curve Garden + FM raised beds',
          'display_detail','Curve Arch 3 left + right · Follow Me Arch 2 smaller right bed',
          'work_order_anchor','morning',
          'day_work_order_label','Wednesday morning'
        )
      ),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'ownerScheduledFor','2026-08-05','ownerScheduledDaypart','morning'
      ),
      updated_at=now()
  where id=v_raised_bed_occurrence_id;

  -- Indoor plants: every Saturday, fixed to the calendar.
  for v_due_date in
    select generate_series(date '2026-08-08', date '2030-12-31', interval '7 days')::date
  loop
    perform atlas.plan_fixed_assigned_worker_occurrence_v1(
      v_farm_id,v_anna_membership_id,v_anna_user_id,
      'anna_water_indoor_plants_saturday','anna_water_indoor_plants_saturday:release',
      'recurring:anna_water_indoor_plants_saturday:'||v_due_date::text,
      'Water Indoor Plants','watering',v_due_date,'normal','water',
      'anna_water_indoor_plants_saturday',0.5,
      jsonb_build_object(
        'task_key','anna_water_indoor_plants_'||to_char(v_due_date,'YYYYMMDD'),
        'collection_label','Watering','collection_zone','Farmhouse',
        'display_action','Water','display_subject','Indoor plants',
        'display_location','Indoor plants','repeat_rule','weekly',
        'repeat_weekday','Saturday','weekly_routine',true,
        'work_order_anchor','morning'
      )
    );
  end loop;

  update atlas.work_definitions
  set active=true,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'assigned_to','Anna','weekday','Saturday',
        'series_key','anna_water_indoor_plants_saturday',
        'schedule_source','fixed_calendar','completion_independent_schedule',true
      ),updated_at=now()
  where farm_id=v_farm_id and stable_key='anna_water_indoor_plants_saturday';

  -- Outdoor planters: four-day base cadence; Sunday service moves to Monday.
  for v_base_date in
    select generate_series(date '2026-08-05', date '2030-12-31', interval '4 days')::date
  loop
    v_due_date := case when extract(dow from v_base_date)=0 then v_base_date+1 else v_base_date end;
    perform atlas.plan_fixed_assigned_worker_occurrence_v1(
      v_farm_id,v_anna_membership_id,v_anna_user_id,
      'anna_water_outdoor_planters_every_4_days','anna_water_outdoor_planters_every_4_days:release',
      'recurring:anna_water_outdoor_planters_every_4_days:'||v_base_date::text,
      'Water Outdoor Planters','watering',v_due_date,'high','water',
      'anna_water_outdoor_planters_every_4_days',0.5,
      jsonb_build_object(
        'task_key','anna_water_outdoor_planters_'||to_char(v_due_date,'YYYYMMDD'),
        'collection_label','Watering','collection_zone','Outdoor planters',
        'display_action','Water','display_subject','Outdoor planters',
        'display_location','Outdoor planters','repeat_rule','every_4_days',
        'repeat_interval_days',4,'base_due_date',v_base_date,
        'sunday_shifted',v_base_date<>v_due_date,
        'sunday_policy','move_to_monday_keep_base_cadence',
        'work_order_anchor','morning'
      )
    );
  end loop;

  update atlas.work_definitions
  set active=true,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'assigned_to','Anna','interval_days',4,
        'series_key','anna_water_outdoor_planters_every_4_days',
        'sunday_policy','move_to_monday_keep_base_cadence',
        'schedule_source','fixed_calendar','completion_independent_schedule',true
      ),updated_at=now()
  where farm_id=v_farm_id and stable_key='anna_water_outdoor_planters_every_4_days';

  -- One Thursday harvest series; dates are preplanned and do not depend on completion.
  for v_due_date in
    select generate_series(date '2026-08-06', date '2026-11-12', interval '7 days')::date
  loop
    perform atlas.plan_fixed_assigned_worker_occurrence_v1(
      v_farm_id,v_anna_membership_id,v_anna_user_id,
      'anna_harvest_thursday_weekly_2026','anna_harvest_thursday_weekly_2026:release',
      'recurring:anna_harvest_thursday_weekly:'||v_due_date::text,
      'Harvest — Cut Back Anything Blooming','harvest',v_due_date,'high','harvest',
      'anna_harvest_thursday_weekly',1,
      jsonb_build_object(
        'task_key','anna_harvest_thursday_weekly_'||to_char(v_due_date,'YYYYMMDD'),
        'collection_label','Harvest','collection_zone','Elm Farm',
        'display_action','Harvest','display_subject','Cut Back Anything Blooming',
        'display_location','Harvest','repeat_rule','weekly',
        'repeat_weekday','Thursday','weekly_routine',true,
        'season_end','2026-11-12','work_order_anchor','morning'
      )
    );
  end loop;

  update atlas.work_definitions
  set active=true,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'assigned_to','Anna','weekday','Thursday','season_end','2026-11-12',
        'series_key','anna_harvest_thursday_weekly',
        'schedule_source','fixed_calendar','completion_independent_schedule',true
      ),updated_at=now()
  where farm_id=v_farm_id and stable_key='anna_harvest_thursday_weekly_2026';

  select occurrence.id,occurrence.release_policy_id
  into v_thursday_occurrence_id,v_thursday_policy_id
  from atlas.planned_work_occurrences occurrence
  join atlas.work_definitions definition on definition.id=occurrence.work_definition_id
  where occurrence.farm_id=v_farm_id
    and definition.stable_key='anna_harvest_thursday_weekly_2026'
    and occurrence.occurrence_key='recurring:anna_harvest_thursday_weekly:2026-08-06';

  select id into v_current_harvest_task_id
  from atlas.tasks
  where farm_id=v_farm_id and status in ('open','blocked')
    and title='Harvest — Cut Back Anything Blooming'
    and assigned_membership_id=v_anna_membership_id
  order by due_date,created_at
  limit 1;

  if v_current_harvest_task_id is null then
    raise exception 'The current Anna harvest task was not found.';
  end if;

  update atlas.tasks
  set status='archived',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'archived_reason','Duplicate old Tuesday/Friday harvest replaced by fixed Thursday rhythm',
        'archived_at',now()
      ),updated_at=now()
  where farm_id=v_farm_id and id<>v_current_harvest_task_id
    and status in ('open','blocked')
    and planned_occurrence_id in (
      select occurrence.id
      from atlas.planned_work_occurrences occurrence
      join atlas.work_definitions definition on definition.id=occurrence.work_definition_id
      where occurrence.farm_id=v_farm_id
        and definition.stable_key in ('anna_harvest_tuesday_weekly_2026','anna_harvest_friday_weekly_2026')
        and occurrence.planned_due_date>=date '2026-08-04'
    );

  update atlas.planned_work_occurrences occurrence
  set state='cancelled',released_task_id=null,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
        'cancelledAt',now(),'cancelledReason','Replaced by fixed Thursday harvest rhythm',
        'replacementOccurrenceId',v_thursday_occurrence_id
      ),updated_at=now()
  where occurrence.farm_id=v_farm_id
    and occurrence.work_definition_id in (
      select id from atlas.work_definitions
      where farm_id=v_farm_id
        and stable_key in ('anna_harvest_tuesday_weekly_2026','anna_harvest_friday_weekly_2026')
    )
    and occurrence.planned_due_date>=date '2026-08-04'
    and occurrence.state<>'completed';

  update atlas.work_definitions
  set active=false,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'retired_at',now(),'retired_reason','Replaced by fixed Thursday harvest rhythm',
        'replaced_by','anna_harvest_thursday_weekly_2026'
      ),updated_at=now()
  where farm_id=v_farm_id
    and stable_key in ('anna_harvest_tuesday_weekly_2026','anna_harvest_friday_weekly_2026');

  update atlas.work_release_policies
  set active=false,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'retired_at',now(),'retired_reason','Replaced by fixed Thursday harvest rhythm'
      ),updated_at=now()
  where farm_id=v_farm_id
    and stable_key in ('anna_harvest_tuesday_weekly_2026:release','anna_harvest_friday_weekly_2026:release');

  update atlas.tasks
  set due_date=date '2026-08-06',planned_occurrence_id=v_thursday_occurrence_id,
      release_policy_id=v_thursday_policy_id,released_at=coalesce(released_at,now()),
      task_series_key='anna_harvest_thursday_weekly',
      engine_instance_key='recurring:anna_harvest_thursday_weekly:2026-08-06',
      work_lane='rhythm',commitment_kind='persistent',blocker_text=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'dependency_downstream_title'-'dependency_result')||jsonb_build_object(
        'task_key','anna_harvest_thursday_weekly_20260806',
        'repeat_weekday','Thursday','repeat_rule','weekly','weekly_routine',true,
        'season_end','2026-11-12','work_lane','rhythm','commitment_kind','persistent',
        'schedule_source','fixed_calendar','completion_independent_schedule',true,
        'recreate_on_done',false,'planned_occurrence_id',v_thursday_occurrence_id,
        'release_policy_id',v_thursday_policy_id,
        'dependency_downstream_title','Bundle conditioned Thursday harvest',
        'dependency_result','Thursday harvest bundled and ready for bouquet work.'
      ),updated_at=now()
  where id=v_current_harvest_task_id;

  update atlas.planned_work_occurrences
  set state='released',released_at=coalesce(released_at,now()),
      released_task_id=v_current_harvest_task_id,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'releasedBy','fixed_thursday_harvest_reconciliation_v1',
        'reusedTaskId',v_current_harvest_task_id
      ),updated_at=now()
  where id=v_thursday_occurrence_id;

  update atlas.work_definitions
  set title_template='Bundle conditioned Thursday harvest',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'result','Thursday harvest bundled and ready for bouquet work.','weekday','Thursday'
      ),updated_at=now()
  where farm_id=v_farm_id and stable_key='postharvest_bundle_conditioned_harvest';

  update atlas.planned_work_occurrences
  set title='Bundle conditioned Thursday harvest',planned_due_date=date '2026-08-06',
      task_payload=coalesce(task_payload,'{}'::jsonb)||jsonb_build_object(
        'title','Bundle conditioned Thursday harvest','due_date','2026-08-06',
        'metadata',coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'task_key','anna_bundle_conditioned_thursday_harvest_20260806',
          'result_text','Thursday harvest bundled and ready for bouquet work.',
          'display_subject','Conditioned Thursday harvest'
        )
      ),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'weekday','Thursday','sourceScheduleReconciledAt',now()
      ),updated_at=now()
  where farm_id=v_farm_id and source_kind='task_dependency_clock'
    and source_id=v_current_harvest_task_id and state in ('planned','eligible');

  perform atlas.release_eligible_work_v1(v_farm_id,date '2026-08-04',100);
end;
$migration$;

commit;
