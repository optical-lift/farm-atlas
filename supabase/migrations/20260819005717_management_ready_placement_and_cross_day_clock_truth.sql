create or replace function atlas.worker_weekly_capacity_management_state_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_base jsonb;
  v_conflict jsonb;
  v_week_start date;
  v_all_unplaced jsonb:='[]'::jsonb;
  v_ready_unplaced jsonb:='[]'::jsonb;
  v_blocked_unplaced jsonb:='[]'::jsonb;
  v_all_count integer:=0;
  v_all_minutes integer:=0;
  v_ready_count integer:=0;
  v_ready_minutes integer:=0;
  v_blocked_count integer:=0;
  v_blocked_minutes integer:=0;
  v_placement_required boolean:=false;
begin
  if p_farm_id is null or p_membership_id is null then
    raise exception 'Farm and membership are required.' using errcode='22023';
  end if;
  v_week_start:=coalesce(p_anchor_day,current_date)-((extract(isodow from coalesce(p_anchor_day,current_date))::integer)-1);
  v_base:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,v_week_start);
  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,v_week_start);

  with claims as (
    select c
    from jsonb_array_elements(
      coalesce(atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,v_week_start)#>'{claims,requiredWeeklyWork}','[]'::jsonb)
    ) c
    where c->>'status'='required_unplaced'
  )
  select
    coalesce(jsonb_agg(c order by c->>'title'),'[]'::jsonb),
    count(*)::integer,
    coalesce(sum((c->>'claimedMinutes')::integer),0)::integer,
    coalesce(jsonb_agg(c order by c->>'title') filter(where coalesce((c->>'executionReady')::boolean,false)),'[]'::jsonb),
    count(*) filter(where coalesce((c->>'executionReady')::boolean,false))::integer,
    coalesce(sum((c->>'claimedMinutes')::integer) filter(where coalesce((c->>'executionReady')::boolean,false)),0)::integer,
    coalesce(jsonb_agg(c order by c->>'title') filter(where not coalesce((c->>'executionReady')::boolean,false)),'[]'::jsonb),
    count(*) filter(where not coalesce((c->>'executionReady')::boolean,false))::integer,
    coalesce(sum((c->>'claimedMinutes')::integer) filter(where not coalesce((c->>'executionReady')::boolean,false)),0)::integer
  into
    v_all_unplaced,v_all_count,v_all_minutes,
    v_ready_unplaced,v_ready_count,v_ready_minutes,
    v_blocked_unplaced,v_blocked_count,v_blocked_minutes
  from claims;

  v_placement_required:=v_ready_count>0 and coalesce(v_conflict->>'state','')='feasible';

  if coalesce((v_base->>'pathExists')::boolean,false) then
    return v_base||jsonb_build_object(
      'contractVersion','worker_weekly_capacity_management_state_v2',
      'capacityConflict',v_conflict,
      'placementRequired',false,
      'unplacedRequiredWork',v_all_unplaced,
      'unplacedRequiredCount',v_all_count,
      'unplacedRequiredMinutes',v_all_minutes,
      'readyUnplacedRequiredWork',v_ready_unplaced,
      'readyUnplacedRequiredCount',v_ready_count,
      'readyUnplacedRequiredMinutes',v_ready_minutes,
      'blockedRequiredWork',v_blocked_unplaced,
      'blockedRequiredCount',v_blocked_count,
      'blockedRequiredMinutes',v_blocked_minutes,
      'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
        'existingOverflowDecisionPathRetainsPriority',true,
        'blockedRequiredWorkIsObligationNotPlaceableCapacity',true,
        'placementRequiredIsNotEquivalentToOverload',true
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
      'unplacedRequiredCount',v_all_count,
      'unplacedRequiredMinutes',v_all_minutes,
      'unplacedRequiredWork',v_all_unplaced,
      'readyUnplacedRequiredCount',v_ready_count,
      'readyUnplacedRequiredMinutes',v_ready_minutes,
      'readyUnplacedRequiredWork',v_ready_unplaced,
      'blockedRequiredCount',v_blocked_count,
      'blockedRequiredMinutes',v_blocked_minutes,
      'blockedRequiredWork',v_blocked_unplaced,
      'consequence','Execution-ready required work remains unplaced in lawful Worker Days. Blocked required work is tracked separately and does not pretend to be schedulable capacity.',
      'managementDecisionRequired','Place execution-ready required work into lawful Worker Day capacity; resolve resource/dependency gates separately for blocked obligations.',
      'managementOptions',jsonb_build_array(
        jsonb_build_object('key','commit_worker_clock_plan','label','Place ready required work into Worker Clock','endpoint','atlas.management_commit_worker_required_placements_v1(uuid,uuid,uuid,jsonb)'),
        jsonb_build_object('key','resolve_blocked_required','label','Resolve resource or dependency gates for blocked required work'),
        jsonb_build_object('key','change_timing_or_scope','label','Change timing or scope only where the underlying source permits it')
      ),
      'repairOwner',jsonb_build_object('domain','farm_operations_management','function','place_ready_required_work_and_resolve_blocks','jurisdiction','management'),
      'principalEscalationCreated',false,
      'truthBoundary',jsonb_build_object(
        'aggregateWeeklyFitDoesNotProveDailyPlacement',true,
        'unplacedRequiredWorkIsNotOptionalBacklog',true,
        'blockedRequiredWorkIsObligationNotPlaceableCapacity',true,
        'placementRequiredCountsOnlyExecutionReadyWork',true,
        'managementOwnsPlacementBeforePrincipalEscalation',true,
        'workerIsNotResponsibleForMissingPlacement',true
      )
    );
  end if;

  return v_base||jsonb_build_object(
    'contractVersion','worker_weekly_capacity_management_state_v2',
    'capacityConflict',v_conflict,
    'placementRequired',false,
    'unplacedRequiredWork',v_all_unplaced,
    'unplacedRequiredCount',v_all_count,
    'unplacedRequiredMinutes',v_all_minutes,
    'readyUnplacedRequiredWork',v_ready_unplaced,
    'readyUnplacedRequiredCount',v_ready_count,
    'readyUnplacedRequiredMinutes',v_ready_minutes,
    'blockedRequiredWork',v_blocked_unplaced,
    'blockedRequiredCount',v_blocked_count,
    'blockedRequiredMinutes',v_blocked_minutes,
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
      'aggregateWeeklyFitDoesNotProveDailyPlacement',true,
      'blockedRequiredWorkIsObligationNotPlaceableCapacity',true,
      'placementRequiredCountsOnlyExecutionReadyWork',true
    )
  );
