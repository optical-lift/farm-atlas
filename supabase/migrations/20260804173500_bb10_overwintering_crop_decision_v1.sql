-- Reopen BB10's post-treatment crop plan instead of preselecting ProCut Horizon.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_bb10_id uuid;
  v_decision_task_id uuid;
  v_confirm_task_id uuid;
  v_decision_occurrence_id uuid;
  v_confirm_occurrence_id uuid;
  v_horizon_cycle_id uuid;
  v_transition jsonb;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  select id, user_id
  into v_owner_membership_id, v_owner_user_id
  from atlas.farm_memberships
  where farm_id = v_farm_id
    and worker_key = 'lex'
    and active
  limit 1;

  select id into v_bb10_id
  from atlas.growing_objects
  where farm_id = v_farm_id
    and stable_key = 'bb_10';

  select id, planned_occurrence_id
  into v_decision_task_id, v_decision_occurrence_id
  from atlas.tasks
  where farm_id = v_farm_id
    and metadata ->> 'task_key' in (
      'owner_20260825_sow_procut_horizon_bb10',
      'owner_20260825_choose_overwintering_crop_bb10'
    )
    and status in ('open', 'blocked')
  order by case
    when metadata ->> 'task_key' = 'owner_20260825_sow_procut_horizon_bb10' then 0
    else 1
  end, created_at
  limit 1;

  select id, planned_occurrence_id
  into v_confirm_task_id, v_confirm_occurrence_id
  from atlas.tasks
  where farm_id = v_farm_id
    and metadata ->> 'task_key' in (
      'owner_20260825_confirm_bb10_ready_to_sow',
      'owner_20260825_confirm_bb10_treatment_complete'
    )
    and status in ('open', 'blocked')
  order by case
    when metadata ->> 'task_key' = 'owner_20260825_confirm_bb10_ready_to_sow' then 0
    else 1
  end, created_at
  limit 1;

  select id into v_horizon_cycle_id
  from atlas.crop_cycles
  where farm_id = v_farm_id
    and object_id = v_bb10_id
    and crop_profile_id = (
      select id
      from atlas.crop_profiles
      where stable_key = 'sunflower_procut_horizon'
    )
    and lifecycle_status in ('planned', 'active')
    and sown_date is null
  order by created_at desc
  limit 1;

  if v_farm_id is null
    or v_owner_membership_id is null
    or v_bb10_id is null
    or v_decision_task_id is null
    or v_confirm_task_id is null
  then
    raise exception 'BB10 overwintering decision prerequisites are missing.';
  end if;

  v_transition := jsonb_build_object(
    'transition', 'changed_plan',
    'action_key', 'decide',
    'work_class', 'standard',
    'recorded_at', now(),
    'target_date', date '2026-08-25',
    'note', 'ProCut Horizon is no longer preselected for BB10.',
    'reason', 'Keep BB10 open for an overwintering crop decision after Bermuda-grass treatment.',
    'idempotency_key', 'owner:bb10:open-overwintering-crop-decision:2026-08-04'
  );

  update atlas.tasks
  set title = 'Confirm BB10 Treatment Is Complete',
      note = 'After the third Bermuda-grass treatment, confirm that BB10 is ready to return to crop planning.',
      metadata = (
        coalesce(metadata, '{}'::jsonb)
        - 'display_subject'
        - 'task_key'
      ) || jsonb_build_object(
        'task_key', 'owner_20260825_confirm_bb10_treatment_complete',
        'display_action', 'Confirm',
        'display_subject', 'BB10 Treatment Is Complete',
        'display_location', 'BB10',
        'decision_scope', 'overwintering_crop',
        'next_step', 'Choose the overwintering crop for BB10',
        'owner_instruction_date', '2026-08-04'
      ),
      updated_at = now()
  where id = v_confirm_task_id;

  if v_confirm_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set title = 'Confirm BB10 Treatment Is Complete',
        task_payload = jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(task_payload, '{}'::jsonb),
              '{title}',
              to_jsonb('Confirm BB10 Treatment Is Complete'::text),
              true
            ),
            '{note}',
            to_jsonb('After the third Bermuda-grass treatment, confirm that BB10 is ready to return to crop planning.'::text),
            true
          ),
          '{metadata}',
          (
            coalesce(task_payload -> 'metadata', '{}'::jsonb)
            - 'display_subject'
            - 'task_key'
          ) || jsonb_build_object(
            'task_key', 'owner_20260825_confirm_bb10_treatment_complete',
            'display_action', 'Confirm',
            'display_subject', 'BB10 Treatment Is Complete',
            'display_location', 'BB10',
            'decision_scope', 'overwintering_crop',
            'next_step', 'Choose the overwintering crop for BB10',
            'owner_instruction_date', '2026-08-04'
          ),
          true
        ),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'decisionScope', 'overwintering_crop',
          'updatedBy', 'bb10_overwintering_crop_decision_v1'
        ),
        updated_at = now()
    where id = v_confirm_occurrence_id;
  end if;

  delete from atlas.task_crop_cycles
  where task_id = v_decision_task_id;

  if v_horizon_cycle_id is not null then
    delete from atlas.crop_placements
    where crop_cycle_id = v_horizon_cycle_id;

    update atlas.crop_cycles
    set cycle_state = 'cancelled',
        lifecycle_status = 'archived',
        source_task_id = null,
        note = 'Cancelled before sowing. BB10 is open for an overwintering crop decision.',
        metadata = (
          coalesce(metadata, '{}'::jsonb)
          - array[
            'plan_status',
            'planned_date',
            'readiness_blocked',
            'readiness_blocked_until',
            'readiness_blocked_reason',
            'production_plan_id',
            'production_plan_key',
            'crop_profile_stable_key'
          ]::text[]
        ) || jsonb_build_object(
          'archivedAt', now(),
          'archivedReason', 'Owner reopened BB10 for an overwintering crop decision before sowing.',
          'decisionScope', 'overwintering_crop',
          'replacementCropStatus', 'open_decision'
        ),
        updated_at = now()
    where id = v_horizon_cycle_id;
  end if;

  update atlas.tasks
  set title = 'Choose Overwintering Crop for BB10',
      task_type = 'owner_planning',
      action_key = 'decide',
      work_class = 'standard',
      note = 'After BB10 treatment is complete, choose the overwintering crop before any sowing task is created.',
      metadata = (
        coalesce(metadata, '{}'::jsonb)
        - array[
          'crop',
          'variety',
          'work_route',
          'work_rhythm',
          'detail_lines',
          'spacing_lines',
          'detail_heading',
          'expected_stems',
          'crop_profile_id',
          'season_end_date',
          'planned_sow_date',
          'seed_packet_name',
          'projection_status',
          'sowing_slack_days',
          'crop_change_reason',
          'production_plan_id',
          'sowing_urgency_key',
          'spray_applied_date',
          'minimal_sowing_card',
          'plant_spacing_lines',
          'production_plan_key',
          'succession_sequence',
          'latest_safe_sow_date',
          'plant_spacing_source',
          'sowing_urgency_label',
          'clear_bed_offset_days',
          'expected_stems_source',
          'production_plan_label',
          'projected_harvest_end',
          'projection_anchor_date',
          'crop_profile_stable_key',
          'projected_harvest_start',
          'projection_detail_lines',
          'projected_clear_bed_date',
          'projected_transplant_end',
          'projected_germination_end',
          'production_plan_stable_key',
          'projected_transplant_start',
          'projected_germination_start',
          'projection_base_detail_lines',
          'readiness_blocked_until'
        ]::text[]
      ) || jsonb_build_object(
        'task_key', 'owner_20260825_choose_overwintering_crop_bb10',
        'work_lane', 'process_continuation',
        'owner_task', true,
        'anna_task', false,
        'assigned_to', 'owner',
        'assignee_key', 'owner',
        'display_action', 'Choose',
        'display_subject', 'Overwintering Crop for BB10',
        'display_detail', 'Crop decision',
        'display_location', 'BB10',
        'location_label', 'BB10',
        'collection_zone', 'Barn Beds',
        'collection_label', 'BB10 Overwintering Crop Decision',
        'commitment_kind', 'dependency',
        'decision_scope', 'overwintering_crop',
        'crop_plan_status', 'open_decision',
        'readiness_blocked', true,
        'readiness_blocked_reason', 'BB10 treatment must be confirmed complete before choosing the overwintering crop.',
        'last_transition', v_transition,
        'transition_count', coalesce((metadata ->> 'transition_count')::integer, 0) + 1,
        'owner_instruction_date', '2026-08-04'
      ),
      updated_at = now()
  where id = v_decision_task_id;

  insert into atlas.task_transitions(
    farm_id,
    task_id,
    transition,
    previous_status,
    next_status,
    previous_due_date,
    target_date,
    action_key,
    work_class,
    note,
    reason,
    idempotency_key,
    payload,
    created_by,
    actor_user_id,
    actor_membership_id,
    actor_role
  ) values (
    v_farm_id,
    v_decision_task_id,
    'changed_plan',
    'blocked',
    'blocked',
    date '2026-08-25',
    date '2026-08-25',
    'decide',
    'standard',
    'ProCut Horizon is no longer preselected for BB10.',
    'Keep BB10 open for an overwintering crop decision after Bermuda-grass treatment.',
    'owner:bb10:open-overwintering-crop-decision:2026-08-04',
    jsonb_build_object(
      'previousCrop', 'ProCut Horizon',
      'nextCropStatus', 'open_decision',
      'decisionScope', 'overwintering_crop'
    ),
    'owner',
    v_owner_user_id,
    v_owner_membership_id,
    'owner'
  )
  on conflict (farm_id, idempotency_key) do nothing;

  if v_decision_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set title = 'Choose Overwintering Crop for BB10',
        task_payload = (
          coalesce(task_payload, '{}'::jsonb)
          || jsonb_build_object(
            'title', 'Choose Overwintering Crop for BB10',
            'task_type', 'owner_planning',
            'action_key', 'decide',
            'work_class', 'standard',
            'note', 'After BB10 treatment is complete, choose the overwintering crop before any sowing task is created.'
          )
        ) || jsonb_build_object(
          'metadata', (
            coalesce(task_payload -> 'metadata', '{}'::jsonb)
            - array[
              'crop',
              'variety',
              'work_route',
              'work_rhythm',
              'detail_lines',
              'spacing_lines',
              'detail_heading',
              'expected_stems',
              'crop_profile_id',
              'season_end_date',
              'planned_sow_date',
              'seed_packet_name',
              'projection_status',
              'sowing_slack_days',
              'crop_change_reason',
              'production_plan_id',
              'sowing_urgency_key',
              'spray_applied_date',
              'minimal_sowing_card',
              'plant_spacing_lines',
              'production_plan_key',
              'succession_sequence',
              'latest_safe_sow_date',
              'plant_spacing_source',
              'sowing_urgency_label',
              'clear_bed_offset_days',
              'expected_stems_source',
              'production_plan_label',
              'projected_harvest_end',
              'projection_anchor_date',
              'crop_profile_stable_key',
              'projected_harvest_start',
              'projection_detail_lines',
              'projected_clear_bed_date',
              'projected_transplant_end',
              'projected_germination_end',
              'production_plan_stable_key',
              'projected_transplant_start',
              'projected_germination_start',
              'projection_base_detail_lines',
              'readiness_blocked_until'
            ]::text[]
          ) || jsonb_build_object(
            'task_key', 'owner_20260825_choose_overwintering_crop_bb10',
            'work_lane', 'process_continuation',
            'owner_task', true,
            'anna_task', false,
            'assigned_to', 'owner',
            'assignee_key', 'owner',
            'display_action', 'Choose',
            'display_subject', 'Overwintering Crop for BB10',
            'display_detail', 'Crop decision',
            'display_location', 'BB10',
            'location_label', 'BB10',
            'collection_zone', 'Barn Beds',
            'collection_label', 'BB10 Overwintering Crop Decision',
            'commitment_kind', 'dependency',
            'decision_scope', 'overwintering_crop',
            'crop_plan_status', 'open_decision',
            'readiness_blocked', true,
            'readiness_blocked_reason', 'BB10 treatment must be confirmed complete before choosing the overwintering crop.',
            'last_transition', v_transition,
            'owner_instruction_date', '2026-08-04'
          )
        ),
        relation_payload = coalesce(relation_payload, '{}'::jsonb) - 'task_crop_cycles',
        metadata = (
          coalesce(metadata, '{}'::jsonb)
          - 'nextVariety'
          - 'previousVariety'
        ) || jsonb_build_object(
          'cropPlanStatus', 'open_decision',
          'decisionScope', 'overwintering_crop',
          'cropPlanChangedAt', now(),
          'updatedBy', 'bb10_overwintering_crop_decision_v1'
        ),
        updated_at = now()
    where id = v_decision_occurrence_id;
  end if;

  perform atlas.sync_crop_cycle_registry_v1(v_farm_id, v_bb10_id);

  update atlas.object_state
  set decision_required = true,
      metadata = (
        coalesce(metadata, '{}'::jsonb)
        - array[
          'planned_crop',
          'planned_crop_label',
          'planned_crop_variety',
          'planned_crop_profile_stable_key',
          'planned_sow_date',
          'planned_sow_not_before'
        ]::text[]
      ) || jsonb_build_object(
        'availability', 'unavailable',
        'unavailable_reason', 'Bermuda grass treatment in progress',
        'management_decision', 'Complete treatment, confirm readiness, then choose an overwintering crop. No crop is preselected.',
        'next_crop_status', 'open_decision',
        'next_crop_scope', 'overwintering_crop',
        'next_crop_decision_after', '2026-08-25',
        'readiness_review_on', '2026-08-25'
      ),
      updated_at = now()
  where object_id = v_bb10_id;

  update atlas.growing_objects
  set metadata = (
        coalesce(metadata, '{}'::jsonb)
        - array[
          'planned_crop',
          'planned_crop_label',
          'planned_crop_variety',
          'planned_crop_profile_stable_key',
          'planned_crop_cycle_id',
          'planned_sow_date'
        ]::text[]
      ) || jsonb_build_object(
        'next_crop_status', 'open_decision',
        'next_crop_scope', 'overwintering_crop',
        'next_crop_decision_after', '2026-08-25'
      ),
      updated_at = now()
  where id = v_bb10_id;

  perform atlas.reconcile_task_prerequisite_gate_v1(v_decision_task_id, now());
end;
$migration$;

commit;
