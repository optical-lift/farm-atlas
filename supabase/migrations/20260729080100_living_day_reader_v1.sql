-- Build 5: prepared Living Day reader.
-- This reader is a lens over canonical tasks, results, crop cycles, Journal events,
-- and Clock state. It does not create a goal truth or release tasks. Build 7 may
-- later replace the four Elm pilot projections with a generic goal evaluator.

create or replace function atlas.living_day_task_ref_v1(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select case when t.id is null then null else jsonb_build_object(
    'taskId', t.id,
    'title', t.title,
    'status', t.status,
    'dueDate', t.due_date,
    'taskType', t.task_type,
    'actionKey', t.action_key,
    'workClass', t.work_class,
    'priority', t.priority,
    'blockerText', t.blocker_text
  ) end
  from (select p_task_id as id) requested
  left join atlas.tasks t
    on t.id = requested.id
   and atlas.can_read_task_in_journal_v1(t.id);
$$;

revoke all on function atlas.living_day_task_ref_v1(uuid) from public, anon, authenticated;

create or replace function atlas.living_day_v1(
  p_farm_id uuid,
  p_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Chicago')::date);
  v_journal jsonb;
  v_carried_rhythms jsonb := '[]'::jsonb;
  v_owner_decisions jsonb := '[]'::jsonb;
  v_goals jsonb := '[]'::jsonb;
  v_completion_summary jsonb;

  v_eb_mark_task_id uuid;
  v_eb_parent_one_id uuid;
  v_eb_parent_two_id uuid;
  v_eb_next_task_id uuid;
  v_eb_mark_done boolean := false;
  v_eb_blocker_resolved boolean := false;
  v_eb_sown_count integer := 0;
  v_eb_goal jsonb;

  v_fr_next_task_id uuid;
  v_fr_sown_count integer := 0;
  v_fr_requirements jsonb := '[]'::jsonb;
  v_fr_goal jsonb;

  v_fr15_cycle_id uuid;
  v_fr15_sown boolean := false;
  v_fr15_germination_checked boolean := false;
  v_fr15_sown_date date;
  v_fr15_germination_date date;
  v_fr15_window_start date;
  v_fr15_window_end date;
  v_fr15_next_task_id uuid;
  v_fr15_goal jsonb;

  v_zinnia_weeded_count integer := 0;
  v_zinnia_harvest_started boolean := false;
  v_zinnia_first_harvest date;
  v_zinnia_window_start date;
  v_zinnia_next_task_id uuid;
  v_zinnia_requirements jsonb := '[]'::jsonb;
  v_zinnia_goal jsonb;

  v_completed integer := 0;
  v_partial integer := 0;
  v_migrated integer := 0;
  v_blocked integer := 0;
  v_restored integer := 0;
  v_advanced integer := 0;
  v_unlocked integer := 0;
  v_plan_open integer := 0;
  v_plan_done integer := 0;
begin
  if auth.uid() is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership is required to read the Living Day.' using errcode = '42501';
  end if;

  v_journal := atlas.journal_day_v1(p_farm_id, v_day);

  select coalesce(jsonb_agg(jsonb_build_object(
    'entryKey', 'rhythm:' || state.id::text,
    'entryKind', 'rhythm',
    'stateId', state.id,
    'rhythmKey', state.rhythm_key,
    'state', state.state,
    'title', case state.state
      when 'fallen_out_of_rhythm' then object.label || ' needs restoration'
      else object.label || ' is recovering'
    end,
    'detail', case state.state
      when 'fallen_out_of_rhythm' then 'The owner-authored rhythm expired without qualifying evidence.'
      else 'Corrective work has started, but the rhythm has not yet been restored.'
    end,
    'objectId', object.id,
    'objectKey', object.stable_key,
    'objectLabel', object.label,
    'dueAt', state.due_at,
    'failureAt', state.failure_at,
    'currentTask', atlas.living_day_task_ref_v1(state.current_task_id),
    'excludedFromDenominator', true,
    'physicalConditionClaim', 'not_inferred_from_time'
  ) order by
    case state.state when 'fallen_out_of_rhythm' then 0 else 1 end,
    state.failure_at nulls last,
    object.sort_order,
    object.label), '[]'::jsonb)
  into v_carried_rhythms
  from atlas.rhythm_state state
  join atlas.growing_objects object
    on state.subject_kind = 'growing_object'
   and object.id = state.subject_id
  where state.farm_id = p_farm_id
    and state.state in ('fallen_out_of_rhythm', 'recovering')
    and atlas.can_read_rhythm_state_v1(state.id);

  if atlas.is_farm_owner(p_farm_id) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'entryKey', 'owner-decision:' || task.id::text,
      'entryKind', 'owner_decision',
      'taskId', task.id,
      'title', task.title,
      'detail', coalesce(task.blocker_text, task.note, 'Owner decision or action remains open.'),
      'status', task.status,
      'dueDate', task.due_date,
      'excludedFromDenominator', task.due_date is distinct from v_day
    ) order by task.due_date nulls first, task.priority desc, task.created_at), '[]'::jsonb)
    into v_owner_decisions
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.status in ('open', 'blocked')
      and (task.due_date is null or task.due_date <= v_day)
      and (
        lower(coalesce(task.metadata ->> 'owner_task', 'false')) = 'true'
        or lower(coalesce(task.metadata ->> 'assigned_to', '')) = 'owner'
        or task.visibility_scope = 'owner'
      )
      and atlas.can_read_task_in_journal_v1(task.id);
  end if;

  -- Goal 1: Open EB1-EB6 for ProCut Orange.
  select id into v_eb_mark_task_id
  from atlas.tasks
  where farm_id = p_farm_id
    and metadata ->> 'task_key' = 'owner_20260726_mark_spray_eb1_6'
  order by created_at desc
  limit 1;

  select id into v_eb_parent_one_id
  from atlas.tasks
  where farm_id = p_farm_id
    and metadata ->> 'task_key' = 'entry_billboard_pollenless_2026_s1_parent'
  order by created_at desc
  limit 1;

  select id into v_eb_parent_two_id
  from atlas.tasks
  where farm_id = p_farm_id
    and metadata ->> 'task_key' = 'entry_billboard_pollenless_2026_s2_parent'
  order by created_at desc
  limit 1;

  select coalesce(status = 'done', false)
  into v_eb_mark_done
  from atlas.tasks
  where id = v_eb_mark_task_id;
  v_eb_mark_done := coalesce(v_eb_mark_done, false);

  v_eb_blocker_resolved := v_eb_mark_done and not exists (
    select 1
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and (
        task.id in (v_eb_parent_one_id, v_eb_parent_two_id)
        or task.parent_task_id in (v_eb_parent_one_id, v_eb_parent_two_id)
      )
      and task.status not in ('done', 'archived', 'skipped')
      and (
        task.status = 'blocked'
        or nullif(btrim(coalesce(task.blocker_text, '')), '') is not null
        or lower(coalesce(task.metadata ->> 'readiness_lane', '')) = 'not_ready'
      )
  );

  select count(distinct object.stable_key)::integer
  into v_eb_sown_count
  from atlas.growing_objects object
  join atlas.crop_cycles cycle on cycle.object_id = object.id
  left join atlas.crop_profiles profile on profile.id = cycle.crop_profile_id
  where object.farm_id = p_farm_id
    and object.stable_key in (
      'eb_sunflower_1','eb_sunflower_2','eb_sunflower_3',
      'eb_sunflower_4','eb_sunflower_5','eb_sunflower_6'
    )
    and cycle.lifecycle_status = 'active'
    and cycle.sown_date is not null
    and (
      profile.stable_key = 'sunflower_procut_orange'
      or lower(coalesce(cycle.variety, '')) = 'procut orange'
    );

  v_eb_next_task_id := case
    when not v_eb_mark_done then v_eb_mark_task_id
    when not v_eb_blocker_resolved then v_eb_parent_one_id
    when exists (select 1 from atlas.tasks where id = v_eb_parent_one_id and status in ('open','blocked')) then v_eb_parent_one_id
    else v_eb_parent_two_id
  end;

  v_eb_goal := jsonb_build_object(
    'goalKey', 'elm_eb1_eb6_procut_open_v1',
    'title', 'Open EB1-EB6 for ProCut Orange',
    'summary', 'Turn the front six Entry Billboard beds into one confirmed production block.',
    'state', case
      when v_eb_sown_count = 6 then 'realized'
      when v_eb_sown_count > 0 then 'in_production'
      when v_eb_blocker_resolved then 'nearly_unlocked'
      else 'locked'
    end,
    'progress', jsonb_build_object(
      'satisfied', (case when v_eb_mark_done then 1 else 0 end)
        + (case when v_eb_blocker_resolved then 1 else 0 end)
        + (case when v_eb_sown_count = 6 then 1 else 0 end),
      'total', 3,
      'label', v_eb_sown_count::text || '/6 beds sown'
    ),
    'requirements', jsonb_build_array(
      jsonb_build_object(
        'requirementKey', 'mark_and_spot_spray',
        'label', 'Mark rows and spot-spray living regrowth',
        'state', case when v_eb_mark_done then 'satisfied' else 'unmet' end,
        'sourceKind', 'task',
        'sourceId', v_eb_mark_task_id,
        'task', atlas.living_day_task_ref_v1(v_eb_mark_task_id)
      ),
      jsonb_build_object(
        'requirementKey', 'owner_readiness_decision',
        'label', 'Clear biomass and record the Owner ProCut go/no-go',
        'state', case when v_eb_blocker_resolved then 'satisfied' else 'unmet' end,
        'detail', case when v_eb_blocker_resolved then 'The canonical readiness blocker is resolved.' else 'EB1-EB3 still carry the mechanical-clearance and Owner-decision blocker.' end,
        'sourceKind', 'task_blocker',
        'sourceId', v_eb_parent_one_id
      ),
      jsonb_build_object(
        'requirementKey', 'six_beds_sown',
        'label', 'Sow ProCut Orange in all six beds',
        'state', case when v_eb_sown_count = 6 then 'satisfied' when v_eb_sown_count > 0 then 'partial' else 'unmet' end,
        'detail', v_eb_sown_count::text || ' of 6 canonical bed crop cycles are active and sown.',
        'sourceKind', 'crop_cycle_set',
        'sourceId', null
      )
    ),
    'nextMove', atlas.living_day_task_ref_v1(v_eb_next_task_id),
    'blocker', case when v_eb_blocker_resolved then null else 'Mechanical biomass clearance and the Owner ProCut decision are still unresolved.' end,
    'excludedFromDenominator', true,
    'playability', 'existing_task_only',
    'explanation', jsonb_build_object(
      'basis', 'canonical_tasks_blockers_and_sown_crop_cycles',
      'doesNotReleaseTask', true,
      'configuration', 'elm_living_day_goal_pilot_v1'
    )
  );

  -- Goal 2: Put FR11-FR14 October sunflower block in the ground.
  select count(distinct object.stable_key)::integer
  into v_fr_sown_count
  from atlas.growing_objects object
  join atlas.crop_cycles cycle on cycle.object_id = object.id
  left join atlas.crop_profiles profile on profile.id = cycle.crop_profile_id
  where object.farm_id = p_farm_id
    and object.stable_key in ('fr_11','fr_12','fr_13','fr_14')
    and cycle.lifecycle_status = 'active'
    and cycle.sown_date is not null
    and (
      profile.stable_key like 'sunflower_procut_%'
      or lower(coalesce(cycle.crop_label, '')) like '%pollenless%'
      or lower(coalesce(cycle.variety, '')) like 'procut%'
    );

  select task.id into v_fr_next_task_id
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.status in ('open','blocked')
    and task.metadata ->> 'task_key' in (
      'fr_black_oil_turnover_pollenless_fr11_20260730',
      'fr_black_oil_turnover_pollenless_fr12_20260731',
      'fr_black_oil_turnover_pollenless_fr13_20260801',
      'fr_black_oil_turnover_pollenless_fr14_20260802'
    )
  order by task.due_date nulls last, task.created_at
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementKey', row.object_key || '_sown',
    'label', row.object_label || ' pollenless succession sown',
    'state', case when cycle.id is not null then 'satisfied' else 'unmet' end,
    'sourceKind', case when cycle.id is not null then 'crop_cycle' else 'task' end,
    'sourceId', coalesce(cycle.id, task.id),
    'task', atlas.living_day_task_ref_v1(task.id)
  ) order by row.sort_order), '[]'::jsonb)
  into v_fr_requirements
  from (values
    ('fr_11'::text, 'Field Row 11'::text, 1),
    ('fr_12'::text, 'Field Row 12'::text, 2),
    ('fr_13'::text, 'Field Row 13'::text, 3),
    ('fr_14'::text, 'Field Row 14'::text, 4)
  ) row(object_key, object_label, sort_order)
  left join lateral (
    select cycle.id
    from atlas.growing_objects object
    join atlas.crop_cycles cycle on cycle.object_id = object.id
    left join atlas.crop_profiles profile on profile.id = cycle.crop_profile_id
    where object.farm_id = p_farm_id
      and object.stable_key = row.object_key
      and cycle.lifecycle_status = 'active'
      and cycle.sown_date is not null
      and (
        profile.stable_key like 'sunflower_procut_%'
        or lower(coalesce(cycle.crop_label, '')) like '%pollenless%'
        or lower(coalesce(cycle.variety, '')) like 'procut%'
      )
    order by cycle.sown_date desc, cycle.created_at desc
    limit 1
  ) cycle on true
  left join lateral (
    select task.id
    from atlas.tasks task
    join atlas.task_objects link on link.task_id = task.id
    join atlas.growing_objects object on object.id = link.object_id
    where task.farm_id = p_farm_id
      and object.stable_key = row.object_key
      and task.metadata ->> 'task_key' like 'fr_black_oil_turnover_pollenless_%'
    order by task.created_at desc
    limit 1
  ) task on true;

  v_fr_goal := jsonb_build_object(
    'goalKey', 'elm_fr11_fr14_october_sunflowers_v1',
    'title', 'Put the FR11-FR14 October sunflower block in the ground',
    'summary', 'Turn four black-oil turnover beds into the next pollenless production block.',
    'state', case
      when v_fr_sown_count = 4 then 'realized'
      when v_fr_sown_count >= 3 then 'nearly_unlocked'
      when v_fr_sown_count > 0 then 'in_production'
      else 'locked'
    end,
    'progress', jsonb_build_object(
      'satisfied', v_fr_sown_count,
      'total', 4,
      'label', v_fr_sown_count::text || '/4 beds sown'
    ),
    'requirements', v_fr_requirements,
    'nextMove', atlas.living_day_task_ref_v1(v_fr_next_task_id),
    'blocker', case when v_fr_next_task_id is null and v_fr_sown_count < 4 then 'No canonical next turnover task is currently available.' else null end,
    'excludedFromDenominator', true,
    'playability', 'existing_task_only',
    'explanation', jsonb_build_object(
      'basis', 'active_sown_crop_cycle_per_named_field_row',
      'doesNotCountPlannedCycles', true,
      'doesNotReleaseTask', true,
      'configuration', 'elm_living_day_goal_pilot_v1'
    )
  );

  -- Goal 3: Confirm the FR15 ProCut Horizon stand.
  select
    cycle.id,
    cycle.lifecycle_status = 'active' and cycle.cycle_state in ('sown','growing') and cycle.sown_date is not null,
    cycle.germination_checked_date is not null,
    cycle.sown_date,
    cycle.germination_checked_date,
    cycle.expected_germination_start,
    cycle.expected_germination_end
  into
    v_fr15_cycle_id,
    v_fr15_sown,
    v_fr15_germination_checked,
    v_fr15_sown_date,
    v_fr15_germination_date,
    v_fr15_window_start,
    v_fr15_window_end
  from atlas.crop_cycles cycle
  join atlas.growing_objects object on object.id = cycle.object_id
  where cycle.farm_id = p_farm_id
    and object.stable_key = 'fr_15'
    and cycle.crop_cycle_key = 'planned_fr15_procut_horizon_20260724'
  limit 1;

  v_fr15_sown := coalesce(v_fr15_sown, false);
  v_fr15_germination_checked := coalesce(v_fr15_germination_checked, false);

  select task.id into v_fr15_next_task_id
  from atlas.tasks task
  join atlas.task_crop_cycles link on link.task_id = task.id
  where link.crop_cycle_id = v_fr15_cycle_id
    and task.status in ('open','blocked')
    and task.action_key in ('germination_check','verify')
  order by task.due_date nulls last, task.created_at
  limit 1;

  v_fr15_goal := jsonb_build_object(
    'goalKey', 'elm_fr15_procut_horizon_stand_v1',
    'title', 'Confirm the FR15 ProCut Horizon stand',
    'summary', 'Let the completed sowing become a verified stand without treating elapsed time as observation.',
    'state', case
      when v_fr15_germination_checked then 'realized'
      when v_fr15_sown and v_fr15_window_start is not null and v_day >= v_fr15_window_start then 'nearly_unlocked'
      when v_fr15_sown then 'tracking'
      else 'locked'
    end,
    'progress', jsonb_build_object(
      'satisfied', (case when v_fr15_sown then 1 else 0 end) + (case when v_fr15_germination_checked then 1 else 0 end),
      'total', 2,
      'label', case when v_fr15_germination_checked then 'Stand confirmed' when v_fr15_sown then '1 observation remaining' else 'Sowing evidence unresolved' end
    ),
    'requirements', jsonb_build_array(
      jsonb_build_object(
        'requirementKey', 'horizon_sown',
        'label', 'Reconcile the completed ProCut Horizon sowing',
        'state', case when v_fr15_sown then 'satisfied' else 'unmet' end,
        'detail', case when v_fr15_sown then 'The crop cycle is active and anchored to the completed July 24 task.' else 'The crop cycle is not yet active and sown.' end,
        'sourceKind', 'crop_cycle',
        'sourceId', v_fr15_cycle_id
      ),
      jsonb_build_object(
        'requirementKey', 'stand_observed',
        'label', 'Record the germination and stand result',
        'state', case
          when v_fr15_germination_checked then 'satisfied'
          when v_fr15_sown and v_fr15_window_start is not null and v_day < v_fr15_window_start then 'waiting'
          else 'unmet'
        end,
        'detail', case
          when v_fr15_germination_checked then 'Germination was checked on ' || v_fr15_germination_date::text || '.'
          when v_fr15_window_start is not null then 'Expected observation window: ' || v_fr15_window_start::text || ' through ' || coalesce(v_fr15_window_end::text, 'open-ended') || '.'
          else 'No observation window is recorded.'
        end,
        'sourceKind', 'crop_cycle_observation',
        'sourceId', v_fr15_cycle_id
      )
    ),
    'nextMove', atlas.living_day_task_ref_v1(v_fr15_next_task_id),
    'blocker', case when v_fr15_sown then null else 'The completed sowing evidence has not been reconciled to the crop cycle.' end,
    'window', jsonb_build_object(
      'kind', 'germination',
      'start', v_fr15_window_start,
      'end', v_fr15_window_end,
      'state', case
        when v_fr15_germination_checked then 'satisfied'
        when v_fr15_window_start is null then 'unknown'
        when v_day < v_fr15_window_start then 'waiting'
        when v_fr15_window_end is null or v_day <= v_fr15_window_end then 'open'
        else 'passed_without_observation'
      end
    ),
    'excludedFromDenominator', true,
    'playability', case when v_fr15_next_task_id is null then 'waiting_for_canonical_observation_move' else 'existing_task_only' end,
    'explanation', jsonb_build_object(
      'basis', 'completed_sowing_task_plus_crop_cycle_observation',
      'timeDoesNotConfirmStand', true,
      'doesNotReleaseTask', true,
      'configuration', 'elm_living_day_goal_pilot_v1'
    )
  );

  -- Goal 4: Bring FR4-FR6 to first zinnia cut.
  select count(*)::integer
  into v_zinnia_weeded_count
  from (values ('fr_4'::text), ('fr_5'::text), ('fr_6'::text)) row(object_key)
  where exists (
    select 1
    from atlas.tasks task
    join atlas.task_objects link on link.task_id = task.id
    join atlas.growing_objects object on object.id = link.object_id
    where task.farm_id = p_farm_id
      and object.stable_key = row.object_key
      and task.action_key = 'weed'
      and task.metadata ->> 'contract_packet_key' = 'anna_20260726_20260729_40h'
      and task.status = 'done'
  );

  select
    bool_or(cycle.harvest_started_date is not null),
    min(cycle.harvest_started_date),
    min(cycle.expected_harvest_watch_start)
  into v_zinnia_harvest_started, v_zinnia_first_harvest, v_zinnia_window_start
  from atlas.crop_cycles cycle
  join atlas.growing_objects object on object.id = cycle.object_id
  where cycle.farm_id = p_farm_id
    and object.stable_key in ('fr_4','fr_5','fr_6')
    and lower(cycle.crop_label) like 'zinnia%'
    and cycle.lifecycle_status = 'active';

  v_zinnia_harvest_started := coalesce(v_zinnia_harvest_started, false);

  select task.id into v_zinnia_next_task_id
  from atlas.tasks task
  join atlas.task_objects link on link.task_id = task.id
  join atlas.growing_objects object on object.id = link.object_id
  where task.farm_id = p_farm_id
    and object.stable_key in ('fr_4','fr_5','fr_6')
    and task.status in ('open','blocked')
    and task.action_key = 'weed'
    and task.metadata ->> 'contract_packet_key' = 'anna_20260726_20260729_40h'
  order by case object.stable_key when 'fr_4' then 1 when 'fr_5' then 2 else 3 end,
           task.due_date nulls last,
           task.created_at
  limit 1;

  if v_zinnia_next_task_id is null then
    select task.id into v_zinnia_next_task_id
    from atlas.tasks task
    join atlas.task_crop_cycles link on link.task_id = task.id
    join atlas.crop_cycles cycle on cycle.id = link.crop_cycle_id
    join atlas.growing_objects object on object.id = cycle.object_id
    where task.farm_id = p_farm_id
      and object.stable_key in ('fr_4','fr_5','fr_6')
      and task.status in ('open','blocked')
      and task.action_key = 'harvest_watch'
      and lower(cycle.crop_label) like 'zinnia%'
    order by task.due_date nulls last, task.created_at
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementKey', row.object_key || '_protected',
    'label', row.object_label || ' crop-preserving weeding complete',
    'state', case when task.status = 'done' then 'satisfied' else 'unmet' end,
    'sourceKind', 'task',
    'sourceId', task.id,
    'task', atlas.living_day_task_ref_v1(task.id)
  ) order by row.sort_order), '[]'::jsonb)
  into v_zinnia_requirements
  from (values
    ('fr_4'::text, 'Field Row 4'::text, 1),
    ('fr_5'::text, 'Field Row 5'::text, 2),
    ('fr_6'::text, 'Field Row 6'::text, 3)
  ) row(object_key, object_label, sort_order)
  left join lateral (
    select task.id, task.status
    from atlas.tasks task
    join atlas.task_objects link on link.task_id = task.id
    join atlas.growing_objects object on object.id = link.object_id
    where task.farm_id = p_farm_id
      and object.stable_key = row.object_key
      and task.action_key = 'weed'
      and task.metadata ->> 'contract_packet_key' = 'anna_20260726_20260729_40h'
    order by task.created_at desc
    limit 1
  ) task on true;

  v_zinnia_requirements := v_zinnia_requirements || jsonb_build_array(jsonb_build_object(
    'requirementKey', 'first_zinnia_cut',
    'label', 'Record the first usable zinnia cut from FR4-FR6',
    'state', case
      when v_zinnia_harvest_started then 'satisfied'
      when v_zinnia_window_start is not null and v_day < v_zinnia_window_start then 'waiting'
      else 'unmet'
    end,
    'detail', case
      when v_zinnia_harvest_started then 'First harvest recorded on ' || v_zinnia_first_harvest::text || '.'
      when v_zinnia_window_start is not null then 'Harvest watch begins ' || v_zinnia_window_start::text || '.'
      else 'No harvest-watch date is recorded.'
    end,
    'sourceKind', 'crop_cycle_harvest',
    'sourceId', null
  ));

  v_zinnia_goal := jsonb_build_object(
    'goalKey', 'elm_fr4_fr6_first_zinnia_cut_v1',
    'title', 'Bring FR4-FR6 to first zinnia cut',
    'summary', 'Protect the existing zinnia block and prove the first usable harvest.',
    'state', case
      when v_zinnia_harvest_started then 'realized'
      when v_zinnia_weeded_count = 3 and v_zinnia_window_start is not null and v_day >= v_zinnia_window_start then 'nearly_unlocked'
      when v_zinnia_weeded_count = 3 then 'tracking'
      else 'locked'
    end,
    'progress', jsonb_build_object(
      'satisfied', v_zinnia_weeded_count + (case when v_zinnia_harvest_started then 1 else 0 end),
      'total', 4,
      'label', case when v_zinnia_harvest_started then 'First cut recorded' else v_zinnia_weeded_count::text || '/3 beds protected' end
    ),
    'requirements', v_zinnia_requirements,
    'nextMove', atlas.living_day_task_ref_v1(v_zinnia_next_task_id),
    'blocker', case when v_zinnia_weeded_count < 3 then 'FR4-FR6 crop-preserving weeding is not yet complete.' else null end,
    'window', jsonb_build_object(
      'kind', 'harvest_watch',
      'start', v_zinnia_window_start,
      'end', null,
      'state', case
        when v_zinnia_harvest_started then 'satisfied'
        when v_zinnia_window_start is null then 'unknown'
        when v_day < v_zinnia_window_start then 'waiting'
        else 'open'
      end
    ),
    'excludedFromDenominator', true,
    'playability', 'existing_task_only',
    'explanation', jsonb_build_object(
      'basis', 'current_contract_weeding_tasks_plus_harvest_started_date',
      'partialDoesNotSatisfy', true,
      'timeDoesNotProveHarvest', true,
      'doesNotReleaseTask', true,
      'configuration', 'elm_living_day_goal_pilot_v1'
    )
  );

  -- Nearest movement first: one observation remaining, then active production runs.
  v_goals := jsonb_build_array(v_fr15_goal, v_fr_goal, v_zinnia_goal, v_eb_goal);

  select
    count(*) filter (where task.status = 'done')::integer,
    count(*) filter (where task.status in ('open','blocked'))::integer
  into v_plan_done, v_plan_open
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.due_date = v_day
    and task.status <> 'archived'
    and atlas.can_read_task_in_journal_v1(task.id);

  select count(*)::integer into v_completed
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.due_date = v_day
    and task.status = 'done'
    and atlas.can_read_task_in_journal_v1(task.id);

  select count(*)::integer into v_partial
  from atlas.task_outcome_events outcome
  where outcome.farm_id = p_farm_id
    and outcome.outcome = 'partial'
    and (outcome.created_at at time zone 'America/Chicago')::date = v_day;

  select count(*)::integer into v_migrated
  from atlas.task_transitions transition
  where transition.farm_id = p_farm_id
    and transition.transition in ('rescheduled','changed_plan')
    and (transition.created_at at time zone 'America/Chicago')::date = v_day;

  select count(*)::integer into v_blocked
  from atlas.task_outcome_events outcome
  where outcome.farm_id = p_farm_id
    and outcome.outcome = 'blocked'
    and (outcome.created_at at time zone 'America/Chicago')::date = v_day;

  select count(*)::integer into v_restored
  from atlas.rhythm_transitions transition
  where transition.farm_id = p_farm_id
    and transition.transition_kind in ('restored','renewed')
    and (transition.occurred_at at time zone 'America/Chicago')::date = v_day;

  select count(*)::integer into v_advanced
  from atlas.journal_event_index event
  where event.farm_id = p_farm_id
    and event.journal_date = v_day
    and event.event_kind in ('crop_cycle_change','production_change','state_change')
    and atlas.can_read_journal_event_v1(event.id);

  select count(*)::integer into v_unlocked
  from atlas.journal_event_index event
  where event.farm_id = p_farm_id
    and event.journal_date = v_day
    and event.event_kind = 'unlock'
    and atlas.can_read_journal_event_v1(event.id);

  v_completion_summary := jsonb_build_object(
    'readyToShow', v_plan_open = 0,
    'plannedOpen', v_plan_open,
    'plannedDone', v_plan_done,
    'completed', v_completed,
    'partial', v_partial,
    'migrated', v_migrated,
    'blocked', v_blocked,
    'restored', v_restored,
    'advanced', v_advanced,
    'unlocked', v_unlocked
  );

  return jsonb_build_object(
    'contractVersion', 'living_day_v1',
    'farmId', p_farm_id,
    'date', v_day,
    'journal', v_journal,
    'carriedRhythms', v_carried_rhythms,
    'ownerDecisions', v_owner_decisions,
    'goals', v_goals,
    'unlockedToday', coalesce(v_journal -> 'unlocks', '[]'::jsonb),
    'completionSummary', v_completion_summary,
    'rules', jsonb_build_object(
      'denominator', 'bounded_day_plan_only',
      'carriedExcluded', true,
      'goalsExcluded', true,
      'unlockedTodayExcluded', true,
      'timeMayExpireStewardshipButNotClaimPhysicalCondition', true
    )
  );
end;
$$;

comment on function atlas.living_day_v1(uuid, date) is
  'Prepared Living Day read model over canonical Journal, task, crop-cycle, and Clock truth. Four Elm goals are a Build 5 projection, not a second goal source of truth.';

revoke all on function atlas.living_day_v1(uuid, date) from public, anon;
grant execute on function atlas.living_day_v1(uuid, date) to authenticated;
