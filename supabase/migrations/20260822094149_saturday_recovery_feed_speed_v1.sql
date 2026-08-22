create or replace function atlas.presented_work_selection_rows_v3(
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
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_target_role text;
  v_capacity jsonb;
  v_capacity_class text;
  v_paid_target integer:=0;
  v_heavy_cap integer:=0;
  v_used_minutes integer:=0;
  v_used_heavy_minutes integer:=0;
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
  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;
  if extract(dow from v_work_date)::integer=0 and v_target_role='farm_hand' then return; end if;
  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then return; end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_work_date);
  v_capacity_class:=coalesce(v_capacity->>'capacityClass','none');
  if v_target_role<>'farm_hand' or v_capacity_class<>'recovery' then
    return query select * from atlas.presented_work_selection_rows_v2(p_farm_id,p_membership_id,v_work_date);
    return;
  end if;

  v_paid_target:=greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0),0);
  v_heavy_cap:=greatest(least(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,v_paid_target),v_paid_target),0);

  select
    coalesce(sum(greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0)),0)::integer,
    coalesce(sum(case when cp.physical_load='heavy' then greatest(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0),0) else 0 end),0)::integer
  into v_used_minutes,v_used_heavy_minutes
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,v_work_date) cp
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id
    and p.service_date=v_work_date and p.state='placed' and t.status='open';

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
    'executionReady',coalesce((atlas.task_execution_readiness_v1(c.task_id)->>'ready')::boolean,false),
    'recoveryRequired',(
      c.work_lane in ('required','process_continuation')
      or c.commitment_kind in ('hard_date','dependency')
      or coalesce(t.metadata->>'persistent_weed_card','false')='true'
      or coalesce(t.metadata->>'daily_slot_policy','')='exactly_one_weed_card_per_workday'
    )
  ) order by c.legacy_selection_rank,c.task_id),'[]'::jsonb)
  into v_candidates
  from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
  join atlas.tasks t on t.id=c.task_id;

  for v_item in
    select value
    from jsonb_array_elements(v_candidates)
    where not coalesce((value->>'committedOtherDay')::boolean,false)
      and value->>'legacyPresentationState'='presented'
      and (
        value->>'legacyPresentationReason' in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected')
        or (
          coalesce((value->>'recoveryRequired')::boolean,false)
          and value->>'legacyPresentationReason' in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
        )
      )
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
    if v_is_placed and coalesce((v_item->>'executionReady')::boolean,false) then
      v_item_state:='presented';
      v_item_reason:='committed_placement';
    elsif not coalesce((v_item->>'executionReady')::boolean,false) then
      v_item_state:='held';
      v_item_reason:=coalesce(nullif(v_item->>'legacyPresentationReason',''),'blocked');
    elsif v_used_minutes+v_item_minutes<=v_paid_target and v_used_heavy_minutes+v_item_heavy<=v_heavy_cap then
      v_item_state:='presented';
      v_item_reason:='recovery_required_selected';
      v_used_minutes:=v_used_minutes+v_item_minutes;
      v_used_heavy_minutes:=v_used_heavy_minutes+v_item_heavy;
    else
      v_item_state:='held';
      v_item_reason:=case when v_used_heavy_minutes+v_item_heavy>v_heavy_cap then 'next_up_heavy_capacity' else 'next_up_capacity' end;
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item_task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes
    ));
  end loop;

  for v_item in
    select value
    from jsonb_array_elements(v_candidates)
    where not coalesce((value->>'committedOtherDay')::boolean,false)
      and value->>'legacyPresentationReason' in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
      and not coalesce((value->>'recoveryRequired')::boolean,false)
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
    if v_is_placed and coalesce((v_item->>'executionReady')::boolean,false) then
      v_item_state:='presented';
      v_item_reason:='committed_placement';
    else
      v_item_state:='held';
      v_item_reason:='recovery_reserved_for_required';
    end if;
    v_decisions:=v_decisions||jsonb_build_object(v_item_task_id::text,jsonb_build_object(
      'state',v_item_state,'reason',v_item_reason,'rank',v_rank,'usedMinutesAfter',v_used_minutes,'usedHeavyMinutesAfter',v_used_heavy_minutes
    ));
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
      v_decisions->(c->>'taskId') decision
    from jsonb_array_elements(v_candidates) c
  ), resolved as (
    select c.*,
      case
        when c.committed_other_day then 'held'
        when c.explicit_today and c.execution_ready then 'presented'
        when c.decision is not null then coalesce(c.decision->>'state','held')
        else c.legacy_presentation_state end final_state,
      case
        when c.committed_other_day then 'committed_other_day'
        when c.explicit_today and c.execution_ready then 'committed_placement'
        when c.decision is not null then coalesce(c.decision->>'reason','recovery_reserved_for_required')
        else c.legacy_presentation_reason end final_reason,
      case when c.explicit_today then 0 when c.decision is not null then coalesce((c.decision->>'rank')::integer,2147483647) else null end capacity_rank,
      c.explicit_today placed_today
    from candidates c
  ), ordered as (
    select x.*,
      row_number() over(order by
        case x.final_state when 'attention' then 0 when 'presented' then 1 else 2 end,
        case when x.final_state='presented' and x.placed_today then 0 when x.decision is not null then 1 else 2 end,
        x.capacity_rank nulls last,x.legacy_selection_rank,x.task_id
      )::bigint final_rank
    from resolved x
  )
  select o.task_id,o.final_state,o.final_reason,o.lane_order,o.final_rank,
         o.work_lane,o.commitment_kind,o.effort_units,o.budget_units,o.notification_planned,
         case when o.decision is not null or o.explicit_today then false else o.legacy_overload end
  from ordered o
  order by o.final_rank;
