create or replace function atlas.worker_farm_admin_lane_v1(
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
  v_day_shape jsonb;
  v_day_known boolean:=false;
  v_day_class text;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='P0002';
  end if;

  v_day_shape:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);
  v_day_known:=coalesce((v_day_shape->>'capacityKnown')::boolean,false);
  v_day_class:=v_day_shape->>'capacityClass';

  with candidates as (
    select
      t.id as task_id,
      t.title,
      t.status,
      t.due_date,
      t.work_lane,
      t.commitment_kind,
      t.action_key,
      t.task_type,
      t.planned_occurrence_id,
      t.metadata,
      o.state as occurrence_state,
      o.planned_due_date,
      o.not_before_date,
      o.earliest_lawful_date,
      o.latest_lawful_date,
      o.hard_finish_date,
      atlas.task_clock_function_traits_v1(t.id,p_day) as traits,
      atlas.task_effective_delay_consequence_v1(t.id,p_day) as consequence,
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
    from candidates c
    where (c.traits->'traitKeys') ? 'farm_admin_call'
      and c.prerequisites_ready
      and c.resources_ready
      and (c.planned_occurrence_id is null or c.occurrence_state='released')
      and (c.not_before_date is null or c.not_before_date<=p_day)
      and (c.earliest_lawful_date is null or c.earliest_lawful_date<=p_day)
      and (c.latest_lawful_date is null or c.latest_lawful_date>=p_day)
      and (c.hard_finish_date is null or c.hard_finish_date>=p_day)
      and (
        nullif(c.metadata->>'phone_call_not_before','') is null
        or case
          when (c.metadata->>'phone_call_not_before') ~ '^\d{4}-\d{2}-\d{2}$'
            then (c.metadata->>'phone_call_not_before')::date<=p_day
          else true
        end
      )
      and lower(coalesce(c.metadata->>'outreach_release_state','released')) not in ('queued','held','waiting')
      and lower(coalesce(c.metadata->>'reservoirDecisionState',''))<>'owner_review'
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',r.task_id,
      'title',r.title,
      'dueDate',r.due_date,
      'workLane',r.work_lane,
      'commitmentKind',r.commitment_kind,
      'actionKey',r.action_key,
      'taskType',r.task_type,
      'expectedActiveMinutes',(r.capacity).expected_active_minutes,
      'physicalLoad',(r.capacity).physical_load,
      'effectiveObligationClass',(r.capacity).effective_obligation_class,
      'consequenceTier',case when coalesce(r.consequence->>'effectiveTier','') ~ '^[1-6]$' then (r.consequence->>'effectiveTier')::integer else null end,
      'consequenceClass',r.consequence->>'effectiveClass',
      'dayWindow',r.traits->>'dayWindow',
      'interruptibility',r.traits->>'interruptibility',
      'fragmentation',r.traits->>'fragmentation',
      'preferredCallWindow',nullif(r.metadata->>'preferred_call_window',''),
      'phoneCallNotBefore',nullif(r.metadata->>'phone_call_not_before',''),
      'executionDo',nullif(r.metadata->>'execution_do',''),
      'executionDoneWhen',nullif(r.metadata->>'execution_done_when',''),
      'resultStorage',nullif(r.metadata->>'result_storage',''),
      'outreachQueueKey',nullif(r.metadata->>'outreach_queue_key',''),
      'plannedOccurrenceId',r.planned_occurrence_id,
      'occurrenceTargetDate',r.planned_due_date
    )) order by
      case when coalesce(r.consequence->>'effectiveTier','') ~ '^[1-6]$' then (r.consequence->>'effectiveTier')::integer else 99 end,
      r.due_date nulls last,
      r.planned_due_date nulls last,
      r.title,
      r.task_id),'[]'::jsonb),
    count(*)::integer,
    coalesce(sum((r.capacity).expected_active_minutes),0)::integer
  into v_items,v_count,v_minutes
  from ready r;

  return jsonb_build_object(
    'contractVersion','worker_farm_admin_lane_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'state',case when v_count>0 then 'ready' else 'collapsed' end,
    'candidateCount',v_count,
    'estimatedMinutes',v_minutes,
    'workerDayCapacityKnown',v_day_known,
    'workerDayCapacityClass',v_day_class,
    'laneDoesNotCreateCapacity',true,
    'items',v_items
  );
end;
$$;

revoke all on function atlas.worker_farm_admin_lane_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_farm_admin_lane_v1(uuid,uuid,date) to service_role;