end;
$function$;

create or replace function atlas.management_commit_worker_required_placements_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_actor_user_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_item jsonb;
  v_task atlas.tasks%rowtype;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_after atlas.worker_day_task_placements%rowtype;
  v_task_id uuid;
  v_day date;
  v_window text;
  v_sort numeric;
  v_reason text;
  v_duration integer;
  v_load text;
  v_capacity jsonb;
  v_target integer;
  v_heavy_cap integer;
  v_total integer;
  v_heavy integer;
  v_traits jsonb;
  v_readiness jsonb;
  v_week_claim jsonb;
  v_org uuid;
  v_event_kind text;
  v_results jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  if p_farm_id is null or p_membership_id is null or p_actor_user_id is null then
    raise exception 'Farm, worker membership, and owner actor are required.' using errcode='22023';
  end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'array' then
    raise exception 'Placement plan must be a JSON array.' using errcode='22023';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=p_actor_user_id
  ) then
    raise exception 'Active owner membership is required for management placement.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership is required.' using errcode='42501';
  end if;
  select organization_id into v_org from atlas.farms where id=p_farm_id;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|management_required_placement_v1',0));

  for v_item in select value from jsonb_array_elements(p_plan)
  loop
    begin
      v_task_id:=(v_item->>'taskId')::uuid;
      v_day:=(v_item->>'serviceDate')::date;
    exception when others then
      raise exception 'Each placement needs valid taskId and serviceDate.' using errcode='22023';
    end;
    if v_day<v_today then raise exception 'Cannot place work into an elapsed Worker Day.' using errcode='22023'; end if;

    select * into v_task from atlas.tasks where id=v_task_id for update;
    if v_task.id is null or v_task.farm_id<>p_farm_id or v_task.assigned_membership_id<>p_membership_id then
      raise exception 'Task % is not assigned to this worker on this farm.',v_task_id using errcode='42501';
    end if;
    if v_task.status<>'open' then
      raise exception 'Only open tasks can be placed. Task % is %.',v_task.title,v_task.status using errcode='55000';
    end if;
    if atlas.task_is_superseded_recurring_serving_v1(v_task.id,v_day) then
      raise exception 'Superseded recurring serving cannot claim new Worker Day capacity: %',v_task.title using errcode='55000';
    end if;

    v_readiness:=atlas.task_execution_readiness_v1(v_task.id);
    if not coalesce((v_readiness->>'ready')::boolean,false) then
      raise exception 'Blocked/unready required work cannot be placed: %',v_task.title using errcode='55000';
    end if;
    if not atlas.task_temporally_eligible_v1(v_task.id,v_day) then
      raise exception 'Task is not temporally eligible on %: %',v_day,v_task.title using errcode='55000';
    end if;

    select c into v_week_claim
    from jsonb_array_elements(
      coalesce(atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,v_day)#>'{claims,requiredWeeklyWork}','[]'::jsonb)
    ) c
    where c->>'claimSubject'=v_task.id::text
    limit 1;
    if v_week_claim is null then
      raise exception 'Task is not a required weekly labor claim: %',v_task.title using errcode='55000';
    end if;

    select cp.expected_active_minutes,cp.physical_load into v_duration,v_load
    from atlas.task_capacity_plan_v1(v_task,v_day) cp;
    if coalesce(v_duration,0)<=0 then
      raise exception 'Task needs a positive capacity estimate before placement: %',v_task.title using errcode='55000';
    end if;

    v_traits:=atlas.task_clock_function_traits_v2(v_task.id,v_day);
    v_window:=coalesce(nullif(v_item->>'dayWindow',''),nullif(v_traits->>'dayWindow',''),'morning');
    if v_window not in ('morning','afternoon','evening') then v_window:='morning'; end if;
    v_sort:=coalesce(nullif(v_item->>'sortOrder','')::numeric,10000+v_count);
    v_reason:=coalesce(nullif(btrim(v_item->>'reason'),''),'Management placement of execution-ready required work.');

    v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_day);
    if coalesce(v_capacity->>'state','') not in ('working_day') then
      raise exception 'Worker Day is not available on %.',v_day using errcode='55000';
    end if;
    v_target:=case when v_capacity->>'capacityClass'='recovery'
      then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)
      else coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0) end;
    v_heavy_cap:=coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,0);

    select * into v_existing from atlas.worker_day_task_placements where task_id=v_task.id for update;
    if v_existing.id is null then
      insert into atlas.worker_day_task_placements(
        organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
        placement_source,placement_reason,state,owner_actor_user_id,planned_duration_minutes,planned_occurrence_id
      ) values (
        v_org,p_farm_id,p_membership_id,v_task.id,v_day,v_window,v_sort,
        'owner',v_reason,'placed',p_actor_user_id,v_duration,v_task.planned_occurrence_id
      ) returning * into v_after;
      v_event_kind:='owner_clock_plan_commit';
    else
      update atlas.worker_day_task_placements
      set service_date=v_day,
          day_window=v_window,
          sort_order=v_sort,
          placement_source='owner',
          placement_reason=v_reason,
          state='placed',
          owner_actor_user_id=p_actor_user_id,
          planned_start_at=null,
          planned_duration_minutes=v_duration,
          planned_occurrence_id=v_task.planned_occurrence_id,
          updated_at=now()
      where id=v_existing.id
      returning * into v_after;
      v_event_kind:=case
        when v_existing.state='returned_to_atlas' then 'owner_added'
        when v_existing.service_date<>v_day then 'owner_rescheduled'
        else 'owner_clock_plan_commit' end;
    end if;

    select
      coalesce(sum(greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0)),0)::integer,
      coalesce(sum(case when cp.physical_load='heavy' then greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0) else 0 end),0)::integer
    into v_total,v_heavy
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,v_day) cp
    where p.farm_id=p_farm_id and p.membership_id=p_membership_id
      and p.service_date=v_day and p.state='placed' and t.status='open';

    if v_total>v_target then
      raise exception 'Placement would overfill %: % minutes placed against % lawful minutes.',v_day,v_total,v_target using errcode='22023';
    end if;
    if v_heavy>v_heavy_cap then
      raise exception 'Placement would exceed heavy-work soft cap on %: % heavy minutes against %.',v_day,v_heavy,v_heavy_cap using errcode='22023';
    end if;

    insert into atlas.worker_day_task_placement_events(
      organization_id,farm_id,membership_id,task_id,placement_id,event_kind,
      from_service_date,to_service_date,from_day_window,to_day_window,
      from_sort_order,to_sort_order,actor_user_id,metadata,
      from_planned_occurrence_id,to_planned_occurrence_id
    ) values (
      v_org,p_farm_id,p_membership_id,v_task.id,v_after.id,v_event_kind,
      v_existing.service_date,v_after.service_date,v_existing.day_window,v_after.day_window,
      v_existing.sort_order,v_after.sort_order,p_actor_user_id,
      jsonb_build_object(
        'source','management_commit_worker_required_placements_v1',
        'reason',v_reason,
        'capacityMinutes',v_duration,
        'physicalLoad',v_load,
        'dayPlacedMinutesAfter',v_total,
        'dayHeavyMinutesAfter',v_heavy,
        'dayCapacityMinutes',v_target,
        'dayHeavySoftCapMinutes',v_heavy_cap
      ),
      v_existing.planned_occurrence_id,v_after.planned_occurrence_id
    );

    v_count:=v_count+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'taskId',v_task.id,'title',v_task.title,'serviceDate',v_day,'dayWindow',v_window,
      'sortOrder',v_sort,'capacityMinutes',v_duration,'physicalLoad',v_load,
      'dayPlacedMinutesAfter',v_total,'dayCapacityMinutes',v_target
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','management_commit_worker_required_placements_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'actorUserId',p_actor_user_id,
    'placedCount',v_count,'placements',v_results,
    'truthBoundary',jsonb_build_object(
      'onlyExecutionReadyRequiredWorkCanBePlaced',true,
      'blockedWorkCannotConsumeWorkerDayCapacity',true,
      'dayCapacityAndHeavySoftCapAreHardPlacementGuards',true,
      'returnedElapsedPlacementCanBeLawfullyReactivated',true
    )
  );
