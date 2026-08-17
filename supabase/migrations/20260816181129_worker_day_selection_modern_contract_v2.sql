create or replace function atlas.presented_work_selection_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
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
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_role text;
  v_capacity jsonb;
  v_capacity_class text;
  v_paid_target integer:=0;
  v_maximum integer:=0;
  v_heavy_cap integer:=0;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_target_role is null then raise exception 'Target membership is not active on this farm.' using errcode='42501'; end if;

  -- Sunday remains outside the ordinary selector. Explicit Sunday exceptions are
  -- governed by worker_next_up_v3 and do not create general Sunday capacity.
  if extract(dow from v_work_date)::integer=0 and v_target_role='farm_hand' then return; end if;

  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then return; end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_work_date);
  v_capacity_class:=coalesce(v_capacity->>'capacityClass','none');
  v_paid_target:=greatest(case when v_capacity_class='recovery'
    then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)
    else coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0) end,0);
  v_maximum:=greatest(case when v_capacity_class='recovery'
    then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,v_paid_target)
    else coalesce((v_capacity->>'maximumUsableMinutes')::integer,v_paid_target) end,v_paid_target);
  v_heavy_cap:=greatest(least(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,v_paid_target),v_maximum),0);

  return query
  with base as materialized (
    select
      r.*,
      t.status,t.due_date,t.priority,t.metadata,t.operation_class,t.planned_occurrence_id,
      c.expected_active_minutes,c.physical_load,c.effective_obligation_class,
      d.contract as deferral,
      readiness.contract as readiness,
      protection.contract as protection,
      consequence.contract as consequence,
      atlas.task_temporally_eligible_v1(t.id,v_work_date) as temporally_ready,
      atlas.task_sky_withheld_v1(t.id,v_work_date) as sky_withheld,
      (t.due_date is null or t.due_date<=v_work_date) as due_now,
      r.presentation_reason='owner_review' as owner_review,
      r.presentation_reason='superseded_rhythm_serving' as superseded_rhythm,
      (
        coalesce(t.commitment_kind,'')='hard_date'
        or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
        or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
        or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
      ) and t.due_date=v_work_date as exact_hard_date
    from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) r
    join atlas.tasks t on t.id=r.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,v_work_date) c
    cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,v_work_date) as contract) d
    cross join lateral (select atlas.task_execution_readiness_v1(t.id) as contract) readiness
    cross join lateral (select atlas.task_protected_farm_minimum_v1(t.id,v_work_date) as contract) protection
    cross join lateral (select atlas.task_effective_delay_consequence_v1(t.id,v_work_date) as contract) consequence
    where t.visibility_scope<>'system_internal'
      and (
        v_work_date<=v_today
        or (t.due_date is not null and t.due_date<=v_work_date)
      )
      and not exists (
        select 1
        from atlas.grow_room_round_requests rr
        join atlas.tasks visit on visit.id=rr.visit_task_id
        where rr.request_task_id=r.task_id and rr.resolved_at is null
          and visit.farm_id=p_farm_id and visit.status in ('open','blocked')
          and visit.assigned_membership_id=p_membership_id
      )
  ), ready as (
    select
      b.*,
      coalesce((b.deferral->>'operationallyCommitted')::boolean,false) as operationally_committed,
      (b.deferral->>'lawfulOnServiceDate')::boolean as lawful_on_service_date,
      coalesce((b.readiness->>'ready')::boolean,false) as execution_ready,
      coalesce((b.readiness->>'prerequisitesReady')::boolean,false) as prerequisites_ready,
      coalesce((b.readiness->>'resourcesReady')::boolean,false) as resources_ready,
      coalesce((b.readiness->>'destinationReady')::boolean,false) as destination_ready,
      coalesce((b.protection->>'protectedFarmMinimum')::boolean,false) as protected_minimum,
      case when coalesce(b.consequence->>'effectiveTier','') ~ '^[1-6]$'
        then (b.consequence->>'effectiveTier')::integer else null end as consequence_tier,
      coalesce((b.consequence->>'needsConsequenceResolution')::boolean,true) as consequence_unresolved,
      (
        b.status='open'
        and b.due_now
        and not b.owner_review
        and not b.superseded_rhythm
        and coalesce((b.readiness->>'ready')::boolean,false)
        and b.temporally_ready
        and not b.sky_withheld
        and coalesce((b.deferral->>'lawfulOnServiceDate')::boolean,true) is distinct from false
        and b.expected_active_minutes>0
      ) as selectable
    from base b
  ), classified as (
    select
      r.*,
      (
        r.selectable and (
          r.protected_minimum
          or coalesce(r.consequence_tier,99)<=4
          or r.exact_hard_date
          or (r.operationally_committed and r.due_date=v_work_date and coalesce(r.consequence_tier,99)<=5)
        )
      ) as required_today
    from ready r
  ), required_stats as (
    select
      coalesce(sum(c.expected_active_minutes) filter(where c.required_today),0)::integer as minutes,
      coalesce(sum(c.expected_active_minutes) filter(where c.required_today and c.physical_load='heavy'),0)::integer as heavy_minutes
    from classified c
  ), flexible_ranked as (
    select
      c.task_id,
      sum(c.expected_active_minutes) over (
        order by
          coalesce(c.consequence_tier,99),
          c.due_date nulls last,
          case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
          c.lane_order,c.selection_rank,c.task_id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes,
      sum(case when c.physical_load='heavy' then c.expected_active_minutes else 0 end) over (
        order by
          coalesce(c.consequence_tier,99),
          c.due_date nulls last,
          case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
          c.lane_order,c.selection_rank,c.task_id
        rows between unbounded preceding and current row
      )::integer as cumulative_heavy_minutes
    from classified c
    where c.selectable and not c.required_today
  ), resolved as (
    select
      c.*,
      rs.minutes as required_minutes,
      rs.heavy_minutes as required_heavy_minutes,
      greatest(v_paid_target-rs.minutes,0)::integer as flexible_room,
      greatest(v_heavy_cap-rs.heavy_minutes,0)::integer as flexible_heavy_room,
      fr.cumulative_minutes,fr.cumulative_heavy_minutes
    from classified c
    cross join required_stats rs
    left join flexible_ranked fr on fr.task_id=c.task_id
  )
  select
    x.task_id,
    case
      when x.owner_review and v_target_role='owner' then 'attention'
      when x.owner_review then 'held'
      when x.status='blocked' and x.due_now then 'attention'
      when not x.due_now then 'held'
      when x.superseded_rhythm then 'held'
      when not x.prerequisites_ready then 'held'
      when not x.resources_ready then 'held'
      when not x.destination_ready then 'held'
      when not x.temporally_ready then 'held'
      when x.lawful_on_service_date is false then 'held'
      when x.sky_withheld then 'held'
      when x.expected_active_minutes<=0 then 'held'
      when x.consequence_unresolved then 'held'
      when x.required_today then 'presented'
      when coalesce(x.cumulative_minutes,0)<=x.flexible_room
       and coalesce(x.cumulative_heavy_minutes,0)<=x.flexible_heavy_room then 'presented'
      else 'held'
    end,
    case
      when x.owner_review then 'owner_review'
      when x.status='blocked' then 'blocked'
      when not x.due_now then 'future'
      when x.superseded_rhythm then 'superseded_rhythm_serving'
      when not x.prerequisites_ready then 'waiting_on_prerequisite'
      when not x.resources_ready then 'waiting_on_resource'
      when not x.destination_ready then 'waiting_on_destination'
      when not x.temporally_ready then 'temporal_not_ready'
      when x.lawful_on_service_date is false then 'outside_lawful_window'
      when x.sky_withheld then 'awaiting_favored_sky_window'
      when x.expected_active_minutes<=0 then 'work_estimate_required'
      when x.consequence_unresolved then 'consequence_resolution_required'
      when x.required_today and x.protected_minimum then 'protected_minimum_selected'
      when x.required_today and coalesce(x.consequence_tier,99)<=4 then 'consequence_required_selected'
      when x.required_today and x.exact_hard_date then 'hard_date_selected'
      when x.required_today and x.required_minutes>v_maximum then 'required_over_capacity'
      when x.required_today then 'required_selected'
      when coalesce(x.cumulative_minutes,0)<=x.flexible_room
       and coalesce(x.cumulative_heavy_minutes,0)<=x.flexible_heavy_room then 'within_day_capacity'
      when coalesce(x.cumulative_heavy_minutes,0)>x.flexible_heavy_room then 'next_up_heavy_capacity'
      else 'next_up_capacity'
    end,
    x.lane_order,
    row_number() over (
      order by
        case
          when x.owner_review and v_target_role='owner' then 0
          when x.required_today then 1
          when x.selectable and coalesce(x.cumulative_minutes,0)<=x.flexible_room
            and coalesce(x.cumulative_heavy_minutes,0)<=x.flexible_heavy_room then 2
          else 3
        end,
        case when x.protected_minimum then 0 else 1 end,
        coalesce(x.consequence_tier,99),
        x.due_date nulls last,
        x.lane_order,x.selection_rank,x.task_id
    )::bigint,
    x.work_lane,x.commitment_kind,x.effort_units,x.budget_units,x.notification_planned,
    (x.required_today and (x.required_minutes>v_maximum or x.required_heavy_minutes>v_heavy_cap))
  from resolved x
  order by 4,5;
end;
$$;

create or replace function atlas.worker_day_selection_overlay_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_real jsonb:='[]'::jsonb;
  v_next jsonb:='[]'::jsonb;
  v_automatic jsonb:='[]'::jsonb;
  v_committed integer:=0;
  v_automatic_minutes integer:=0;
  v_target integer:=0;
  v_capacity jsonb;
  v_item jsonb;
  v_queue_task uuid;
  v_timezone text:='America/Chicago';
  v_today date;
begin
  if coalesce((v_plan->>'availableWorkerDay')::boolean,true)=false then
    return jsonb_set(v_plan,'{nextUp}','[]'::jsonb,true);
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_today:=(now() at time zone coalesce(v_timezone,'America/Chicago'))::date;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id','task:'||t.id::text,'kind','real','sourceKind','task','sourceId',t.id,'taskId',t.id,
      'title',t.title,'status',t.status,'expectedActiveMinutes',capacity.expected_active_minutes,
      'physicalLoad',capacity.physical_load,
      'dayWindow',coalesce(placement.day_window,atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata)),
      'workOrderNumber',coalesce(placement.sort_order,atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata)),
      'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
      'automatic',false,'requiresOwnerApproval',false,'presentationReason',s.presentation_reason,
      'workLane',s.work_lane,'commitmentKind',s.commitment_kind,
      'protectedFarmMinimum',coalesce((protection.contract->>'protectedFarmMinimum')::boolean,false),
      'consequenceTier',case when coalesce(consequence.contract->>'effectiveTier','') ~ '^[1-6]$' then (consequence.contract->>'effectiveTier')::integer else null end,
      'capacityDeferrable',coalesce((deferral.contract->>'capacityDeferrable')::boolean,false),
      'placementSource',placement.placement_source,'placementReason',placement.placement_reason
    ) order by
      case coalesce(placement.day_window,atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata)) when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      case when coalesce((protection.contract->>'protectedFarmMinimum')::boolean,false) then 0 else 1 end,
      case when coalesce(consequence.contract->>'effectiveTier','') ~ '^[1-6]$' then (consequence.contract->>'effectiveTier')::integer else 99 end,
      coalesce(placement.sort_order,atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata)),s.selection_rank,t.title,t.id),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes),0)::integer
  into v_real,v_committed
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_day) s
  join atlas.tasks t on t.id=s.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,p_day) as contract) deferral
  cross join lateral (select atlas.task_protected_farm_minimum_v1(t.id,p_day) as contract) protection
  cross join lateral (select atlas.task_effective_delay_consequence_v1(t.id,p_day) as contract) consequence
  left join atlas.worker_day_task_placements placement
    on placement.farm_id=p_farm_id and placement.membership_id=p_membership_id
   and placement.task_id=t.id and placement.service_date=p_day and placement.state='placed'
  where s.presentation_state='presented';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','task:'||t.id::text,'kind','next_up','sourceKind','task','sourceId',t.id,'taskId',t.id,
    'title',t.title,'status',t.status,'expectedActiveMinutes',capacity.expected_active_minutes,
    'physicalLoad',capacity.physical_load,
    'dayWindow',atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata),
    'workOrderNumber',atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata),
    'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
    'nextUpReason',s.presentation_reason,
    'deferredByCapacity',s.presentation_reason in ('next_up_capacity','next_up_heavy_capacity'),
    'executableNow',s.presentation_reason in ('next_up_capacity','next_up_heavy_capacity'),
    'workLane',s.work_lane,'commitmentKind',s.commitment_kind,
    'executionReadiness',readiness.contract,
    'protectedFarmMinimum',coalesce((protection.contract->>'protectedFarmMinimum')::boolean,false),
    'consequenceTier',case when coalesce(consequence.contract->>'effectiveTier','') ~ '^[1-6]$' then (consequence.contract->>'effectiveTier')::integer else null end,
    'capacityDeferrable',coalesce((deferral.contract->>'capacityDeferrable')::boolean,false)
  ) order by s.lane_order,s.selection_rank,t.title,t.id),'[]'::jsonb)
  into v_next
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_day) s
  join atlas.tasks t on t.id=s.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,p_day) as contract) deferral
  cross join lateral (select atlas.task_execution_readiness_v1(t.id) as contract) readiness
  cross join lateral (select atlas.task_protected_farm_minimum_v1(t.id,p_day) as contract) protection
  cross join lateral (select atlas.task_effective_delay_consequence_v1(t.id,p_day) as contract) consequence
  where s.presentation_state in ('held','attention')
    and (t.due_date is null or t.due_date<=p_day)
    and s.presentation_reason in (
      'next_up_capacity','next_up_heavy_capacity','waiting_on_prerequisite','waiting_on_resource',
      'waiting_on_destination','temporal_not_ready','outside_lawful_window','awaiting_favored_sky_window',
      'work_estimate_required','consequence_resolution_required','blocked'
    );

  -- Released task truth owns the real work. Keep future synthetic queue slots only
  -- when their underlying released task is not already selected.
  if p_day<=v_today then
    v_automatic:='[]'::jsonb;
  else
    for v_item in select value from jsonb_array_elements(coalesce(v_plan->'automaticWork','[]'::jsonb)) loop
      v_queue_task:=null;
      if v_item->>'sourceKind'='queue' then
        begin
          select qi.task_id into v_queue_task
          from atlas.task_release_queue_items qi
          where qi.id=(v_item->>'sourceId')::uuid;
        exception when others then v_queue_task:=null; end;
      end if;
      if v_queue_task is not null and exists(
        select 1 from jsonb_array_elements(v_real) rw where rw->>'taskId'=v_queue_task::text
      ) then
        continue;
      end if;
      v_automatic:=v_automatic||jsonb_build_array(v_item);
    end loop;
  end if;

  select coalesce(sum(coalesce(nullif(a->>'expectedActiveMinutes','')::integer,0)),0)::integer
  into v_automatic_minutes
  from jsonb_array_elements(v_automatic) a;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);
  v_target:=case when v_capacity->>'capacityClass'='recovery'
    then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)
    else coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0) end;

  v_plan:=jsonb_set(v_plan,'{realWork}',v_real,true);
  v_plan:=jsonb_set(v_plan,'{nextUp}',v_next,true);
  v_plan:=jsonb_set(v_plan,'{automaticWork}',v_automatic,true);
  v_plan:=jsonb_set(v_plan,'{automaticPaidMinutes}',to_jsonb(v_automatic_minutes),true);
  v_plan:=jsonb_set(v_plan,'{committedPaidMinutes}',to_jsonb(v_committed),true);
  v_plan:=jsonb_set(v_plan,'{paidTargetMinutes}',to_jsonb(v_target),true);
  v_plan:=jsonb_set(v_plan,'{remainingPaidMinutes}',to_jsonb(greatest(v_target-v_committed-v_automatic_minutes,0)),true);
  v_plan:=jsonb_set(v_plan,'{selectionContractVersion}',to_jsonb('worker_day_selection_v2'::text),true);
  return v_plan;
end;
$$;