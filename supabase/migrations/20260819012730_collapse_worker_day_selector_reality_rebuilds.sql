create or replace function atlas.presented_work_selection_rows_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
)
returns table(
  task_id uuid,presentation_state text,presentation_reason text,lane_order integer,selection_rank bigint,
  work_lane text,commitment_kind text,effort_units numeric,budget_units numeric,notification_planned boolean,overload boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_target_role text;
  v_capacity jsonb;
  v_capacity_class text;
  v_paid_target integer:=0;
  v_maximum integer:=0;
  v_heavy_cap integer:=0;
  v_week_claims jsonb:='{}'::jsonb;
  v_week_optional_room integer:=2147483647;
  v_week_optional_heavy_room integer:=2147483647;
  v_placed_minutes integer:=0;
  v_placed_heavy_minutes integer:=0;
  v_used_minutes integer:=0;
  v_used_heavy_minutes integer:=0;
  v_optional_used_minutes integer:=0;
  v_optional_used_heavy_minutes integer:=0;
  v_rank integer:=0;
  v_candidates jsonb:='[]'::jsonb;
  v_item jsonb;
  v_decisions jsonb:='{}'::jsonb;
  v_item_state text;
  v_item_reason text;
  v_is_placed boolean:=false;
  v_item_heavy integer:=0;
  v_item_minutes integer:=0;
  v_item_task_id uuid;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_target_role is null then raise exception 'Target membership is not active on this farm.' using errcode='42501'; end if;
  if extract(dow from v_work_date)::integer=0 and v_target_role='farm_hand' then return; end if;
  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then return; end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_work_date);
  if coalesce(v_capacity->>'state','')='anchor_required'
     and v_target_role='manager'
     and extract(isodow from v_work_date)::integer between 1 and 5
     and exists(select 1 from atlas.member_capacity_settings m where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true) then
    select greatest(coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.maximum_planned_minutes,m.regular_target_minutes,0),coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.heavy_minutes_soft_cap,0),0)
    into v_paid_target,v_maximum,v_heavy_cap
    from atlas.member_capacity_settings m
    where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
    order by m.updated_at desc nulls last,m.created_at desc nulls last limit 1;
    v_capacity_class:='manager_capacity_setting_fallback';
    v_heavy_cap:=least(v_heavy_cap,v_maximum);
  else
    v_capacity_class:=coalesce(v_capacity->>'capacityClass','none');
    v_paid_target:=greatest(case when v_capacity_class='recovery'
      then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)
      else coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0) end,0);
    v_maximum:=greatest(case when v_capacity_class='recovery'
      then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,v_paid_target)
      else coalesce((v_capacity->>'maximumUsableMinutes')::integer,v_paid_target) end,v_paid_target);
    v_heavy_cap:=greatest(least(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,v_paid_target),v_maximum),0);
  end if;

  if v_target_role='farm_hand' then
    v_week_claims:=atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,v_work_date);
    v_week_optional_room:=greatest(coalesce((v_week_claims#>>'{totals,remainingOptionalPlannedAvailabilityMinutes}')::integer,0),0);
    v_week_optional_heavy_room:=greatest(coalesce((v_week_claims#>>'{totals,remainingOptionalHeavyAvailabilityMinutes}')::integer,0),0);
  end if;

  select
    coalesce(sum(greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0)),0)::integer,
    coalesce(sum(case when cp.physical_load='heavy' then greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0) else 0 end),0)::integer
  into v_placed_minutes,v_placed_heavy_minutes
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,v_work_date) cp
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id
    and p.service_date=v_work_date and p.state='placed' and t.status='open';

  v_used_minutes:=v_placed_minutes;
  v_used_heavy_minutes:=v_placed_heavy_minutes;

  -- One canonical Reality candidate snapshot per selector invocation. Everything below
  -- arbitrates from this immutable in-memory snapshot instead of rebuilding Reality.
  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId',c.task_id,
    'legacyPresentationState',c.legacy_presentation_state,
    'legacyPresentationReason',c.legacy_presentation_reason,
    'laneOrder',c.lane_order,
    'legacySelectionRank',c.legacy_selection_rank,
    'workLane',c.work_lane,
    'commitmentKind',c.commitment_kind,
    'effortUnits',c.effort_units,
    'budgetUnits',c.budget_units,
    'notificationPlanned',c.notification_planned,
    'legacyOverload',c.legacy_overload,
    'priority',c.priority,
    'dueDate',c.due_date,
    'expectedActiveMinutes',c.expected_active_minutes,
    'physicalLoad',c.physical_load,
    'consequenceTier',c.consequence_tier,
    'realityWarrantOrder',c.reality_warrant_order,
    'placedToday',exists(
      select 1 from atlas.worker_day_task_placements p
      where p.farm_id=p_farm_id and p.membership_id=p_membership_id
        and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed'
    ),
    'committedOtherDay',exists(
      select 1 from atlas.worker_day_task_placements p
      where p.farm_id=p_farm_id and p.membership_id=p_membership_id
        and p.task_id=c.task_id and p.state='placed' and p.service_date<>v_work_date
        and atlas.worker_day_placement_is_live_v1(p.farm_id,p.membership_id,p.service_date,now())
    ),
    'executionReady',coalesce((atlas.task_execution_readiness_v1(c.task_id)->>'ready')::boolean,false)
  ) order by c.legacy_selection_rank,c.task_id),'[]'::jsonb)
  into v_candidates
  from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c;

  for v_item in
    select value
    from jsonb_array_elements(v_candidates)
    where value->>'legacyPresentationState'='presented'
      and value->>'legacyPresentationReason' in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected')
      and not coalesce((value->>'committedOtherDay')::boolean,false)
    order by
      case when coalesce((value->>'placedToday')::boolean,false) then 0 else 1 end,
      coalesce(nullif(value->>'consequenceTier','')::integer,99),
      coalesce(nullif(value->>'realityWarrantOrder','')::integer,99),
      nullif(value->>'dueDate','')::date nulls last,
      case value->>'priority' when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      coalesce(nullif(value->>'laneOrder','')::integer,2147483647),
      coalesce(nullif(value->>'legacySelectionRank','')::bigint,9223372036854775807),
      value->>'taskId'
  loop
    v_rank:=v_rank+1;
    v_item_task_id:=(v_item->>'taskId')::uuid;
    v_is_placed:=coalesce((v_item->>'placedToday')::boolean,false);
    v_item_minutes:=greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer,0),0);
    v_item_heavy:=case when v_item->>'physicalLoad'='heavy' then v_item_minutes else 0 end;
    if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_capacity_class='recovery' then
      v_item_state:='held'; v_item_reason:='recovery_reserved_for_required';
    elsif v_used_minutes+v_item_minutes<=v_paid_target and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap then
      v_item_state:='presented';
      v_item_reason:=case when v_item->>'legacyPresentationReason'='required_over_capacity' then 'required_selected' else v_item->>'legacyPresentationReason' end;
      v_used_minutes:=v_used_minutes+v_item_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      v_item_reason:=case when v_used_heavy_minutes+v_item_heavy>v_heavy_cap then 'next_up_heavy_capacity' else 'next_up_capacity' end;
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item_task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'requiredCandidate',true,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes));
  end loop;

  for v_item in
    select value
    from jsonb_array_elements(v_candidates)
    where value->>'legacyPresentationReason' in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
      and not coalesce((value->>'committedOtherDay')::boolean,false)
    order by
      coalesce(nullif(value->>'consequenceTier','')::integer,99),
      coalesce(nullif(value->>'realityWarrantOrder','')::integer,99),
      nullif(value->>'dueDate','')::date nulls last,
      case value->>'priority' when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      coalesce(nullif(value->>'laneOrder','')::integer,2147483647),
      coalesce(nullif(value->>'legacySelectionRank','')::bigint,9223372036854775807),
      value->>'taskId'
  loop
    v_rank:=v_rank+1;
    v_item_task_id:=(v_item->>'taskId')::uuid;
    v_is_placed:=coalesce((v_item->>'placedToday')::boolean,false);
    v_item_minutes:=greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer,0),0);
    v_item_heavy:=case when v_item->>'physicalLoad'='heavy' then v_item_minutes else 0 end;
    if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_capacity_class='recovery' then
      v_item_state:='held'; v_item_reason:='recovery_reserved_for_required';
    elsif v_used_minutes+v_item_minutes<=v_paid_target
       and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap
       and v_optional_used_minutes+v_item_minutes<=v_week_optional_room
       and v_optional_used_heavy_minutes+v_item_heavy<=v_week_optional_heavy_room then
      v_item_state:='presented'; v_item_reason:='within_day_capacity';
      v_used_minutes:=v_used_minutes+v_item_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
      v_optional_used_minutes:=v_optional_used_minutes+v_item_minutes;
      v_optional_used_heavy_minutes:=v_optional_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      v_item_reason:=case when v_used_heavy_minutes+v_item_heavy>v_heavy_cap or v_optional_used_heavy_minutes+v_item_heavy>v_week_optional_heavy_room then 'next_up_heavy_capacity' else 'next_up_capacity' end;
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item_task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'requiredCandidate',false,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes,
      'optionalUsedMinutesAfter',v_optional_used_minutes,'optionalUsedHeavyMinutesAfter',v_optional_used_heavy_minutes));
  end loop;

  return query
  with candidates as materialized (
    select
      (c->>'taskId')::uuid task_id,
      c->>'legacyPresentationState' legacy_presentation_state,
      c->>'legacyPresentationReason' legacy_presentation_reason,
      nullif(c->>'laneOrder','')::integer lane_order,
      nullif(c->>'legacySelectionRank','')::bigint legacy_selection_rank,
      c->>'workLane' work_lane,
      c->>'commitmentKind' commitment_kind,
      nullif(c->>'effortUnits','')::numeric effort_units,
      nullif(c->>'budgetUnits','')::numeric budget_units,
      coalesce((c->>'notificationPlanned')::boolean,false) notification_planned,
      coalesce((c->>'legacyOverload')::boolean,false) legacy_overload,
      coalesce((c->>'placedToday')::boolean,false) explicit_today,
      coalesce((c->>'committedOtherDay')::boolean,false) committed_other_day,
      coalesce((c->>'executionReady')::boolean,false) execution_ready,
      (c->>'legacyPresentationState'='presented' and c->>'legacyPresentationReason' in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected')) required_candidate,
      (c->>'legacyPresentationReason' in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')) flexible_capacity_candidate,
      v_decisions->(c->>'taskId') decision
    from jsonb_array_elements(v_candidates) c
  ), resolved as (
    select c.*,
      case
        when c.committed_other_day then 'held'
        when c.explicit_today and c.execution_ready then 'presented'
        when c.required_candidate or c.flexible_capacity_candidate then coalesce(c.decision->>'state','held')
        else c.legacy_presentation_state end final_state,
      case
        when c.committed_other_day then 'committed_other_day'
        when c.explicit_today and c.execution_ready then 'committed_placement'
        when c.required_candidate or c.flexible_capacity_candidate then coalesce(c.decision->>'reason','next_up_capacity')
        else c.legacy_presentation_reason end final_reason,
      case when c.explicit_today then 0 when c.required_candidate or c.flexible_capacity_candidate then coalesce((c.decision->>'rank')::integer,2147483647) else null end capacity_rank,
      c.explicit_today placed_today
    from candidates c
  ), ordered as (
    select x.*,
      row_number() over(order by
        case x.final_state when 'attention' then 0 when 'presented' then 1 else 2 end,
        case when x.final_state='presented' and x.placed_today then 0 when x.required_candidate then 1 when x.flexible_capacity_candidate then 2 else 3 end,
        x.capacity_rank nulls last,x.legacy_selection_rank,x.task_id
      )::bigint final_rank
    from resolved x
  )
  select o.task_id,o.final_state,o.final_reason,o.lane_order,o.final_rank,
         o.work_lane,o.commitment_kind,o.effort_units,o.budget_units,o.notification_planned,
         case when o.required_candidate or o.flexible_capacity_candidate or o.explicit_today then false else o.legacy_overload end
  from ordered o
  order by o.final_rank;
end;
$function$;