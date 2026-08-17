create or replace function atlas.worker_weekly_farm_contract_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_anchor date:=coalesce(p_anchor_day,(now() at time zone 'America/Chicago')::date);
  v_week_start date;
  v_week_end date;
  v_calendar_capacity integer;
  v_capacity_known boolean:=false;
  v_required_minutes integer:=0;
  v_required_count integer:=0;
  v_optional_minutes integer:=0;
  v_optional_count integer:=0;
  v_required_unestimated_count integer:=0;
  v_required jsonb:='[]'::jsonb;
  v_optional jsonb:='[]'::jsonb;
  v_all jsonb:='[]'::jsonb;
  v_capacity_shortfall integer;
  v_repeated_required_count integer:=0;
  v_counted_total_count integer:=0;
  v_open_top_level_count integer:=0;
  v_items_without_occurrence integer:=0;
  v_unbounded_item_count integer:=0;
begin
  if p_farm_id is null or p_membership_id is null then
    raise exception 'Farm and Farm Hand membership are required.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='P0002';
  end if;

  v_week_start:=v_anchor-(extract(isodow from v_anchor)::integer-1);
  v_week_end:=v_week_start+6;

  select
    sum(case when coalesce((c->>'capacityKnown')::boolean,false) then coalesce((c->>'maximumPlannedMinutes')::integer,0) else 0 end)::integer,
    bool_and(coalesce((c->>'capacityKnown')::boolean,false))
  into v_calendar_capacity,v_capacity_known
  from (
    select atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,d::date) c
    from generate_series(v_week_start,v_week_end,interval '1 day') d
  ) capacity_days;

  with candidate_base as (
    select
      t.id as task_id,
      t.title,
      t.status,
      t.due_date,
      t.work_lane,
      t.commitment_kind,
      t.priority,
      t.action_key,
      t.task_type,
      t.visibility_scope,
      t.metadata,
      t.planned_occurrence_id,
      o.state as occurrence_state,
      o.source_kind,
      o.source_key,
      o.occurrence_key,
      o.planned_due_date,
      o.not_before_date,
      o.earliest_lawful_date,
      o.preferred_start_date,
      o.preferred_end_date,
      o.latest_lawful_date,
      o.hard_finish_date,
      o.miss_consequence,
      atlas.task_capacity_plan_v1(t,v_week_start) as capacity,
      (
        coalesce(t.commitment_kind,'')='hard_date'
        or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
        or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
        or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
      ) as hard_date_contract
    from atlas.tasks t
    left join atlas.planned_work_occurrences o on o.id=t.planned_occurrence_id
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status in ('open','blocked')
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1')
  ), classified as (
    select c.*,
      case
        when c.due_date between v_week_start and v_week_end then true
        when c.hard_finish_date between v_week_start and v_week_end then true
        when c.latest_lawful_date between v_week_start and v_week_end then true
        when c.preferred_start_date is not null and c.preferred_end_date is not null and daterange(c.preferred_start_date,c.preferred_end_date,'[]') && daterange(v_week_start,v_week_end,'[]') then true
        when c.work_lane='required' and c.due_date<=v_week_end then true
        when c.work_lane='process_continuation' and c.due_date<=v_week_end then true
        when c.work_lane='rhythm' and coalesce(c.due_date,v_week_start)<=v_week_end then true
        when c.commitment_kind='persistent' and coalesce(c.due_date,c.planned_due_date,v_week_start)<=v_week_end then true
        else false
      end as required_this_week,
      case
        when c.due_date is not null then c.due_date
        when c.hard_finish_date is not null then c.hard_finish_date
        when c.latest_lawful_date is not null then c.latest_lawful_date
        when c.planned_due_date is not null then c.planned_due_date
        else null
      end as contract_date,
      case
        when c.hard_date_contract and c.due_date is not null and c.due_date<v_week_start then true
        else false
      end as hard_date_past_target
    from candidate_base c
    where not (c.hard_date_contract and c.due_date is not null and c.due_date<v_week_start)
  ), decorated as (
    select c.*,
      coalesce((c.capacity).expected_active_minutes,0)::integer as expected_minutes,
      (c.capacity).physical_load,
      (c.capacity).effective_obligation_class
    from classified c
  ), packed as (
    select d.*,
      jsonb_strip_nulls(jsonb_build_object(
        'taskId',d.task_id,
        'title',d.title,
        'status',d.status,
        'dueDate',d.due_date,
        'workLane',d.work_lane,
        'commitmentKind',d.commitment_kind,
        'priority',d.priority,
        'actionKey',d.action_key,
        'taskType',d.task_type,
        'plannedOccurrenceId',d.planned_occurrence_id,
        'occurrenceState',d.occurrence_state,
        'occurrenceSourceKind',d.source_kind,
        'occurrenceSourceKey',d.source_key,
        'occurrenceKey',d.occurrence_key,
        'occurrenceTargetDate',d.planned_due_date,
        'releaseNotBeforeDate',d.not_before_date,
        'earliestLawfulDate',d.earliest_lawful_date,
        'preferredStartDate',d.preferred_start_date,
        'preferredEndDate',d.preferred_end_date,
        'latestLawfulDate',d.latest_lawful_date,
        'hardFinishDate',d.hard_finish_date,
        'missConsequence',d.miss_consequence,
        'contractDate',d.contract_date,
        'requiredThisWeek',d.required_this_week,
        'expectedActiveMinutes',d.expected_minutes,
        'physicalLoad',d.physical_load,
        'effectiveObligationClass',d.effective_obligation_class,
        'displayLocation',coalesce(nullif(d.metadata->>'display_location',''),nullif(d.metadata->>'collection_zone',''),nullif(d.metadata->>'collection_label','')),
        'workOrderAnchor',nullif(d.metadata->>'work_order_anchor',''),
        'operationalNote',nullif(d.metadata->>'operational_note','')
      )) as packet
    from decorated d
  )
  select
    coalesce(jsonb_agg(packet order by
      required_this_week desc,
      contract_date nulls last,
      case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      title,task_id),'[]'::jsonb),
    count(*)::integer,
    count(*) filter(where required_this_week)::integer,
    coalesce(sum(expected_minutes) filter(where required_this_week and expected_minutes>0),0)::integer,
    count(*) filter(where required_this_week and expected_minutes<=0)::integer,
    coalesce(jsonb_agg(packet order by contract_date nulls last,title,task_id) filter(where required_this_week),'[]'::jsonb),
    count(*) filter(where not required_this_week)::integer,
    coalesce(sum(expected_minutes) filter(where not required_this_week and expected_minutes>0),0)::integer,
    coalesce(jsonb_agg(packet order by contract_date nulls last,title,task_id) filter(where not required_this_week),'[]'::jsonb),
    count(*) filter(where planned_occurrence_id is null)::integer,
    count(*) filter(where planned_occurrence_id is null and due_date is null)::integer
  into
    v_all,v_counted_total_count,v_required_count,v_required_minutes,v_required_unestimated_count,v_required,
    v_optional_count,v_optional_minutes,v_optional,v_items_without_occurrence,v_unbounded_item_count
  from packed;

  select count(*)::integer
  into v_open_top_level_count
  from atlas.tasks t
  where t.farm_id=p_farm_id
    and t.assigned_membership_id=p_membership_id
    and t.task_scope='farm_operation'
    and t.status in ('open','blocked')
    and t.parent_task_id is null
    and nullif(t.metadata->>'parent_task_id','') is null
    and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1');

  select coalesce(sum(greatest(s.count_in_week-1,0)),0)::integer
  into v_repeated_required_count
  from (
    select
      coalesce(occurrence_key,source_kind||':'||source_key,task_id::text) as semantic_key,
      count(*)::integer as count_in_week
    from classified
    where required_this_week
      and coalesce(source_kind,'')<>'recurring_task'
    group by coalesce(occurrence_key,source_kind||':'||source_key,task_id::text)
    having count(*)>1
  ) s;

  if v_capacity_known and v_required_unestimated_count=0 then
    v_capacity_shortfall:=greatest(v_required_minutes-coalesce(v_calendar_capacity,0),0);
  end if;

  return jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'weekStart',v_week_start,
    'weekEnd',v_week_end,
    'capacityKnown',v_capacity_known,
    'plannedCapacityMinutes',case when v_capacity_known then v_calendar_capacity else null end,
    'requiredWorkCount',v_required_count,
    'requiredEstimatedMinutes',v_required_minutes,
    'requiredUnestimatedCount',v_required_unestimated_count,
    'requiredWork',v_required,
    'optionalWorkCount',v_optional_count,
    'optionalEstimatedMinutes',v_optional_minutes,
    'optionalWork',v_optional,
    'countedTopLevelWorkCount',v_counted_total_count,
    'openTopLevelTaskCount',v_open_top_level_count,
    'openItemsWithoutOccurrenceCount',v_items_without_occurrence,
    'openUnboundedItemCount',v_unbounded_item_count,
    'requiredDuplicateSemanticCount',v_repeated_required_count,
    'capacityFitsRequiredWork',case when v_capacity_known and v_required_unestimated_count=0 then v_required_minutes<=v_calendar_capacity else null end,
    'capacityShortfallMinutes',v_capacity_shortfall,
    'requiredClassificationReady',v_required_unestimated_count=0,
    'work',v_all
  );
end;
$$;

revoke all on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) to service_role;

-- Existing wrapper signatures remain the authenticated authority boundary.
revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;