end;
$function$;

create or replace function atlas.presented_work_selection_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
)
returns table(task_id uuid, presentation_state text, presentation_reason text, lane_order integer, selection_rank bigint, work_lane text, commitment_kind text, effort_units numeric, budget_units numeric, notification_planned boolean, overload boolean)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
  select * from atlas.presented_work_selection_rows_v3(p_farm_id,p_membership_id,p_work_date);
$function$;

create or replace function atlas.worker_day_feed_plan_live_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_capacity jsonb;
  v_target integer:=0;
  v_selection jsonb:='[]'::jsonb;
  v_real jsonb:='[]'::jsonb;
  v_committed integer:=0;
begin
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);
  v_target:=case when v_capacity->>'capacityClass'='recovery'
    then greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0),0)
    else greatest(coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0),0) end;

  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,p_day) then
    return jsonb_build_object(
      'contractVersion','owner_worker_day_feed_plan_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
      'availableWorkerDay',false,'paidTargetMinutes',v_target,'committedPaidMinutes',0,'automaticPaidMinutes',0,'remainingPaidMinutes',v_target,
      'realWork','[]'::jsonb,'automaticWork','[]'::jsonb,'suggestions','[]'::jsonb,'warnings','[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId',s.task_id,
    'presentationState',s.presentation_state,
    'presentationReason',s.presentation_reason,
    'selectionRank',s.selection_rank,
    'workLane',s.work_lane,
    'commitmentKind',s.commitment_kind
  ) order by s.selection_rank,s.task_id),'[]'::jsonb)
  into v_selection
  from atlas.presented_work_selection_rows_v3(p_farm_id,p_membership_id,p_day) s;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id','task:'||t.id::text,
      'kind','real',
      'sourceKind','task',
      'sourceId',t.id,
      'taskId',t.id,
      'title',t.title,
      'status',t.status,
      'expectedActiveMinutes',capacity.expected_active_minutes,
      'dayWindow',coalesce(placement.day_window,atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata)),
      'workOrderNumber',coalesce(placement.sort_order,atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata)),
      'environment',nullif(t.metadata->>'environment',''),
      'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
      'automatic',false,
      'requiresOwnerApproval',false,
      'reason',s.item->>'presentationReason',
      'commitmentKind',s.item->>'commitmentKind'
    ) order by
      case coalesce(placement.day_window,atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata)) when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      coalesce(placement.sort_order,atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata)),
      coalesce(nullif(s.item->>'selectionRank','')::bigint,9223372036854775807),t.title,t.id),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes),0)::integer
  into v_real,v_committed
  from jsonb_array_elements(v_selection) s(item)
  join atlas.tasks t on t.id=(s.item->>'taskId')::uuid
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  left join atlas.worker_day_task_placements placement
    on placement.farm_id=p_farm_id and placement.membership_id=p_membership_id
   and placement.task_id=t.id and placement.service_date=p_day and placement.state='placed'
  where s.item->>'presentationState'='presented';

  return jsonb_build_object(
    'contractVersion','owner_worker_day_feed_plan_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'availableWorkerDay',true,'paidTargetMinutes',v_target,
    'committedPaidMinutes',v_committed,'automaticPaidMinutes',0,
    'remainingPaidMinutes',greatest(v_target-v_committed,0),
    'realWork',v_real,'automaticWork','[]'::jsonb,'suggestions','[]'::jsonb,'warnings','[]'::jsonb,
    'selectionContractVersion','presented_work_selection_rows_v3_recovery_fast_path'
  );
end;
$function$;

create or replace function atlas.owner_worker_day_plan_choreographed_api_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_plan jsonb;
  v_timeline jsonb;
  v_timezone text:='America/Chicago';
  v_today date;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role='owner') then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_today:=(now() at time zone coalesce(v_timezone,'America/Chicago'))::date;

  if p_day=v_today then
    v_plan:=atlas.worker_day_feed_plan_live_v1(p_farm_id,p_membership_id,p_day);
  else
    v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
    v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  end if;

  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_timeline:=atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',atlas.worker_day_chronology_ordered_v1(v_timeline,p_day),true);
  return v_plan;
end;
$function$;

revoke all on function atlas.owner_worker_day_plan_choreographed_api_v2(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_worker_day_plan_choreographed_api_v2(uuid,uuid,date) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
)
values(
  'atlas.owner_worker_day_plan_choreographed_api_v2(uuid, uuid, date)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read the live canonical worker feed without legacy duplicate planning work',
    'boundary','farm Owner only with active Farm Hand target',
    'capacity','recovery days admit required/protected/process-continuation work and the persistent Weed slot within recovery capacity',
    'performance','live day uses one canonical selection pass and omits legacy suggestion/reality explanation rebuilds',
    'publicInheritanceRemoved',true
  ),now(),now(),false
)
on conflict(signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at,
  anonymous_execute_expected=excluded.anonymous_execute_expected;
