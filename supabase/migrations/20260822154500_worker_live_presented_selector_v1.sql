create or replace function atlas.presented_work_selection_rows_live_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_role text;
  v_capacity jsonb;
  v_capacity_class text;
  v_paid_target integer := 0;
  v_heavy_cap integer := 0;
  v_used_minutes integer := 0;
  v_used_heavy_minutes integer := 0;
  v_rank integer := 0;
  v_candidates jsonb := '[]'::jsonb;
  v_item jsonb;
  v_decisions jsonb := '{}'::jsonb;
  v_item_state text;
  v_item_reason text;
  v_is_placed boolean := false;
  v_item_heavy integer := 0;
  v_item_minutes integer := 0;
  v_item_task_id uuid;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;
  if extract(dow from v_work_date)::integer = 0 and v_target_role = 'farm_hand' then
    return;
  end if;
  if not atlas.worker_day_available_v1(p_farm_id, p_membership_id, v_work_date) then
    return;
  end if;

  v_capacity := atlas.worker_week_day_capacity_v1(p_farm_id, p_membership_id, v_work_date);
  v_capacity_class := coalesce(v_capacity->>'capacityClass', 'none');
  if v_target_role <> 'farm_hand' or v_capacity_class <> 'recovery' then
    return query
    select *
    from atlas.presented_work_selection_rows_v3(p_farm_id, p_membership_id, v_work_date)
    where presentation_state = 'presented';
    return;
  end if;

  v_paid_target := greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer, 0), 0);
  v_heavy_cap := greatest(
    least(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer, v_paid_target), v_paid_target),
    0
  );

  select
    coalesce(sum(greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)), 0)::integer,
    coalesce(sum(case when cp.physical_load = 'heavy'
      then greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)
      else 0 end), 0)::integer
  into v_used_minutes, v_used_heavy_minutes
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id = p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t, v_work_date) cp
  where p.farm_id = p_farm_id
    and p.membership_id = p_membership_id
    and p.service_date = v_work_date
    and p.state = 'placed'
    and t.status = 'open';

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', l.task_id,
    'legacyPresentationState', l.presentation_state,
    'legacyPresentationReason', l.presentation_reason,
    'laneOrder', l.lane_order,
    'legacySelectionRank', l.selection_rank,
    'workLane', l.work_lane,
    'commitmentKind', l.commitment_kind,
    'effortUnits', l.effort_units,
    'budgetUnits', l.budget_units,
    'notificationPlanned', l.notification_planned,
    'legacyOverload', l.overload,
    'priority', t.priority,
    'dueDate', t.due_date,
    'expectedActiveMinutes', cp.expected_active_minutes,
    'physicalLoad', cp.physical_load,
    'consequenceTier', case
      when consequence.contract is not null
       and coalesce(consequence.contract->>'effectiveTier', '') ~ '^[1-6]$'
      then (consequence.contract->>'effectiveTier')::integer
      else 99
    end,
    'realityWarrantOrder', case
      when exists(select 1 from atlas.task_crop_cycles tc where tc.task_id = l.task_id)
        or exists(select 1 from atlas.production_lot_tasks pl where pl.task_id = l.task_id) then 0
      when exists(select 1 from atlas.rhythm_state rs where rs.current_task_id = l.task_id) then 1
      when occurrence.source_kind is not null and occurrence.source_id is not null then 2
      when l.commitment_kind = 'hard_date' and t.due_date is not null then 3
      when occurrence.id is not null then 4
      else 9
    end,
    'placedToday', placement.placed_today,
    'committedOtherDay', other_placement.committed_other_day,
    'executionReady', case
      when placement.placed_today then coalesce((atlas.task_execution_readiness_v1(l.task_id)->>'ready')::boolean, false)
      else l.presentation_state = 'presented'
    end,
    'recoveryRequired', recovery.recovery_required
  ) order by l.selection_rank, l.task_id), '[]'::jsonb)
  into v_candidates
  from atlas.presented_work_selection_rows_legacy_v1(p_farm_id, p_membership_id, v_work_date) l
  join atlas.tasks t on t.id = l.task_id
  cross join lateral atlas.task_capacity_plan_v1(t, v_work_date) cp
  cross join lateral (
    select (
      l.work_lane in ('required', 'process_continuation')
      or l.commitment_kind in ('hard_date', 'dependency')
      or coalesce(t.metadata->>'persistent_weed_card', 'false') = 'true'
      or coalesce(t.metadata->>'daily_slot_policy', '') = 'exactly_one_weed_card_per_workday'
    ) as recovery_required
  ) recovery
  cross join lateral (
    select exists(
      select 1
      from atlas.worker_day_task_placements p
      where p.farm_id = p_farm_id
        and p.membership_id = p_membership_id
        and p.service_date = v_work_date
        and p.task_id = l.task_id
        and p.state = 'placed'
    ) as placed_today
  ) placement
  cross join lateral (
    select exists(
      select 1
      from atlas.worker_day_task_placements p
      where p.farm_id = p_farm_id
        and p.membership_id = p_membership_id
        and p.task_id = l.task_id
        and p.state = 'placed'
        and p.service_date <> v_work_date
        and atlas.worker_day_placement_is_live_v1(
          p.farm_id, p.membership_id, p.service_date, now()
        )
    ) as committed_other_day
  ) other_placement
  left join atlas.planned_work_occurrences occurrence
    on occurrence.id = t.planned_occurrence_id
  cross join lateral (
    select case
      when l.presentation_state = 'presented' and recovery.recovery_required
      then atlas.task_effective_delay_consequence_v1(l.task_id, v_work_date)
      else null::jsonb
    end as contract
  ) consequence;

  for v_item in
    select value
    from jsonb_array_elements(v_candidates)
    where not coalesce((value->>'committedOtherDay')::boolean, false)
      and value->>'legacyPresentationState' = 'presented'
      and coalesce((value->>'recoveryRequired')::boolean, false)
      and value->>'legacyPresentationReason' in (
        'protected_minimum_selected',
        'consequence_required_selected',
        'hard_date_selected',
        'required_over_capacity',
        'required_selected',
        'within_day_capacity',
        'next_up_capacity',
        'next_up_heavy_capacity'
      )
    order by
      case when coalesce((value->>'placedToday')::boolean, false) then 0 else 1 end,
      coalesce(nullif(value->>'consequenceTier', '')::integer, 99),
      coalesce(nullif(value->>'realityWarrantOrder', '')::integer, 99),
      nullif(value->>'dueDate', '')::date nulls last,
      case value->>'priority'
        when 'urgent' then 0
        when 'high' then 1
        when 'normal' then 2
        when 'low' then 3
        else 4
      end,
      coalesce(nullif(value->>'laneOrder', '')::integer, 2147483647),
      coalesce(nullif(value->>'legacySelectionRank', '')::bigint, 9223372036854775807),
      value->>'taskId'
  loop
    v_rank := v_rank + 1;
    v_item_task_id := (v_item->>'taskId')::uuid;
    v_is_placed := coalesce((v_item->>'placedToday')::boolean, false);
    v_item_minutes := greatest(coalesce(nullif(v_item->>'expectedActiveMinutes', '')::integer, 0), 0);
    v_item_heavy := case when v_item->>'physicalLoad' = 'heavy' then v_item_minutes else 0 end;

    if v_is_placed and coalesce((v_item->>'executionReady')::boolean, false) then
      v_item_state := 'presented';
      v_item_reason := 'committed_placement';
    elsif not coalesce((v_item->>'executionReady')::boolean, false) then
      v_item_state := 'held';
      v_item_reason := coalesce(nullif(v_item->>'legacyPresentationReason', ''), 'blocked');
    elsif v_used_minutes + v_item_minutes <= v_paid_target
      and v_used_heavy_minutes + v_item_heavy <= v_heavy_cap then
      v_item_state := 'presented';
      v_item_reason := 'recovery_required_selected';
      v_used_minutes := v_used_minutes + v_item_minutes;
      v_used_heavy_minutes := v_used_heavy_minutes + v_item_heavy;
    else
      v_item_state := 'held';
      v_item_reason := case
        when v_used_heavy_minutes + v_item_heavy > v_heavy_cap then 'next_up_heavy_capacity'
        else 'next_up_capacity'
      end;
    end if;

    v_decisions := v_decisions || jsonb_build_object(
      v_item_task_id::text,
      jsonb_build_object('state', v_item_state, 'reason', v_item_reason, 'rank', v_rank)
    );
  end loop;

  return query
  with candidates as materialized (
    select
      (c->>'taskId')::uuid as task_id,
      c->>'legacyPresentationState' as legacy_presentation_state,
      c->>'legacyPresentationReason' as legacy_presentation_reason,
      nullif(c->>'laneOrder', '')::integer as lane_order,
      nullif(c->>'legacySelectionRank', '')::bigint as legacy_selection_rank,
      c->>'workLane' as work_lane,
      c->>'commitmentKind' as commitment_kind,
      nullif(c->>'effortUnits', '')::numeric as effort_units,
      nullif(c->>'budgetUnits', '')::numeric as budget_units,
      coalesce((c->>'notificationPlanned')::boolean, false) as notification_planned,
      coalesce((c->>'legacyOverload')::boolean, false) as legacy_overload,
      coalesce((c->>'placedToday')::boolean, false) as explicit_today,
      coalesce((c->>'committedOtherDay')::boolean, false) as committed_other_day,
      coalesce((c->>'executionReady')::boolean, false) as execution_ready,
      v_decisions->(c->>'taskId') as decision
    from jsonb_array_elements(v_candidates) c
  ), resolved as (
    select c.*,
      case
        when c.committed_other_day then 'held'
        when c.explicit_today and c.execution_ready then 'presented'
        when c.decision is not null then coalesce(c.decision->>'state', 'held')
        else 'held'
      end as final_state,
      case
        when c.committed_other_day then 'committed_other_day'
        when c.explicit_today and c.execution_ready then 'committed_placement'
        when c.decision is not null then coalesce(c.decision->>'reason', 'recovery_reserved_for_required')
        else c.legacy_presentation_reason
      end as final_reason,
      case
        when c.explicit_today then 0
        when c.decision is not null then coalesce((c.decision->>'rank')::integer, 2147483647)
        else null
      end as capacity_rank
    from candidates c
  ), presented as (
    select r.*
    from resolved r
    where r.final_state = 'presented'
  ), ordered as (
    select p.*,
      row_number() over(order by
        case when p.explicit_today then 0 else 1 end,
        p.capacity_rank nulls last,
        p.legacy_selection_rank,
        p.task_id
      )::bigint as final_rank
    from presented p
  )
  select
    o.task_id,
    o.final_state,
    o.final_reason,
    o.lane_order,
    o.final_rank,
    o.work_lane,
    o.commitment_kind,
    o.effort_units,
    o.budget_units,
    o.notification_planned,
    false
  from ordered o
  order by o.final_rank;
end;
$function$;
