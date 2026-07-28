-- Do not expose legacy phase-one condition defaults as observed physical truth.
-- A Clock lease may expire with physical weed pressure still unknown.

create or replace function atlas.weeding_rhythm_pilot_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership is required to read the weeding rhythm pilot.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'contractVersion', 'weeding_rhythm_pilot_v1',
    'farmId', p_farm_id,
    'rhythmKey', 'weed_stewardship',
    'evaluatedAt', now(),
    'selectionRule', 'owner_authored_rulebook_clock',
    'physicalConditionRule', 'observation_only',
    'subjects', coalesce(jsonb_agg(jsonb_build_object(
      'stateId', state.id,
      'objectId', object.id,
      'objectKey', object.stable_key,
      'objectLabel', object.label,
      'zoneId', zone.id,
      'zoneKey', zone.stable_key,
      'zoneLabel', zone.label,
      'state', state.state,
      'leaseStartedAt', state.lease_started_at,
      'warningAt', state.warning_at,
      'dueAt', state.due_at,
      'failureAt', state.failure_at,
      'nextBoundaryAt', case state.state
        when 'resting' then state.warning_at
        when 'coming_due' then state.due_at
        when 'due' then state.failure_at
        else null
      end,
      'lastEvaluatedAt', state.last_evaluated_at,
      'rule', jsonb_build_object(
        'ruleId', rule.id,
        'ruleKey', rule.rule_key,
        'version', rule.version,
        'label', rule.label,
        'class', rule.metadata ->> 'ruleClass',
        'validityIntervalSeconds', rule.validity_interval_seconds,
        'warningWindowSeconds', rule.warning_window_seconds,
        'graceWindowSeconds', rule.grace_window_seconds,
        'timezoneName', coalesce(rule.metadata ->> 'timezoneName', 'America/Chicago'),
        'boundaryMode', coalesce(rule.metadata ->> 'boundaryMode', 'exact_timestamp'),
        'qualifyingTouches', rule.qualifying_touches,
        'failureConsequence', rule.failure_consequence,
        'playerRouting', rule.player_routing
      ),
      'lastSatisfaction', case when satisfaction.id is null then null else jsonb_build_object(
        'satisfactionId', satisfaction.id,
        'kind', satisfaction.satisfaction_kind,
        'satisfiedAt', satisfaction.satisfied_at,
        'renewalIntervalSeconds', satisfaction.renewal_interval_seconds,
        'sourceKind', satisfaction.source_kind,
        'sourceId', satisfaction.source_id,
        'sourceEvent', satisfaction.source_event,
        'evidence', satisfaction.evidence
      ) end,
      'currentTask', case when task.id is null then null else jsonb_build_object(
        'taskId', task.id,
        'title', task.title,
        'status', task.status,
        'dueDate', task.due_date,
        'priority', task.priority,
        'actionKey', task.action_key,
        'workClass', task.work_class
      ) end,
      'consequence', jsonb_build_object(
        'active', state.state = 'fallen_out_of_rhythm',
        'restoreRequired', coalesce((rule.failure_consequence ->> 'restoreRequired')::boolean, false),
        'blockScope', rule.failure_consequence ->> 'blockScope',
        'blockedActionKeys', coalesce(rule.failure_consequence -> 'blocksActionKeys', '[]'::jsonb),
        'physicalConditionClaim', rule.failure_consequence ->> 'physicalConditionClaim'
      ),
      'physicalCondition', jsonb_build_object(
        'known', maintenance.condition_reported_at is not null,
        'value', case when maintenance.condition_reported_at is not null then maintenance.condition else null end,
        'reportedAt', maintenance.condition_reported_at,
        'source', case when maintenance.condition_reported_at is not null then maintenance.estimate_source else null end,
        'authority', 'separate_observation_state',
        'inferredFromClock', false
      ),
      'explanation', jsonb_build_object(
        'governedBy', 'owner_authored_rule',
        'effectiveBindingId', binding.id,
        'effectiveBindingKey', binding.binding_key,
        'inheritanceLayer', binding.inheritance_layer,
        'basis', 'latest_qualifying_satisfaction_plus_owner_interval',
        'notBasedOn', jsonb_build_array('generic_recurrence', 'task_title', 'unobserved_physical_condition'),
        'pilotKey', state.metadata ->> 'pilotKey'
      )
    ) order by
      case state.state
        when 'fallen_out_of_rhythm' then 0
        when 'due' then 1
        when 'recovering' then 2
        when 'coming_due' then 3
        when 'resting' then 4
        when 'uninitialized' then 5
        else 6
      end,
      state.due_at nulls last,
      object.sort_order,
      object.label), '[]'::jsonb)
  )
  into v_result
  from atlas.rhythm_state state
  join atlas.rhythm_rules rule on rule.id = state.rhythm_rule_id
  join atlas.rhythm_bindings binding on binding.id = state.rhythm_binding_id
  join atlas.growing_objects object
    on state.subject_kind = 'growing_object' and object.id = state.subject_id
  left join atlas.zones zone on zone.id = object.zone_id
  left join atlas.rhythm_satisfactions satisfaction
    on satisfaction.id = state.last_qualifying_satisfaction_id
  left join atlas.tasks task on task.id = state.current_task_id
  left join lateral (
    select maintenance_object.*
    from atlas.maintenance_objects maintenance_object
    where maintenance_object.object_id = object.id
      and maintenance_object.maintenance_type = 'weed'
    order by maintenance_object.created_at
    limit 1
  ) maintenance on true
  where state.farm_id = p_farm_id
    and state.rhythm_key = 'weed_stewardship'
    and state.metadata ->> 'pilotKey' = 'elm_weeding_pilot_v1'
    and atlas.can_read_rhythm_state_v1(state.id);

  return coalesce(v_result, jsonb_build_object(
    'contractVersion', 'weeding_rhythm_pilot_v1',
    'farmId', p_farm_id,
    'rhythmKey', 'weed_stewardship',
    'evaluatedAt', now(),
    'selectionRule', 'owner_authored_rulebook_clock',
    'physicalConditionRule', 'observation_only',
    'subjects', '[]'::jsonb
  ));
end;
$$;

revoke all on function atlas.weeding_rhythm_pilot_v1(uuid) from public, anon;
grant execute on function atlas.weeding_rhythm_pilot_v1(uuid) to authenticated;