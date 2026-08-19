create or replace function atlas.presented_work_selection_rows_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
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
  v_item record;
  v_decisions jsonb:='{}'::jsonb;
  v_item_state text;
  v_item_reason text;
  v_is_placed boolean:=false;
  v_item_heavy integer:=0;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;

  if extract(dow from v_work_date)::integer=0 and v_target_role='farm_hand' then return; end if;
  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then return; end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_work_date);
  if coalesce(v_capacity->>'state','')='anchor_required'
     and v_target_role='manager'
     and extract(isodow from v_work_date)::integer between 1 and 5
     and exists (
       select 1 from atlas.member_capacity_settings m
       where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
     ) then
    select greatest(coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.maximum_planned_minutes,m.regular_target_minutes,0),coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.heavy_minutes_soft_cap,0),0)
    into v_paid_target,v_maximum,v_heavy_cap
    from atlas.member_capacity_settings m
    where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
    order by m.updated_at desc nulls last,m.created_at desc nulls last
    limit 1;
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
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.service_date=v_work_date
    and p.state='placed'
    and t.status='open';

  v_used_minutes:=v_placed_minutes;
  v_used_heavy_minutes:=v_placed_heavy_minutes;

  -- Required/protected work has precedence, but precedence is not infinite time.
  -- Existing Worker Day placements are committed first; unplaced required work is
  -- admitted only while the finite Day Shape still has room.
  for v_item in
    select c.*,
      exists(
        select 1 from atlas.worker_day_task_placements p
        where p.farm_id=p_farm_id and p.membership_id=p_membership_id
          and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed'
      ) as placed_today,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
    where c.legacy_presentation_state='presented'
      and c.legacy_presentation_reason in (
        'protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected'
      )
    order by
      case when exists(
        select 1 from atlas.worker_day_task_placements p
        where p.farm_id=p_farm_id and p.membership_id=p_membership_id
          and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed'
      ) then 0 else 1 end,
      coalesce(c.consequence_tier,99),c.reality_warrant_order,c.due_date nulls last,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      c.lane_order,c.legacy_selection_rank,c.task_id
  loop
    v_rank:=v_rank+1;
    v_is_placed:=v_item.placed_today;
    v_item_heavy:=case when v_item.physical_load='heavy' then v_item.expected_active_minutes else 0 end;

    if v_is_placed then
      v_item_state:='presented';
      v_item_reason:=case when v_item.legacy_presentation_reason='required_over_capacity' then 'required_selected' else v_item.legacy_presentation_reason end;
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target
       and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap then
      v_item_state:='presented';
      v_item_reason:=case when v_item.legacy_presentation_reason='required_over_capacity' then 'required_selected' else v_item.legacy_presentation_reason end;
      v_used_minutes:=v_used_minutes+v_item.expected_active_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      if v_used_heavy_minutes+v_item_heavy>v_heavy_cap then
        v_item_reason:='next_up_heavy_capacity';
      else
        v_item_reason:='next_up_capacity';
      end if;
    end if;

    v_decisions:=v_decisions||jsonb_build_object(v_item.task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,
      'requiredCandidate',true,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes
    ));
  end loop;

  -- Flexible work may use only what remains after committed placements and the
  -- finite required/protected selection, and may not consume weekly capacity
  -- already reserved for required claims.
  for v_item in
    select c.*,
      exists(
        select 1 from atlas.worker_day_task_placements p
        where p.farm_id=p_farm_id and p.membership_id=p_membership_id
          and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed'
      ) as placed_today,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
    where c.legacy_presentation_reason in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
    order by coalesce(c.consequence_tier,99),c.reality_warrant_order,c.due_date nulls last,
             case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
             c.lane_order,c.legacy_selection_rank,c.task_id
  loop
    v_rank:=v_rank+1;
    v_is_placed:=v_item.placed_today;
    v_item_heavy:=case when v_item.physical_load='heavy' then v_item.expected_active_minutes else 0 end;

    if v_is_placed then
      v_item_state:='presented';
      v_item_reason:='within_day_capacity';
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target
       and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap
       and v_optional_used_minutes+v_item.expected_active_minutes<=v_week_optional_room
       and v_optional_used_heavy_minutes+v_item_heavy<=v_week_optional_heavy_room then
      v_item_state:='presented';
      v_item_reason:='within_day_capacity';
      v_used_minutes:=v_used_minutes+v_item.expected_active_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
      v_optional_used_minutes:=v_optional_used_minutes+v_item.expected_active_minutes;
      v_optional_used_heavy_minutes:=v_optional_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      if v_used_heavy_minutes+v_item_heavy>v_heavy_cap
         or v_optional_used_heavy_minutes+v_item_heavy>v_week_optional_heavy_room then
        v_item_reason:='next_up_heavy_capacity';
      else
        v_item_reason:='next_up_capacity';
      end if;
    end if;

    v_decisions:=v_decisions||jsonb_build_object(v_item.task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,
      'requiredCandidate',false,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes,
      'optionalUsedMinutesAfter',v_optional_used_minutes,'optionalUsedHeavyMinutesAfter',v_optional_used_heavy_minutes
    ));
  end loop;

  return query
  with candidates as materialized (
    select c.*,
      c.legacy_presentation_state='presented' and c.legacy_presentation_reason in (
        'protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected'
      ) as required_candidate,
      c.legacy_presentation_reason in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity') as flexible_capacity_candidate,
      v_decisions->c.task_id::text as decision
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
  ), resolved as (
    select c.*,
      case when c.required_candidate or c.flexible_capacity_candidate
        then coalesce(c.decision->>'state','held') else c.legacy_presentation_state end as final_state,
      case when c.required_candidate or c.flexible_capacity_candidate
        then coalesce(c.decision->>'reason','next_up_capacity') else c.legacy_presentation_reason end as final_reason,
      case when c.required_candidate or c.flexible_capacity_candidate
        then coalesce((c.decision->>'rank')::integer,2147483647) else null end as capacity_rank,
      coalesce((c.decision->>'placedToday')::boolean,false) as placed_today
    from candidates c
  ), ordered as (
    select x.*,
      row_number() over (
        order by
          case x.final_state when 'attention' then 0 when 'presented' then 1 else 2 end,
          case when x.final_state='presented' and x.placed_today then 0
               when x.required_candidate then 1
               when x.flexible_capacity_candidate then 2 else 3 end,
          case when x.required_candidate or x.flexible_capacity_candidate then x.capacity_rank end nulls last,
          x.legacy_selection_rank,x.task_id
      )::bigint as final_rank
    from resolved x
  )
  select o.task_id,o.final_state,o.final_reason,o.lane_order,o.final_rank,
         o.work_lane,o.commitment_kind,o.effort_units,o.budget_units,o.notification_planned,
         case when o.required_candidate or o.flexible_capacity_candidate then false else o.legacy_overload end
  from ordered o
  order by o.final_rank;