end;
$function$;

revoke all on function atlas.management_commit_worker_required_placements_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

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

  for v_item in
    select c.*,
      exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed') as placed_today,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
    where c.legacy_presentation_state='presented'
      and c.legacy_presentation_reason in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected')
      and not exists(
        select 1 from atlas.worker_day_task_placements otherp
        where otherp.farm_id=p_farm_id and otherp.membership_id=p_membership_id
          and otherp.task_id=c.task_id and otherp.state='placed' and otherp.service_date<>v_work_date
          and atlas.worker_day_placement_is_live_v1(otherp.farm_id,otherp.membership_id,otherp.service_date,now())
      )
    order by
      case when exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed') then 0 else 1 end,
      coalesce(c.consequence_tier,99),c.reality_warrant_order,c.due_date nulls last,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      c.lane_order,c.legacy_selection_rank,c.task_id
  loop
    v_rank:=v_rank+1;
    v_is_placed:=v_item.placed_today;
    v_item_heavy:=case when v_item.physical_load='heavy' then v_item.expected_active_minutes else 0 end;
    if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap then
      v_item_state:='presented';
      v_item_reason:=case when v_item.legacy_presentation_reason='required_over_capacity' then 'required_selected' else v_item.legacy_presentation_reason end;
      v_used_minutes:=v_used_minutes+v_item.expected_active_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      v_item_reason:=case when v_used_heavy_minutes+v_item_heavy>v_heavy_cap then 'next_up_heavy_capacity' else 'next_up_capacity' end;
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item.task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'requiredCandidate',true,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes));
  end loop;

  for v_item in
    select c.*,
      exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=v_work_date and p.task_id=c.task_id and p.state='placed') as placed_today,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
    where c.legacy_presentation_reason in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
      and not exists(
        select 1 from atlas.worker_day_task_placements otherp
        where otherp.farm_id=p_farm_id and otherp.membership_id=p_membership_id
          and otherp.task_id=c.task_id and otherp.state='placed' and otherp.service_date<>v_work_date
          and atlas.worker_day_placement_is_live_v1(otherp.farm_id,otherp.membership_id,otherp.service_date,now())
      )
    order by coalesce(c.consequence_tier,99),c.reality_warrant_order,c.due_date nulls last,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      c.lane_order,c.legacy_selection_rank,c.task_id
  loop
    v_rank:=v_rank+1;
    v_is_placed:=v_item.placed_today;
    v_item_heavy:=case when v_item.physical_load='heavy' then v_item.expected_active_minutes else 0 end;
    if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target
       and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap
       and v_optional_used_minutes+v_item.expected_active_minutes<=v_week_optional_room
       and v_optional_used_heavy_minutes+v_item_heavy<=v_week_optional_heavy_room then
      v_item_state:='presented'; v_item_reason:='within_day_capacity';
      v_used_minutes:=v_used_minutes+v_item.expected_active_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
      v_optional_used_minutes:=v_optional_used_minutes+v_item.expected_active_minutes;
      v_optional_used_heavy_minutes:=v_optional_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      v_item_reason:=case when v_used_heavy_minutes+v_item_heavy>v_heavy_cap or v_optional_used_heavy_minutes+v_item_heavy>v_week_optional_heavy_room then 'next_up_heavy_capacity' else 'next_up_capacity' end;
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item.task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'requiredCandidate',false,'placedToday',v_is_placed,
      'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes,
      'optionalUsedMinutesAfter',v_optional_used_minutes,'optionalUsedHeavyMinutesAfter',v_optional_used_heavy_minutes));
  end loop;

  return query
  with candidates as materialized (
    select c.*,
      c.legacy_presentation_state='presented' and c.legacy_presentation_reason in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected') as required_candidate,
      c.legacy_presentation_reason in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity') as flexible_capacity_candidate,
      v_decisions->c.task_id::text as decision,
      exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.task_id=c.task_id and p.state='placed' and p.service_date=v_work_date) as explicit_today,
      exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.task_id=c.task_id and p.state='placed' and p.service_date<>v_work_date and atlas.worker_day_placement_is_live_v1(p.farm_id,p.membership_id,p.service_date,now())) as committed_other_day,
      coalesce((atlas.task_execution_readiness_v1(c.task_id)->>'ready')::boolean,false) as execution_ready
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
  ), resolved as (
    select c.*,
      case
        when c.committed_other_day then 'held'
        when c.explicit_today and c.execution_ready then 'presented'
        when c.required_candidate or c.flexible_capacity_candidate then coalesce(c.decision->>'state','held')
        else c.legacy_presentation_state end as final_state,
      case
        when c.committed_other_day then 'committed_other_day'
        when c.explicit_today and c.execution_ready then 'committed_placement'
        when c.required_candidate or c.flexible_capacity_candidate then coalesce(c.decision->>'reason','next_up_capacity')
        else c.legacy_presentation_reason end as final_reason,
      case when c.explicit_today then 0 when c.required_candidate or c.flexible_capacity_candidate then coalesce((c.decision->>'rank')::integer,2147483647) else null end as capacity_rank,
      c.explicit_today as placed_today
    from candidates c
  ), ordered as (
    select x.*,
      row_number() over (
        order by
          case x.final_state when 'attention' then 0 when 'presented' then 1 else 2 end,
          case when x.final_state='presented' and x.placed_today then 0 when x.required_candidate then 1 when x.flexible_capacity_candidate then 2 else 3 end,
          x.capacity_rank nulls last,x.legacy_selection_rank,x.task_id
      )::bigint as final_rank
    from resolved x
  )
  select o.task_id,o.final_state,o.final_reason,o.lane_order,o.final_rank,
         o.work_lane,o.commitment_kind,o.effort_units,o.budget_units,o.notification_planned,
         case when o.required_candidate or o.flexible_capacity_candidate or o.explicit_today then false else o.legacy_overload end
  from ordered o
  order by o.final_rank;
end;
$function$;