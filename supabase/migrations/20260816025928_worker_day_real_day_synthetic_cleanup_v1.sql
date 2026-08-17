-- Pass 3D hardening — synthetic forecast slots may not double-count a real Worker Day.
-- Once the service date is today or earlier, released task truth owns execution.
-- Future planning may retain legacy synthetic Weed/Mow forecast slots until the later Clock-placement pass replaces them.

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
  v_timezone text:='America/Chicago';
  v_today date;
begin
  if coalesce((v_plan->>'availableWorkerDay')::boolean,true)=false then
    return jsonb_set(v_plan,'{nextUp}','[]'::jsonb,true);
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;
  v_today:=(now() at time zone coalesce(v_timezone,'America/Chicago'))::date;

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

  if p_day<=v_today then
    -- Released task truth owns a real day. Legacy synthetic forecasting must not add a second copy.
    v_automatic:=0;
    v_plan:=jsonb_set(v_plan,'{automaticWork}','[]'::jsonb,true);
    v_plan:=jsonb_set(v_plan,'{automaticPaidMinutes}',to_jsonb(0),true);
  else
    v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);
  end if;

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