end;
$function$;

create or replace function atlas.worker_weekly_capacity_management_state_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_base jsonb;
  v_conflict jsonb;
  v_week_start date;
  v_unplaced jsonb:='[]'::jsonb;
  v_unplaced_count integer:=0;
  v_unplaced_minutes integer:=0;
  v_placement_required boolean:=false;
begin
  if p_farm_id is null or p_membership_id is null then
    raise exception 'Farm and membership are required.' using errcode='22023';
  end if;
  v_week_start:=coalesce(p_anchor_day,current_date)-((extract(isodow from coalesce(p_anchor_day,current_date))::integer)-1);

  v_base:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,v_week_start);
  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,v_week_start);

  select coalesce(jsonb_agg(c order by c->>'title'),'[]'::jsonb),
         count(*)::integer,
         coalesce(sum((c->>'claimedMinutes')::integer),0)::integer
  into v_unplaced,v_unplaced_count,v_unplaced_minutes
  from jsonb_array_elements(
    coalesce(atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,v_week_start)#>'{claims,requiredWeeklyWork}','[]'::jsonb)
  ) c
  where c->>'status'='required_unplaced';

  -- Placement incompleteness is derived from the labor ledger itself. The
  -- aggregate conflict contract answers whether the week can fit in principle;
  -- it does not and should not pretend to answer whether required claims have
  -- actually been assigned to lawful Worker Days.
  v_placement_required:=v_unplaced_count>0 and coalesce(v_conflict->>'state','')='feasible';

  if coalesce((v_base->>'pathExists')::boolean,false) then
    return v_base||jsonb_build_object(
      'contractVersion','worker_weekly_capacity_management_state_v2',
      'capacityConflict',v_conflict,
      'placementRequired',false,
      'unplacedRequiredWork',v_unplaced,
      'unplacedRequiredCount',v_unplaced_count,
      'unplacedRequiredMinutes',v_unplaced_minutes,
      'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
        'existingOverflowDecisionPathRetainsPriority',true,
        'placementRequiredIsNotEquivalentToOverload',true,
        'unplacedRequiredWorkStillReported',true
      )
    );
  end if;

  if v_placement_required then
    return jsonb_build_object(
      'contractVersion','worker_weekly_capacity_management_state_v2',
      'state','placement_required',
      'pathExists',true,
      'placementRequired',true,
      'farmId',p_farm_id,
      'membershipId',p_membership_id,
      'weekStart',v_week_start,
      'weekEnd',v_week_start+6,
      'capacityConflict',v_conflict,
      'unplacedRequiredCount',v_unplaced_count,
      'unplacedRequiredMinutes',v_unplaced_minutes,
      'unplacedRequiredWork',v_unplaced,
      'consequence','Required work exists and aggregate weekly capacity may be sufficient, but the required minutes are not yet placed into lawful worker days. Day-by-day feasibility is therefore unresolved until the work is placed or the governing plan changes.',
      'managementDecisionRequired','Place the required work into lawful Worker Day capacity, or explicitly change timing, scope, staffing, or the underlying commitment where authorized.',
      'managementOptions',jsonb_build_array(
        jsonb_build_object('key','commit_worker_clock_plan','label','Place required work into Worker Clock','endpoint','atlas.owner_commit_worker_clock_plan_api_v1(uuid,date,jsonb[])'),
        jsonb_build_object('key','change_timing_or_scope','label','Change timing or scope only where the underlying source permits it'),
        jsonb_build_object('key','add_capacity','label','Add lawful capacity when placement cannot fit without displacement')
      ),
      'repairOwner',jsonb_build_object('domain','farm_operations_management','function','place_required_work_in_capacity_window','jurisdiction','management'),
      'principalEscalationCreated',false,
      'truthBoundary',jsonb_build_object(
        'aggregateWeeklyFitDoesNotProveDailyPlacement',true,
        'unplacedRequiredWorkIsNotOptionalBacklog',true,
        'placementRequiredIsNotProvenOverload',true,
        'managementOwnsPlacementBeforePrincipalEscalation',true,
        'workerIsNotResponsibleForMissingPlacement',true
      )
    );
  end if;

  return v_base||jsonb_build_object(
    'contractVersion','worker_weekly_capacity_management_state_v2',
    'capacityConflict',v_conflict,
    'placementRequired',false,
    'unplacedRequiredWork',v_unplaced,
    'unplacedRequiredCount',v_unplaced_count,
    'unplacedRequiredMinutes',v_unplaced_minutes,
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
      'aggregateWeeklyFitDoesNotProveDailyPlacement',true,
      'placementRequiredIsNotProvenOverload',true
    )
  );
end;
$function$;