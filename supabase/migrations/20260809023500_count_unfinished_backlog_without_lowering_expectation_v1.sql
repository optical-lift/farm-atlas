create or replace function atlas.owner_capacity_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_role text;
  v_member_role text;
  v_worker_key text;
  v_settings atlas.member_capacity_settings%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_regular_minutes integer:=0;
  v_recovery_minutes integer:=0;
  v_heavy_minutes integer:=0;
  v_presented_count integer:=0;
  v_held_count integer:=0;
  v_backlog_minutes integer:=0;
  v_backlog_count integer:=0;
  v_rescheduled_backlog_minutes integer:=0;
  v_rescheduled_backlog_count integer:=0;
  v_held_paid_minutes integer:=0;
  v_due_today_paid_minutes integer:=0;
  v_open_obligation_minutes integer:=0;
  v_regular_target integer:=0;
  v_maximum_planned integer:=0;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  if v_role<>'owner' then raise exception 'Owner farm membership required.' using errcode='42501'; end if;

  select membership.role,membership.worker_key into v_member_role,v_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active;
  if v_member_role is null then raise exception 'Target membership is not active on this farm.' using errcode='P0002'; end if;

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=p_membership_id and farm_id=p_farm_id and active;

  v_regular_target:=coalesce(v_settings.regular_target_minutes,case v_member_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_maximum_planned:=coalesce(v_settings.maximum_planned_minutes,case v_member_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end);

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',task.id,'title',task.title,'dueDate',task.due_date,
      'presentationState',presented.presentation_state,'presentationReason',presented.presentation_reason,
      'expectedActiveMinutes',capacity.expected_active_minutes,'physicalLoad',capacity.physical_load,
      'baseObligationClass',capacity.base_obligation_class,'effectiveObligationClass',capacity.effective_obligation_class,
      'microRoundKey',capacity.micro_round_key,'estimateSource',capacity.estimate_source,
      'estimateConfidence',capacity.estimate_confidence,'recoveryOriginDueDate',capacity.recovery_origin_due_date,
      'countsTowardDay',accounting.counts_toward_paid_day,'capacityTreatment',accounting.capacity_treatment,
      'workerRescheduled',accounting.worker_rescheduled
    ) order by presented.lane_order,presented.selection_rank),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.effective_obligation_class<>'recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.effective_obligation_class='recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.physical_load='heavy'),0)::integer,
    count(*) filter(where presented.presentation_state='presented')::integer,
    count(*) filter(where presented.presentation_state='held')::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date),0)::integer,
    count(*) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date and accounting.worker_rescheduled),0)::integer,
    count(*) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date and accounting.worker_rescheduled)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='held' and accounting.counts_toward_paid_day and (task.due_date is null or task.due_date<=v_work_date)),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date=v_work_date),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and (task.due_date is null or task.due_date<=v_work_date)),0)::integer
  into
    v_items,v_regular_minutes,v_recovery_minutes,v_heavy_minutes,v_presented_count,v_held_count,
    v_backlog_minutes,v_backlog_count,v_rescheduled_backlog_minutes,v_rescheduled_backlog_count,
    v_held_paid_minutes,v_due_today_paid_minutes,v_open_obligation_minutes
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_work_date) capacity
  cross join lateral (
    select
      atlas.task_rescheduled_by_membership_v1(task.id,p_membership_id,v_worker_key) as worker_rescheduled,
      case
        when coalesce((task.metadata->>'personal_task')::boolean,false) then false
        when lower(coalesce(task.metadata->>'paid_work','true')) in ('false','no','0') then false
        when capacity.micro_round_key='grow_room_observation' then false
        when capacity.expected_active_minutes<=0 then false
        else true end as counts_toward_paid_day,
      case
        when coalesce((task.metadata->>'personal_task')::boolean,false) or lower(coalesce(task.metadata->>'paid_work','true')) in ('false','no','0') then 'personal_noncounting'
        when capacity.micro_round_key='grow_room_observation' then 'micro_observation_noncounting'
        when capacity.expected_active_minutes<=0 then 'zero_active_minutes'
        when task.due_date<v_work_date then 'overdue_backlog_counted'
        else 'counted' end as capacity_treatment
  ) accounting;

  return jsonb_build_object(
    'contractVersion','owner_capacity_plan_v2',
    'farmId',p_farm_id,'membershipId',p_membership_id,'workDate',v_work_date,
    'member',jsonb_build_object('role',v_member_role,'workerKey',v_worker_key),
    'settings',jsonb_build_object(
      'regularTargetMinutes',v_regular_target,
      'recoveryTargetMinutes',coalesce(v_settings.recovery_target_minutes,case v_member_role when 'farm_hand' then 90 when 'manager' then 60 else 0 end),
      'maximumPlannedMinutes',v_maximum_planned,
      'heavyMinutesSoftCap',coalesce(v_settings.heavy_minutes_soft_cap,case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end),
      'undercompletionLowersFutureTarget',false
    ),
    'summary',jsonb_build_object(
      'selectedRegularMinutes',v_regular_minutes,
      'selectedRecoveryMinutes',v_recovery_minutes,
      'selectedTotalMinutes',v_regular_minutes+v_recovery_minutes,
      'selectedHeavyMinutes',v_heavy_minutes,
      'backlogPaidMinutes',v_backlog_minutes,
      'backlogCount',v_backlog_count,
      'workerRescheduledBacklogMinutes',v_rescheduled_backlog_minutes,
      'workerRescheduledBacklogCount',v_rescheduled_backlog_count,
      'heldPaidMinutes',v_held_paid_minutes,
      'scheduledTodayPaidMinutes',v_due_today_paid_minutes,
      'openPaidObligationMinutes',v_open_obligation_minutes,
      'obligationBeyondPaidTargetMinutes',greatest(v_open_obligation_minutes-v_regular_target,0),
      'obligationBeyondMaximumPlannedMinutes',greatest(v_open_obligation_minutes-v_maximum_planned,0),
      'noncountingOverdueMinutes',0,
      'noncountingOverdueCount',0,
      'presentedCount',v_presented_count,
      'heldCount',v_held_count
    ),
    'rules',jsonb_build_object(
      'personalWorkCountsTowardPaidDay',false,
      'microObservationCountsTowardPaidDay',false,
      'workerRescheduleErasesObligation',false,
      'workerUndercompletionLowersTomorrowTarget',false,
      'heldWorkStillExists',true
    ),
    'items',v_items
  );
end;
$function$;
