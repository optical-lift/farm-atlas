-- Revoke the summer U-Pick hand-weeding/zinnia plan, preserve fall tillage,
-- install the owner's weeding hierarchy, and record Master Trimmers cadence.

do $migration$
declare
  v_farm_id uuid;
  v_anna_membership_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_upick_zone_id uuid;
  v_zinnia_plan_id uuid;
  v_zinnia_s4_id uuid;
  v_zinnia_s4_sow_task_id uuid;
  v_till_task_id uuid;
  v_fall_sow_task_id uuid;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm not found.';
  end if;

  select id into v_upick_zone_id
  from atlas.zones
  where farm_id = v_farm_id
    and stable_key = 'u_pick';

  select id into v_anna_membership_id
  from atlas.farm_memberships
  where farm_id = v_farm_id
    and worker_key = 'anna'
    and active
  limit 1;

  select id, user_id into v_owner_membership_id, v_owner_user_id
  from atlas.farm_memberships
  where farm_id = v_farm_id
    and worker_key = 'lex'
    and active
  limit 1;

  select id into v_zinnia_plan_id
  from atlas.production_plans
  where farm_id = v_farm_id
    and stable_key = 'zinnia_2026';

  select id, sow_task_id into v_zinnia_s4_id, v_zinnia_s4_sow_task_id
  from atlas.production_successions
  where production_plan_id = v_zinnia_plan_id
    and sequence_number = 4;

  select id into v_till_task_id
  from atlas.tasks
  where farm_id = v_farm_id
    and metadata->>'task_key' = 'upick_till_12_beds_20261022'
  limit 1;

  select id into v_fall_sow_task_id
  from atlas.tasks
  where farm_id = v_farm_id
    and metadata->>'task_key' = 'upick_sow_overwintering_spring_crops_20261026'
  limit 1;

  -- Remove all U-Pick objects from hand-weeding. Mowing/edge work remains active.
  update atlas.maintenance_dependencies md
  set active = false,
      metadata = coalesce(md.metadata, '{}'::jsonb) || jsonb_build_object(
        'deactivated_reason', 'U-Pick hand-weeding revoked; beds will be tilled in fall',
        'deactivated_at', now(),
        'owner_decision_date', '2026-07-22'
      ),
      updated_at = now()
  where md.farm_id = v_farm_id
    and md.maintenance_object_id in (
      select mo.id
      from atlas.maintenance_objects mo
      where mo.farm_id = v_farm_id
        and mo.zone_id = v_upick_zone_id
        and mo.maintenance_type = 'weed'
    )
    and md.active;

  update atlas.maintenance_objects mo
  set active = false,
      next_eligible_date = date '2099-12-31',
      must_precede_task = false,
      planting_block_score = 0,
      owner_priority = 200,
      metadata = (
        coalesce(mo.metadata, '{}'::jsonb)
        - 'crop_unlock_priority'
        - 'owner_priority_reason'
        - 'next_planting_due_date'
        - 'weed_ready_by_date'
      ) || jsonb_build_object(
        'rotation_status', 'removed',
        'rotation_removed_at', now(),
        'rotation_removed_date', '2026-07-22',
        'rotation_removed_reason', 'No summer hand-weeding; U-Pick beds will be tilled in fall',
        'owner_hierarchy_rank', 8,
        'owner_hierarchy_label', 'U-Pick',
        'fall_tillage_task_key', 'upick_till_12_beds_20261022'
      ),
      updated_at = now()
  where mo.farm_id = v_farm_id
    and mo.zone_id = v_upick_zone_id
    and mo.maintenance_type = 'weed';

  update atlas.tasks t
  set status = 'archived',
      due_date = null,
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_at', now(),
        'archived_reason', 'U-Pick removed from hand-weeding rotation; beds will be tilled in fall',
        'original_due_date', t.due_date,
        'owner_decision_date', '2026-07-22'
      ),
      updated_at = now()
  where t.farm_id = v_farm_id
    and t.status in ('open', 'blocked')
    and (
      t.generated_from = 'maintenance_weeding_collection'
      or t.metadata->>'work_collection_key' = 'weeding'
    )
    and exists (
      select 1
      from atlas.task_objects task_object
      join atlas.growing_objects growing_object
        on growing_object.id = task_object.object_id
      where task_object.task_id = t.id
        and growing_object.zone_id = v_upick_zone_id
    );

  -- Revoke only the planned U-Pick zinnia succession and its parent/child cards.
  update atlas.tasks t
  set status = 'archived',
      due_date = null,
      blocker_text = null,
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_at', now(),
        'archived_reason', 'Owner revoked U-Pick Beds 1 and 7 zinnia succession due to weeding workload',
        'original_due_date', t.due_date,
        'owner_decision_date', '2026-07-22',
        'checklist_status', 'archived'
      ),
      updated_at = now()
  where t.farm_id = v_farm_id
    and t.status in ('open', 'blocked')
    and (
      t.id = v_zinnia_s4_sow_task_id
      or t.parent_task_id = v_zinnia_s4_sow_task_id
      or t.generated_from_id = v_zinnia_s4_id
      or t.generated_from_id = v_zinnia_s4_sow_task_id
    );

  update atlas.production_successions
  set state = 'skipped',
      skip_reason = 'Owner revoked U-Pick Beds 1 and 7 zinnia plan on 2026-07-22 because the recovery weeding load was too high.',
      metadata = (
        coalesce(metadata, '{}'::jsonb)
        - 'bed_object_ids'
        - 'bed_labels'
        - 'bed_label'
        - 'placement_status'
        - 'preparation_task_id'
        - 'preparation_task_ids'
        - 'sowing_blocked_until'
      ) || jsonb_build_object(
        'placement_status', 'revoked',
        'revoked_at', now(),
        'revoked_date', '2026-07-22',
        'revoked_reason', 'Recovery weeding load exceeds current labor capacity',
        'revoked_bed_labels', jsonb_build_array('U-Pick Bed 1', 'U-Pick Bed 7'),
        'revoked_bed_object_keys', jsonb_build_array('u_pick_bed_1', 'u_pick_bed_7'),
        'future_management', 'fall tillage; no summer zinnia succession'
      ),
      updated_at = now()
  where id = v_zinnia_s4_id;

  update atlas.production_plans
  set notes = 'Three established 2026 waves plus one intentional late succession at the House South Foundation Border. The planned U-Pick Beds 1 and 7 succession was revoked July 22 because the recovery weeding load exceeded current labor capacity. Entry Billboard was broadcast June 7–8; later transplanting within the beds and to Follow Me Arch 1 is not a separate succession.',
      metadata = jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{production_lanes,production}',
            '[1]'::jsonb,
            true
          ),
          '{production_lanes,skipped}',
          '[4]'::jsonb,
          true
        ),
        '{active_succession_count}',
        '4'::jsonb,
        true
      ) || jsonb_build_object(
        'u_pick_zinnia_plan_status', 'revoked',
        'u_pick_zinnia_plan_revoked_date', '2026-07-22'
      ),
      updated_at = now()
  where id = v_zinnia_plan_id;

  update atlas.growing_objects growing_object
  set metadata = coalesce(growing_object.metadata, '{}'::jsonb) || jsonb_build_object(
        'summer_2026_hand_weeding', false,
        'summer_2026_management', 'hold for fall tillage',
        'fall_tillage_planned', true,
        'fall_tillage_task_key', 'upick_till_12_beds_20261022',
        'management_decision_date', '2026-07-22'
      ) || case
        when growing_object.stable_key in ('u_pick_bed_1', 'u_pick_bed_7')
          then jsonb_build_object(
            'summer_2026_zinnia_plan', 'revoked',
            'summer_2026_zinnia_plan_revoked_date', '2026-07-22',
            'summer_2026_zinnia_plan_revoked_reason', 'Too much recovery weeding for current labor capacity'
          )
        else '{}'::jsonb
      end,
      updated_at = now()
  where growing_object.farm_id = v_farm_id
    and growing_object.zone_id = v_upick_zone_id
    and growing_object.object_type = 'bed';

  update atlas.zones
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'summer_2026_hand_weeding', false,
        'summer_2026_zinnia_beds_1_7', 'revoked',
        'summer_2026_management', 'Mow paths and hold beds for fall tillage',
        'fall_tillage_task_key', 'upick_till_12_beds_20261022',
        'management_decision_date', '2026-07-22',
        'maintenance_hierarchy_rank', 8
      ),
      updated_at = now()
  where id = v_upick_zone_id;

  -- Keep the October preparation/sowing work and make tillage the prerequisite.
  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'replaces_summer_hand_weeding', true,
        'summer_zinnia_plan_revoked', true,
        'owner_decision_date', '2026-07-22'
      ),
      updated_at = now()
  where id = v_till_task_id;

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'preparation_task_id', v_till_task_id,
        'preparation_task_key', 'upick_till_12_beds_20261022',
        'hand_weeding_prerequisite_removed', true,
        'preparation_method', 'fall tillage'
      ),
      updated_at = now()
  where id = v_fall_sow_task_id
     or parent_task_id = v_fall_sow_task_id;

  -- Current engine sorts larger owner_priority first.
  update atlas.maintenance_objects maintenance_object
  set owner_priority = case
        when zone.stable_key = 'field_rows' then case growing_object.stable_key
          when 'fr_18' then 1000 when 'fr_2' then 990 when 'fr_3' then 980
          when 'fr_11' then 970 when 'fr_12' then 960 when 'fr_13' then 950
          when 'fr_14' then 940 when 'fr_15' then 930 when 'fr_4' then 920
          when 'fr_5' then 910 when 'fr_6' then 900 when 'fr_9' then 890
          when 'fr_10' then 880 when 'fr_1' then 870 when 'fr_7' then 860
          when 'fr_8' then 850 when 'fr_16' then 840 when 'fr_17' then 830
          else 820
        end
        when zone.stable_key = 'main_garden' then 800
        when zone.stable_key = 'berry_walk_flower_rows' then 700
        when growing_object.stable_key = 'berry_walk_crescent_moon' then 600
        when zone.stable_key = 'entry_billboard' then 500
        when zone.stable_key = 'barn_beds' then 300
        when zone.stable_key = 'u_pick' then 200
        when zone.stable_key = 'lilac_haven' then 100
        else 400
      end,
      metadata = coalesce(maintenance_object.metadata, '{}'::jsonb) || jsonb_build_object(
        'owner_hierarchy_rank', case
          when zone.stable_key = 'field_rows' then 1
          when zone.stable_key = 'main_garden' then 2
          when zone.stable_key = 'berry_walk_flower_rows' then 3
          when growing_object.stable_key = 'berry_walk_crescent_moon' then 4
          when zone.stable_key = 'entry_billboard' then 5
          when zone.stable_key = 'barn_beds' then 7
          when zone.stable_key = 'u_pick' then 8
          when zone.stable_key = 'lilac_haven' then 9
          else 6
        end,
        'owner_hierarchy_set_at', now(),
        'owner_hierarchy_source', 'owner decision 2026-07-22'
      ),
      updated_at = now()
  from atlas.zones zone, atlas.growing_objects growing_object
  where zone.id = maintenance_object.zone_id
    and growing_object.id = maintenance_object.object_id
    and maintenance_object.farm_id = v_farm_id
    and maintenance_object.maintenance_type = 'weed';

  update atlas.maintenance_scheduler_settings
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'owner_zone_hierarchy', jsonb_build_array(
          jsonb_build_object('rank', 1, 'key', 'field_rows', 'label', 'Field Rows'),
          jsonb_build_object('rank', 2, 'key', 'main_garden', 'label', 'Main Garden'),
          jsonb_build_object('rank', 3, 'key', 'berry_walk_flower_rows', 'label', 'Berry Walk'),
          jsonb_build_object('rank', 4, 'key', 'berry_walk_crescent_moon', 'label', 'Berry Walk Crescent Moon'),
          jsonb_build_object('rank', 5, 'key', 'entry_billboard', 'label', 'Entry Billboard'),
          jsonb_build_object('rank', 6, 'key', 'perennial_landscaping', 'label', 'Perennial beds and landscaping'),
          jsonb_build_object('rank', 7, 'key', 'barn_beds', 'label', 'Barn Beds'),
          jsonb_build_object('rank', 8, 'key', 'u_pick', 'label', 'U-Pick'),
          jsonb_build_object('rank', 9, 'key', 'lilac_haven', 'label', 'Lilac Haven')
        ),
        'owner_zone_hierarchy_set_date', '2026-07-22',
        'owner_zone_hierarchy_semantics', 'lower rank is earlier; current scheduler receives descending owner_priority values'
      ),
      updated_at = now()
  where farm_id = v_farm_id
    and maintenance_type = 'weed';

  -- Record the skipped contractor visit and next expected biweekly visit.
  insert into atlas.field_logs(
    farm_id,
    log_date,
    action_types,
    summary_sentence,
    note,
    created_by,
    source,
    metadata,
    actor_user_id,
    actor_membership_id,
    actor_role,
    idempotency_key
  )
  select
    v_farm_id,
    date '2026-07-22',
    array['contractor_schedule']::text[],
    'Master Trimmers was told to skip the July 23 mowing visit and return August 6.',
    'Biweekly full-property mowing service. Master Trimmers bills Elm Farm $250 per completed visit.',
    'Lex',
    'owner_report',
    jsonb_build_object(
      'provider_key', 'master_trimmers',
      'provider_label', 'Master Trimmers',
      'service_type', 'full_property_mow',
      'cadence_days', 14,
      'preferred_weekday', 'Thursday',
      'price_per_visit', 250,
      'currency', 'USD',
      'skipped_service_date', '2026-07-23',
      'next_expected_service_date', '2026-08-06'
    ),
    v_owner_user_id,
    v_owner_membership_id,
    'owner',
    'owner-report:master-trimmers-skip-2026-07-23-return-2026-08-06'
  where not exists (
    select 1
    from atlas.field_logs
    where farm_id = v_farm_id
      and idempotency_key = 'owner-report:master-trimmers-skip-2026-07-23-return-2026-08-06'
  );

  insert into atlas.tasks(
    farm_id,
    title,
    task_type,
    status,
    priority,
    due_date,
    note,
    metadata,
    action_key,
    work_class,
    task_series_key,
    engine_instance_key,
    visibility_scope,
    assigned_membership_id
  )
  select
    v_farm_id,
    'Master Trimmers visit status',
    'contractor_service_status',
    'open',
    'normal',
    date '2026-08-06',
    'Ask whether Master Trimmers came today and completed the full-property mow. Record yes or no and any areas they skipped.',
    jsonb_build_object(
      'task_key', 'master_trimmers_visit_status_20260806',
      'anna_task', true,
      'owner_task', false,
      'assigned_to', 'Anna',
      'work_route', 'contractor_service',
      'work_rhythm', 'Property Mowing',
      'display_action', 'Did they come?',
      'display_subject', 'Master Trimmers',
      'display_detail', '$250 full-property mow · expected Thursday, Aug 6',
      'collection_zone', 'Property-wide',
      'collection_label', 'Master Trimmers',
      'provider_key', 'master_trimmers',
      'service_type', 'full_property_mow',
      'cadence_days', 14,
      'preferred_weekday', 'Thursday',
      'price_per_visit', 250,
      'currency', 'USD',
      'next_task_policy', 'Create the next confirmation 14 days after the current expected visit once the actual visit status is known'
    ),
    'verify_service',
    'light',
    'master_trimmers_biweekly_confirmation',
    'contractor_service:master_trimmers:2026-08-06',
    'assigned_worker',
    v_anna_membership_id
  where not exists (
    select 1
    from atlas.tasks
    where farm_id = v_farm_id
      and engine_instance_key = 'contractor_service:master_trimmers:2026-08-06'
      and status in ('open', 'blocked')
  );

  update atlas.maintenance_scheduler_settings
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'contractor_service', jsonb_build_object(
          'provider_key', 'master_trimmers',
          'provider_label', 'Master Trimmers',
          'service_type', 'full_property_mow',
          'cadence_days', 14,
          'preferred_weekday', 'Thursday',
          'price_per_visit', 250,
          'currency', 'USD',
          'skipped_service_date', '2026-07-23',
          'next_expected_service_date', '2026-08-06',
          'confirmation_task_series_key', 'master_trimmers_biweekly_confirmation'
        ),
        'contractor_mow_adjustment_policy', jsonb_build_object(
          'status', 'planned_not_active',
          'trigger', 'Anna confirms completed Master Trimmers full-property mow',
          'confirmed_visit_effect', 'Reset or snooze only contractor-covered mowing objects',
          'missed_visit_effect', 'Leave Anna mowing work unchanged',
          'always_anna_scope', jsonb_build_array('field_rows_walkways'),
          'future_always_anna_scope', jsonb_build_array('barn_beds_walkways'),
          'needs_scope_mapping', true
        ),
        'contractor_policy_recorded_at', now()
      ),
      updated_at = now()
  where farm_id = v_farm_id
    and maintenance_type = 'mow';

  if exists (
    select 1
    from atlas.maintenance_objects maintenance_object
    where maintenance_object.farm_id = v_farm_id
      and maintenance_object.zone_id = v_upick_zone_id
      and maintenance_object.maintenance_type = 'weed'
      and maintenance_object.active
  ) then
    raise exception 'U-Pick remains active in the weeding rotation.';
  end if;

  if exists (
    select 1
    from atlas.tasks task
    where task.farm_id = v_farm_id
      and task.status in ('open', 'blocked')
      and (
        task.id = v_zinnia_s4_sow_task_id
        or task.parent_task_id = v_zinnia_s4_sow_task_id
        or task.generated_from_id = v_zinnia_s4_id
        or task.generated_from_id = v_zinnia_s4_sow_task_id
      )
  ) then
    raise exception 'U-Pick zinnia succession still has active tasks.';
  end if;

  if not exists (
    select 1
    from atlas.production_successions
    where id = v_zinnia_s4_id
      and state = 'skipped'
  ) then
    raise exception 'U-Pick zinnia succession was not marked skipped.';
  end if;

  if not exists (
    select 1
    from atlas.tasks
    where farm_id = v_farm_id
      and engine_instance_key = 'contractor_service:master_trimmers:2026-08-06'
      and assigned_membership_id = v_anna_membership_id
      and due_date = date '2026-08-06'
      and status = 'open'
  ) then
    raise exception 'Master Trimmers confirmation task was not created for Anna.';
  end if;
