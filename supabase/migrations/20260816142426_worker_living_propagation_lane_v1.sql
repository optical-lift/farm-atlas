create or replace function atlas.worker_living_propagation_lane_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_items jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_minutes integer:=0;
  v_unestimated integer:=0;
  v_active_grow_room_cycles integer:=0;
  v_cycle_states jsonb:='{}'::jsonb;
  v_active_tray_batches integer:=0;
  v_completed_round_id uuid;
  v_completed_round_request_count integer;
  v_open_round_id uuid;
  v_open_round_due date;
  v_day_shape jsonb;
  v_state text;
begin
  if p_day is null then raise exception 'A service date is required.' using errcode='22023'; end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then raise exception 'Active Farm Hand membership required.' using errcode='P0002'; end if;

  v_day_shape:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);

  select count(*)::integer
  into v_active_grow_room_cycles
  from atlas.crop_cycles cc
  join atlas.growing_objects go on go.id=cc.object_id
  join atlas.zones z on z.id=go.zone_id
  where cc.farm_id=p_farm_id and cc.lifecycle_status='active' and z.stable_key='grow_room';

  select coalesce(jsonb_object_agg(state_name,state_count),'{}'::jsonb)
  into v_cycle_states
  from (
    select coalesce(nullif(cc.cycle_state,''),'unknown') as state_name,count(*)::integer as state_count
    from atlas.crop_cycles cc
    join atlas.growing_objects go on go.id=cc.object_id
    join atlas.zones z on z.id=go.zone_id
    where cc.farm_id=p_farm_id and cc.lifecycle_status='active' and z.stable_key='grow_room'
    group by 1
  ) states;

  select count(*)::integer into v_active_tray_batches
  from atlas.production_tray_batches b
  where b.farm_id=p_farm_id and b.status not in ('closed','transplanted');

  select t.id,t.due_date into v_open_round_id,v_open_round_due
  from atlas.tasks t
  where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id
    and t.status in ('open','blocked') and t.task_type='grow_room_care'
    and lower(t.title) in ('grow room care','water + check grow room','check grow room')
    and coalesce(t.due_date,p_day)<=p_day
  order by t.due_date desc nulls last,t.created_at desc
  limit 1;

  select t.id,
         (select count(*)::integer from atlas.grow_room_round_requests rr where rr.visit_task_id=t.id)
  into v_completed_round_id,v_completed_round_request_count
  from atlas.tasks t
  where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id
    and t.status='done' and t.task_type='grow_room_care'
    and lower(t.title) in ('grow room care','water + check grow room','check grow room')
    and t.due_date=p_day
  order by t.completed_at desc nulls last,t.created_at desc
  limit 1;

  with candidate_base as (
    select
      t.id as task_id,t.title,t.status,t.due_date,t.work_lane,t.commitment_kind,t.action_key,t.task_type,t.metadata,t.planned_occurrence_id,
      o.state as occurrence_state,o.source_kind,o.planned_due_date,o.not_before_date,o.earliest_lawful_date,o.latest_lawful_date,o.hard_finish_date,
      atlas.task_clock_function_traits_v1(t.id,p_day) as traits,
      atlas.task_effective_delay_consequence_v1(t.id,p_day) as consequence,
      atlas.task_protected_farm_minimum_v1(t.id,p_day) as protected_minimum,
      atlas.task_capacity_plan_v1(t,p_day) as capacity,
      atlas.task_prerequisites_ready_v1(t.id) as prerequisites_ready,
      atlas.task_required_resources_available_v1(t.id) as resources_ready
    from atlas.tasks t
    left join atlas.planned_work_occurrences o on o.id=t.planned_occurrence_id
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status='open'
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'personal_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'paid_work','true')) not in ('false','no','0')
      and coalesce(t.visibility_scope,'')<>'system_internal'
  ), ready as (
    select c.*
    from candidate_base c
    where (c.traits->'traitKeys') ? 'propagation'
      and c.prerequisites_ready and c.resources_ready
      and (c.planned_occurrence_id is null or c.occurrence_state='released')
      and (c.not_before_date is null or c.not_before_date<=p_day)
      and (c.earliest_lawful_date is null or c.earliest_lawful_date<=p_day)
      and (c.latest_lawful_date is null or c.latest_lawful_date>=p_day)
      and (c.hard_finish_date is null or c.hard_finish_date>=p_day)
      and coalesce(c.due_date,c.planned_due_date,p_day)<=p_day
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',r.task_id,'title',r.title,'dueDate',r.due_date,'workLane',r.work_lane,'commitmentKind',r.commitment_kind,
      'actionKey',r.action_key,'taskType',r.task_type,'environment',r.traits->>'environment','dayWindow',r.traits->>'dayWindow',
      'interruptibility',r.traits->>'interruptibility','fragmentation',r.traits->>'fragmentation',
      'expectedActiveMinutes',(r.capacity).expected_active_minutes,'physicalLoad',(r.capacity).physical_load,
      'consequenceTier',case when coalesce(r.consequence->>'effectiveTier','') ~ '^[1-6]$' then (r.consequence->>'effectiveTier')::integer else null end,
      'consequenceClass',r.consequence->>'effectiveClass',
      'protectedFarmMinimum',r.protected_minimum->'protectedFarmMinimum','protectedCategory',r.protected_minimum->>'category',
      'cropLabel',coalesce(nullif(r.metadata->>'crop_label',''),nullif(r.metadata->>'crop','')),
      'variety',nullif(r.metadata->>'variety',''),'cropCycleId',nullif(r.metadata->>'crop_cycle_id','')::uuid,
      'executionDo',nullif(r.metadata->>'execution_do',''),'executionDoneWhen',nullif(r.metadata->>'execution_done_when',''),
      'plannedOccurrenceId',r.planned_occurrence_id,'occurrenceSourceKind',r.source_kind,'occurrenceTargetDate',r.planned_due_date
    )) order by
      case when (r.protected_minimum->>'protectedFarmMinimum')::boolean then 0 else 1 end,
      case when coalesce(r.consequence->>'effectiveTier','') ~ '^[1-6]$' then (r.consequence->>'effectiveTier')::integer else 99 end,
      r.due_date nulls last,r.title,r.task_id),'[]'::jsonb),
    count(*)::integer,
    coalesce(sum((r.capacity).expected_active_minutes) filter(where (r.capacity).expected_active_minutes>0),0)::integer,
    count(*) filter(where (r.capacity).expected_active_minutes<=0)::integer
  into v_items,v_count,v_minutes,v_unestimated
  from ready r;

  v_state:=case
    when v_count>0 then 'intervention_required'
    when v_completed_round_id is not null and coalesce(v_completed_round_request_count,0)=0 then 'inspected_no_additional_intervention'
    when v_active_grow_room_cycles>0 or v_active_tray_batches>0 then 'inspection_required_for_closure'
    else 'no_living_propagation_inventory'
  end;

  return jsonb_build_object(
    'contractVersion','worker_living_propagation_lane_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,'state',v_state,
    'interventionCount',v_count,'estimatedInterventionMinutes',v_minutes,'unestimatedInterventionCount',v_unestimated,
    'items',v_items,
    'activeGrowRoomCycleCount',v_active_grow_room_cycles,'activeGrowRoomCycleStates',v_cycle_states,
    'activeProductionTrayBatchCount',v_active_tray_batches,
    'openGrowRoomRoundTaskId',v_open_round_id,'openGrowRoomRoundDueDate',v_open_round_due,
    'completedGrowRoomRoundTaskId',v_completed_round_id,'completedGrowRoomRoundRequestCount',v_completed_round_request_count,
    'workerDayCapacityKnown',coalesce((v_day_shape->>'capacityKnown')::boolean,false),
    'laneDoesNotCreateCapacity',true,
    'noInterventionRequiresInspectionClosure',true
  );
end;
$$;

revoke all on function atlas.worker_living_propagation_lane_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_living_propagation_lane_v1(uuid,uuid,date) to service_role;