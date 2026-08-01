begin;

do $pilot$
declare
  v_farm_id uuid;
  v_source_task_id uuid;
  v_source_due_date date;
  v_source_count integer;
  v_anna_membership_id uuid;
  v_anna_count integer;
  v_definition_id uuid;
  v_policy_id uuid;
  v_occurrence_id uuid;
  v_existing_state text;
  v_existing_released_task_id uuid;
begin
  select farm.id into v_farm_id
  from atlas.farms farm
  where farm.stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm was not found for the harvest-conditioning pilot.';
  end if;

  select count(*)::integer, min(task.id), min(task.due_date)
  into v_source_count, v_source_task_id, v_source_due_date
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.status in ('open','blocked')
    and task.metadata ->> 'task_key' = 'anna_harvest_friday_weekly_20260807';

  if v_source_count <> 1 or v_source_task_id is null or v_source_due_date is null then
    raise exception 'Expected exactly one open Friday harvest source task, found %.', v_source_count;
  end if;

  select count(*)::integer, min(membership.id)
  into v_anna_count, v_anna_membership_id
  from atlas.farm_memberships membership
  join atlas.user_profiles profile on profile.user_id = membership.user_id
  where membership.farm_id = v_farm_id
    and membership.active = true
    and membership.role = 'farm_hand'
    and profile.display_name = 'Anna';

  if v_anna_count <> 1 or v_anna_membership_id is null then
    raise exception 'Expected exactly one active Anna farm-hand membership, found %.', v_anna_count;
  end if;

  insert into atlas.work_definitions(
    farm_id,
    stable_key,
    title_template,
    task_type,
    source_kind,
    action_key,
    work_class,
    default_priority,
    default_visibility_scope,
    active,
    metadata
  ) values (
    v_farm_id,
    'postharvest_bundle_conditioned_harvest',
    'Bundle conditioned Friday harvest',
    'postharvest_bundle',
    'task_dependency_clock',
    'bundle',
    'standard',
    'high',
    'assigned_worker',
    true,
    jsonb_build_object(
      'dependency_clock_managed', true,
      'workflow', 'harvest_condition_bundle',
      'result', 'Friday harvest bundled and ready for bouquet work.'
    )
  )
  on conflict (farm_id, stable_key) do update set
    title_template = excluded.title_template,
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

  insert into atlas.work_release_policies(
    farm_id,
    work_definition_id,
    stable_key,
    gate_type,
    horizon_days,
    maximum_active_instances,
    gate_config,
    active,
    metadata
  ) values (
    v_farm_id,
    v_definition_id,
    'dependency_clock:postharvest_bundle_conditioned_harvest',
    'predecessor',
    1,
    1,
    jsonb_build_object(
      'engine', 'task_dependency_clock_v1',
      'source_transition', 'done',
      'delay_minutes', 180
    ),
    true,
    jsonb_build_object(
      'workflow', 'harvest_condition_bundle',
      'owner_authorized_at', now()
    )
  )
  on conflict (farm_id, stable_key) do update set
    work_definition_id = excluded.work_definition_id,
    gate_type = excluded.gate_type,
    horizon_days = excluded.horizon_days,
    maximum_active_instances = excluded.maximum_active_instances,
    gate_config = excluded.gate_config,
    active = true,
    metadata = atlas.work_release_policies.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_policy_id;

  select occurrence.state, occurrence.released_task_id
  into v_existing_state, v_existing_released_task_id
  from atlas.planned_work_occurrences occurrence
  where occurrence.farm_id = v_farm_id
    and occurrence.work_definition_id = v_definition_id
    and occurrence.occurrence_key = 'elm:bundle-conditioned-harvest:2026-08-07';

  if v_existing_state is not null
    and (v_existing_state not in ('planned','eligible','failed') or v_existing_released_task_id is not null)
  then
    raise exception 'The Friday bundling pilot occurrence has already been released or closed.';
  end if;

  insert into atlas.planned_work_occurrences(
    farm_id,
    work_definition_id,
    release_policy_id,
    occurrence_key,
    source_kind,
    source_id,
    source_event_key,
    title,
    planned_due_date,
    not_before_date,
    state,
    gate_satisfied_at,
    task_payload,
    relation_payload,
    metadata
  ) values (
    v_farm_id,
    v_definition_id,
    v_policy_id,
    'elm:bundle-conditioned-harvest:2026-08-07',
    'task_dependency_clock',
    v_source_task_id,
    'done_plus_3_hours',
    'Bundle conditioned Friday harvest',
    v_source_due_date,
    v_source_due_date,
    'planned',
    null,
    jsonb_build_object(
      'title', 'Bundle conditioned Friday harvest',
      'task_type', 'postharvest_bundle',
      'status', 'open',
      'priority', 'high',
      'action_key', 'bundle',
      'work_class', 'standard',
      'visibility_scope', 'assigned_worker',
      'assigned_membership_id', v_anna_membership_id,
      'generated_from', 'task_dependency_clock',
      'generated_from_id', v_source_task_id,
      'unlock_text', 'Friday bouquet work can begin after the conditioned stems are bundled.',
      'metadata', jsonb_build_object(
        'task_key', 'anna_bundle_conditioned_friday_harvest_20260807',
        'anna_task', true,
        'assignee_key', 'anna',
        'assigned_to', 'Anna',
        'work_route', 'postharvest',
        'work_rhythm', 'Postharvest',
        'work_order_anchor', 'late_morning',
        'display_action', 'Bundle',
        'display_subject', 'Conditioned Friday harvest',
        'display_detail', 'Released after 3 hours of conditioning',
        'collection_zone', 'Elm Farm',
        'collection_label', 'Postharvest',
        'dependency_clock_managed', true,
        'dependency_source_task_id', v_source_task_id,
        'conditioning_minutes', 180,
        'result_text', 'Friday harvest bundled and ready for bouquet work.',
        'detail_lines', jsonb_build_array(
          'Gather the conditioned Friday harvest.',
          'Bundle stems by the farm standard.',
          'Leave the bundled harvest ready for bouquet work.'
        )
      )
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'dependency_clock_state', 'waiting',
      'dependency_source_task_id', v_source_task_id,
      'conditioning_minutes', 180,
      'pilot', 'friday_harvest_conditioning_v1'
    )
  )
  on conflict (farm_id, work_definition_id, occurrence_key) do update set
    release_policy_id = excluded.release_policy_id,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    source_event_key = excluded.source_event_key,
    title = excluded.title,
    planned_due_date = excluded.planned_due_date,
    not_before_date = excluded.not_before_date,
    state = 'planned',
    gate_satisfied_at = null,
    task_payload = excluded.task_payload,
    relation_payload = excluded.relation_payload,
    metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_occurrence_id;

  insert into atlas.task_dependency_clocks(
    farm_id,
    source_task_id,
    downstream_occurrence_id,
    source_transitions,
    delay_interval,
    state,
    notification_policy,
    metadata
  ) values (
    v_farm_id,
    v_source_task_id,
    v_occurrence_id,
    array['done']::text[],
    interval '3 hours',
    'waiting',
    jsonb_build_object(
      'notify_when_ready', true,
      'ready_title', 'Friday flowers are conditioned',
      'ready_body', 'Bundle the conditioned harvest now.',
      'followup_after_minutes', 30,
      'followup_title', 'Conditioned flowers are waiting',
      'followup_body', 'Bundling still blocks Friday bouquet work.',
      'importance', 'normal'
    ),
    jsonb_build_object(
      'workflow', 'harvest_condition_bundle',
      'pilot', 'friday_harvest_conditioning_v1',
      'configured_from_source_task_key', 'anna_harvest_friday_weekly_20260807'
    )
  )
  on conflict (downstream_occurrence_id) do update set
    farm_id = excluded.farm_id,
    source_task_id = excluded.source_task_id,
    source_transitions = excluded.source_transitions,
    source_result_path = null,
    source_result_equals = null,
    delay_interval = excluded.delay_interval,
    state = 'waiting',
    source_transition_id = null,
    source_satisfied_at = null,
    ready_at = null,
    downstream_task_id = null,
    released_at = null,
    initial_notified_at = null,
    followup_notified_at = null,
    notification_policy = excluded.notification_policy,
    metadata = atlas.task_dependency_clocks.metadata || excluded.metadata,
    updated_at = now();

  update atlas.tasks
  set metadata = metadata || jsonb_build_object(
    'dependency_clock_managed', true,
    'dependency_downstream_occurrence_id', v_occurrence_id,
    'dependency_downstream_title', 'Bundle conditioned Friday harvest',
    'dependency_delay_minutes', 180,
    'dependency_result', 'Friday harvest bundled and ready for bouquet work.'
  ),
  updated_at = now()
  where id = v_source_task_id;
end;
$pilot$;

comment on function atlas.advance_task_dependency_clocks_v1(timestamptz, integer) is
  'Advances elapsed dependency clocks, satisfies canonical planned-work gates, releases downstream tasks, and sends quiet-hours-aware direct push notifications. Ordinary releases do not create Bell history.';

commit;