end;
$migration$;

-- Recalculation must preserve the owner-defined hierarchy rather than flattening
-- every non-Field-Row object back to the same priority.
create or replace function atlas.recalculate_weeding_priorities(
  p_farm_key text default 'elm_farm'::text,
  p_as_of date default current_date
)
returns integer
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_farm_id uuid;
  v_updated integer := 0;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = p_farm_key;

  if v_farm_id is null then
    raise exception 'Unknown farm key: %', p_farm_key;
  end if;

  update atlas.maintenance_objects maintenance_object
  set next_eligible_date = case
        when maintenance_object.next_eligible_date is null
          or maintenance_object.next_eligible_date < p_as_of
          then p_as_of
        else maintenance_object.next_eligible_date
      end,
      priority_score = greatest(
        0,
        p_as_of - coalesce(maintenance_object.last_completed_at::date, date '1900-01-01')
      ),
      owner_priority = case
        when zone.stable_key = 'field_rows' then case growing_object.stable_key
          when 'fr_18' then 1000 when 'fr_2' then 990 when 'fr_3' then 980
          when 'fr_11' then 970 when 'fr_12' then 960 when 'fr_13' then 950
          when 'fr_14' then 940 when 'fr_15' then 930 when 'fr_4' then 920
          when 'fr_5' then 910 when 'fr_6' then 900 when 'fr_9' then 890
          when 'fr_10' then 880 when 'fr_1' then 870 when 'fr_7' then 860
          when 'fr_8' then 850 when 'fr_16' then 840 when 'fr_17' then 830
          else 820
        end
        when zone.stable_key = 'main_garden' then 800
        when zone.stable_key = 'berry_walk_flower_rows' then 700
        when growing_object.stable_key = 'berry_walk_crescent_moon' then 600
        when zone.stable_key = 'entry_billboard' then 500
        when zone.stable_key = 'barn_beds' then 300
        when zone.stable_key = 'u_pick' then 200
        when zone.stable_key = 'lilac_haven' then 100
        else 400
      end,
      metadata = coalesce(maintenance_object.metadata, '{}'::jsonb) || jsonb_build_object(
        'owner_hierarchy_rank', case
          when zone.stable_key = 'field_rows' then 1
          when zone.stable_key = 'main_garden' then 2
          when zone.stable_key = 'berry_walk_flower_rows' then 3
          when growing_object.stable_key = 'berry_walk_crescent_moon' then 4
          when zone.stable_key = 'entry_billboard' then 5
          when zone.stable_key = 'barn_beds' then 7
          when zone.stable_key = 'u_pick' then 8
          when zone.stable_key = 'lilac_haven' then 9
          else 6
        end,
        'priority_recalculated_at', now(),
        'priority_reason', case
          when zone.stable_key = 'field_rows' then 'Owner hierarchy 1: Field Rows'
          when zone.stable_key = 'main_garden' then 'Owner hierarchy 2: Main Garden'
          when zone.stable_key = 'berry_walk_flower_rows' then 'Owner hierarchy 3: Berry Walk'
          when growing_object.stable_key = 'berry_walk_crescent_moon' then 'Owner hierarchy 4: Berry Walk Crescent Moon'
          when zone.stable_key = 'entry_billboard' then 'Owner hierarchy 5: Entry Billboard'
          when zone.stable_key = 'barn_beds' then 'Owner hierarchy 7: Barn Beds'
          when zone.stable_key = 'u_pick' then 'Owner hierarchy 8: U-Pick'
          when zone.stable_key = 'lilac_haven' then 'Owner hierarchy 9: Lilac Haven'
          else 'Owner hierarchy 6: perennial beds and landscaping'
        end
      ),
      updated_at = now()
  from atlas.zones zone,
       atlas.growing_objects growing_object
  where zone.id = maintenance_object.zone_id
    and growing_object.id = maintenance_object.object_id
    and maintenance_object.farm_id = v_farm_id
    and maintenance_object.maintenance_type = 'weed'
    and maintenance_object.active;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

select atlas.recalculate_weeding_priorities('elm_farm', date '2026-07-22');
