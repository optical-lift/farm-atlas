-- Pass 3D — Worker Day deferrability + Next Up
-- Governing rule: capacity may defer only genuinely flexible work.
-- Required/process/rhythm/placed/human-rescheduled work remains visible even when it overfills the day.
-- Recovery capacity is not planned capacity; configured/effective target minutes are the flexible planning floor.

create or replace function atlas.task_worker_day_deferral_v1(
  p_task_id uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_capacity record;
  v_worker_key text;
  v_operationally_committed boolean:=false;
  v_temporal_hard boolean:=false;
  v_lawful boolean:=null;
  v_deferrable boolean;
begin
  select t.* into v_task from atlas.tasks t where t.id=p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode='P0002';
  end if;

  select * into v_capacity from atlas.task_capacity_plan_v1(v_task,p_work_date);

  if v_task.assigned_membership_id is not null then
    select fm.worker_key into v_worker_key
    from atlas.farm_memberships fm
    where fm.id=v_task.assigned_membership_id and fm.farm_id=v_task.farm_id;

    v_operationally_committed:=exists(
      select 1
      from atlas.worker_day_task_placements placement
      where placement.farm_id=v_task.farm_id
        and placement.membership_id=v_task.assigned_membership_id
        and placement.task_id=v_task.id
        and placement.service_date=p_work_date
        and placement.state='placed'
    ) or atlas.task_rescheduled_by_membership_v1(v_task.id,v_task.assigned_membership_id,v_worker_key);
  end if;

  if v_task.planned_occurrence_id is not null then
    select
      case
        when o.earliest_lawful_date is not null and p_work_date<o.earliest_lawful_date then false
        when o.latest_lawful_date is not null and p_work_date>o.latest_lawful_date then false
        when o.hard_finish_date is not null and p_work_date>o.hard_finish_date then false
        when o.earliest_lawful_date is not null and coalesce(o.latest_lawful_date,o.hard_finish_date) is not null then true
        else null
      end,
      (
        (o.latest_lawful_date is not null and p_work_date>=o.latest_lawful_date)
        or (o.hard_finish_date is not null and p_work_date>=o.hard_finish_date)
        or (
          o.earliest_lawful_date is not null
          and coalesce(o.latest_lawful_date,o.hard_finish_date)=o.earliest_lawful_date
          and p_work_date=o.earliest_lawful_date
        )
      )
    into v_lawful,v_temporal_hard
    from atlas.planned_work_occurrences o
    where o.id=v_task.planned_occurrence_id;
  end if;

  v_deferrable:=not v_operationally_committed
    and not v_temporal_hard
    and coalesce(v_task.work_lane,'discretionary')='discretionary'
    and coalesce(v_task.commitment_kind,'floating') in ('floating','persistent')
    and coalesce(v_capacity.effective_obligation_class,'optional_improvement') not in ('hard_window','process_continuation');

  return jsonb_build_object(
    'contractVersion','task_worker_day_deferral_v1',
    'taskId',v_task.id,
    'serviceDate',p_work_date,
    'capacityDeferrable',v_deferrable,
    'operationallyCommitted',v_operationally_committed,
    'temporalHardBoundary',v_temporal_hard,
    'lawfulOnServiceDate',v_lawful,
    'workLane',v_task.work_lane,
    'commitmentKind',v_task.commitment_kind,
    'effectiveObligationClass',v_capacity.effective_obligation_class
  );
end;
$$;

revoke all on function atlas.task_worker_day_deferral_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.task_worker_day_deferral_v1(uuid,date) to service_role;

create or replace function atlas.presented_work_selection_rows_v1(
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
as $$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_role text;
  v_capacity jsonb;
  v_paid_target integer:=0;
  v_maximum integer:=0;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;

  -- Partial unavailability reduces day capacity; only a genuinely unavailable worker day suppresses the selector.
  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then
    return;
  end if;

  v_capacity:=atlas.clock_day_capacity_state_v2(p_farm_id,p_membership_id,v_work_date,0,0);
  v_paid_target:=greatest(coalesce((v_capacity->>'paidTargetMinutes')::integer,0),0);
  v_maximum:=greatest(coalesce((v_capacity->>'maximumPlannedMinutes')::integer,v_paid_target),v_paid_target);

  if extract(dow from v_work_date)=0 and v_target_role='farm_hand' then
    return query
    with allowed as (
      select r.*
      from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) r
      join atlas.tasks t on t.id=r.task_id
      where t.visibility_scope<>'system_internal'
        and t.due_date=v_work_date
        and t.assigned_membership_id=p_membership_id
        and coalesce((t.metadata->>'allow_sunday')::boolean,false) is true
        and coalesce((t.metadata->>'owner_schedule_override')::boolean,false) is true
        and atlas.task_prerequisites_ready_v1(t.id)
        and atlas.task_required_resources_available_v1(t.id)
        and atlas.task_temporally_eligible_v1(t.id,v_work_date)
    )
    select allowed.task_id,'presented'::text,'owner_sunday_override'::text,allowed.lane_order,
      row_number() over(order by allowed.lane_order,allowed.selection_rank,allowed.task_id)::bigint,
      allowed.work_lane,allowed.commitment_kind,allowed.effort_units,allowed.budget_units,
      allowed.notification_planned,false
    from allowed
    order by 4,5;
    return;
  end if;

  return query
  with base as materialized (
    select
      r.*,
      t.status,
      t.due_date,
      t.priority,
      c.expected_active_minutes,
      c.effective_obligation_class,
      d.contract as deferral,
      atlas.task_prerequisites_ready_v1(t.id) as prerequisites_ready,
      atlas.task_required_resources_available_v1(t.id) as resources_ready,
      atlas.task_temporally_eligible_v1(t.id,v_work_date) as temporally_ready,
      atlas.task_sky_withheld_v1(t.id,v_work_date) as sky_withheld,
      (t.due_date is null or t.due_date<=v_work_date) as due_now,
      r.presentation_reason='owner_review' as owner_review,
      r.presentation_reason='superseded_rhythm_serving' as superseded_rhythm
    from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) r
    join atlas.tasks t on t.id=r.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,v_work_date) c
    cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,v_work_date) as contract) d
    where t.visibility_scope<>'system_internal'
      and (v_work_date<=v_today or t.due_date=v_work_date)
      and not exists (
        select 1
        from atlas.grow_room_round_requests rr
        join atlas.tasks visit on visit.id=rr.visit_task_id
        where rr.request_task_id=r.task_id
          and rr.resolved_at is null
          and visit.farm_id=p_farm_id
          and visit.status in ('open','blocked')
          and visit.assigned_membership_id=p_membership_id
      )
  ), ready as (
    select
      b.*,
      coalesce((b.deferral->>'capacityDeferrable')::boolean,false) as capacity_deferrable,
      coalesce((b.deferral->>'operationallyCommitted')::boolean,false) as operationally_committed,
      (b.deferral->>'lawfulOnServiceDate')::boolean as lawful_on_service_date,
      (
        b.status='open'
        and b.due_now
        and not b.owner_review
        and not b.superseded_rhythm
        and b.prerequisites_ready
        and b.resources_ready
        and b.temporally_ready
        and not b.sky_withheld
        and coalesce((b.deferral->>'lawfulOnServiceDate')::boolean,true) is distinct from false
      ) as selectable
    from base b
  ), required_stats as (
    select coalesce(sum(r.expected_active_minutes),0)::integer as minutes
    from ready r
    where r.selectable and not r.capacity_deferrable
  ), flexible_ranked as (
    select
      r.task_id,
      sum(r.expected_active_minutes) over (
        order by
          case r.effective_obligation_class when 'recovery_work' then 0 when 'routine_production' then 1 else 2 end,
          case r.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
          r.due_date nulls last,
          r.lane_order,
          r.selection_rank,
          r.task_id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes
    from ready r
    where r.selectable and r.capacity_deferrable
  ), resolved as (
    select
      r.*,
      required_stats.minutes as required_minutes,
      greatest(v_paid_target-required_stats.minutes,0)::integer as flexible_room,
      flexible_ranked.cumulative_minutes
    from ready r
    cross join required_stats
    left join flexible_ranked on flexible_ranked.task_id=r.task_id
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
      when not x.temporally_ready then 'held'
      when x.lawful_on_service_date is false then 'held'
      when x.sky_withheld then 'held'
      when not x.capacity_deferrable then 'presented'
      when coalesce(x.cumulative_minutes,0)<=x.flexible_room then 'presented'
      else 'held'
    end,
    case
      when x.owner_review then 'owner_review'
      when x.status='blocked' then 'blocked'
      when not x.due_now then 'future'
      when x.superseded_rhythm then 'superseded_rhythm_serving'
      when not x.prerequisites_ready then 'waiting_on_prerequisite'
      when not x.resources_ready then 'waiting_on_resource'
      when not x.temporally_ready then 'temporal_not_ready'
      when x.lawful_on_service_date is false then 'outside_lawful_window'
      when x.sky_withheld then 'awaiting_favored_sky_window'
      when not x.capacity_deferrable and x.operationally_committed then 'operational_commitment_selected'
      when not x.capacity_deferrable and x.effective_obligation_class='hard_window' then 'hard_window_selected'
      when not x.capacity_deferrable and x.required_minutes>v_paid_target then 'required_over_capacity'
      when not x.capacity_deferrable then 'required_selected'
      when coalesce(x.cumulative_minutes,0)<=x.flexible_room then 'within_day_capacity'
      when x.effective_obligation_class='recovery_work' then 'next_up_recovery_capacity'
      else 'next_up_capacity'
    end,
    x.lane_order,
    row_number() over (
      order by
        case
          when x.owner_review and v_target_role='owner' then 0
          when x.selectable and not x.capacity_deferrable then 1
          when x.selectable and x.capacity_deferrable and coalesce(x.cumulative_minutes,0)<=x.flexible_room then 2
          else 3
        end,
        x.lane_order,
        x.selection_rank,
        x.task_id
    )::bigint,
    x.work_lane,
    x.commitment_kind,
    x.effort_units,
    x.budget_units,
    x.notification_planned,
    (x.selectable and not x.capacity_deferrable and x.required_minutes>v_maximum)
  from resolved x
  order by 4,5;
end;
$$;

-- Card projection must mirror the selector rather than re-implementing selection rules.
create or replace function atlas.presented_work_rows_v1(
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
  overload boolean,
  task_card jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  select
    s.task_id,
    s.presentation_state,
    s.presentation_reason,
    s.lane_order,
    s.selection_rank,
    s.work_lane,
    s.commitment_kind,
    s.effort_units,
    s.budget_units,
    s.notification_planned,
    s.overload,
    card.card || jsonb_build_object(
      'sky_timing',atlas.task_sky_presentation_gate_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)),
      'capacity_deferral',atlas.task_worker_day_deferral_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date))
    )
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_work_date) s
  cross join lateral (
    select to_jsonb(c) as card
    from atlas.v_task_cards c
    where c.task_id=s.task_id
    limit 1
  ) card
  order by s.lane_order,s.selection_rank
$$;

-- Overlay the supported Worker Day response instead of rewriting the legacy assembler in place.
create or replace function atlas.worker_day_selection_overlay_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_real jsonb:='[]'::jsonb;
  v_next jsonb:='[]'::jsonb;
  v_committed integer:=0;
  v_automatic integer:=0;
  v_target integer:=0;
begin
  if coalesce((v_plan->>'availableWorkerDay')::boolean,true)=false then
    return jsonb_set(v_plan,'{nextUp}','[]'::jsonb,true);
  end if;

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
      'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
      'automatic',false,
      'requiresOwnerApproval',false,
      'presentationReason',s.presentation_reason,
      'workLane',s.work_lane,
      'commitmentKind',s.commitment_kind,
      'capacityDeferrable',coalesce((deferral.contract->>'capacityDeferrable')::boolean,false),
      'placementSource',placement.placement_source,
      'placementReason',placement.placement_reason
    ) order by
      case coalesce(placement.day_window,atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata)) when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      coalesce(placement.sort_order,atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata)),
      s.selection_rank,
      t.title,
      t.id),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes),0)::integer
  into v_real,v_committed
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_day) s
  join atlas.tasks t on t.id=s.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,p_day) as contract) deferral
  left join atlas.worker_day_task_placements placement
    on placement.farm_id=p_farm_id
   and placement.membership_id=p_membership_id
   and placement.task_id=t.id
   and placement.service_date=p_day
   and placement.state='placed'
  where s.presentation_state='presented';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','task:'||t.id::text,
    'kind','next_up',
    'sourceKind','task',
    'sourceId',t.id,
    'taskId',t.id,
    'title',t.title,
    'status',t.status,
    'expectedActiveMinutes',capacity.expected_active_minutes,
    'dayWindow',atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata),
    'workOrderNumber',atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata),
    'location',coalesce(nullif(t.metadata->>'display_location',''),nullif(t.metadata->>'collection_zone',''),nullif(t.metadata->>'collection_label','')),
    'nextUpReason',s.presentation_reason,
    'deferredByCapacity',s.presentation_reason in ('next_up_capacity','next_up_recovery_capacity'),
    'executableNow',s.presentation_reason in ('next_up_capacity','next_up_recovery_capacity'),
    'workLane',s.work_lane,
    'commitmentKind',s.commitment_kind,
    'capacityDeferrable',coalesce((deferral.contract->>'capacityDeferrable')::boolean,false)
  ) order by s.lane_order,s.selection_rank,t.title,t.id),'[]'::jsonb)
  into v_next
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_day) s
  join atlas.tasks t on t.id=s.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
  cross join lateral (select atlas.task_worker_day_deferral_v1(t.id,p_day) as contract) deferral
  where s.presentation_state='held'
    and (t.due_date is null or t.due_date<=p_day)
    and s.presentation_reason in (
      'next_up_capacity',
      'next_up_recovery_capacity',
      'waiting_on_prerequisite',
      'waiting_on_resource',
      'temporal_not_ready',
      'outside_lawful_window',
      'awaiting_favored_sky_window'
    );

  v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);
  v_target:=coalesce(
    (atlas.clock_day_capacity_state_v2(p_farm_id,p_membership_id,p_day,v_committed+v_automatic,0)->>'paidTargetMinutes')::integer,
    coalesce((v_plan->>'paidTargetMinutes')::integer,0)
  );

  v_plan:=jsonb_set(v_plan,'{realWork}',v_real,true);
  v_plan:=jsonb_set(v_plan,'{nextUp}',v_next,true);
  v_plan:=jsonb_set(v_plan,'{committedPaidMinutes}',to_jsonb(v_committed),true);
  v_plan:=jsonb_set(v_plan,'{paidTargetMinutes}',to_jsonb(v_target),true);
  v_plan:=jsonb_set(v_plan,'{remainingPaidMinutes}',to_jsonb(greatest(v_target-v_committed-v_automatic,0)),true);
  v_plan:=jsonb_set(v_plan,'{selectionContractVersion}',to_jsonb('worker_day_selection_v1'::text),true);
  return v_plan;
end;
$$;

revoke all on function atlas.worker_day_selection_overlay_v1(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function atlas.worker_day_selection_overlay_v1(uuid,uuid,date,jsonb) to service_role;

-- Owner inspection uses the same operational Worker Day answer; this does not extend Principal prioritization.
create or replace function atlas.owner_worker_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role='owner'
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  return atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
end;
$$;

create or replace function atlas.owner_worker_day_plan_choreographed_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role='owner'
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  return atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
end;
$$;

create or replace function atlas.worker_self_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from atlas.farm_memberships membership
    where membership.id=p_membership_id
      and membership.farm_id=p_farm_id
      and membership.user_id=auth.uid()
      and membership.active=true
      and membership.role='farm_hand'
  ) then
    raise exception 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' using errcode='42501';
  end if;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v1'::text),true);
  return v_plan;
end;
$$;
