create or replace function atlas.project_pull_options_for_member_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date default null::date,
  p_limit integer default null::integer
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $$
declare
  v_day date;
  v_today date;
  v_timezone text := 'America/Chicago';
  v_membership atlas.farm_memberships%rowtype;
  v_project atlas.projects%rowtype;
  v_settings atlas.member_capacity_settings%rowtype;
  v_regular_minutes integer := 0;
  v_heavy_minutes integer := 0;
  v_completed_minutes integer := 0;
  v_completed_heavy integer := 0;
  v_carry_minutes integer := 0;
  v_carry_heavy integer := 0;
  v_project_minutes integer := 0;
  v_project_heavy integer := 0;
  v_regular_target integer;
  v_heavy_cap integer;
  v_remaining integer;
  v_budget integer;
  v_limit integer;
  v_options jsonb := '[]'::jsonb;
begin
  select * into v_membership from atlas.farm_memberships where id=p_membership_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  select * into v_project from atlas.projects where id=p_project_id and status='active';
  if v_project.id is null or v_project.farm_id is distinct from v_membership.farm_id then
    raise exception 'Active project is not available to this membership.' using errcode='P0002';
  end if;

  if auth.uid() is not null and v_membership.user_id <> auth.uid() and not atlas.is_farm_owner(v_membership.farm_id) then
    raise exception 'Only the member or farm owner may view project pull options.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=v_membership.farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_day := coalesce(p_day,v_today);

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=v_membership.id and farm_id=v_membership.farm_id and active;
  v_regular_target := coalesce(v_settings.regular_target_minutes,case v_membership.role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_heavy_cap := coalesce(v_settings.heavy_minutes_soft_cap,case v_membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end);

  if v_day > v_today then
    select coalesce(sum(capacity.expected_active_minutes),0)::integer,
           coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
    into v_regular_minutes,v_heavy_minutes
    from atlas.tasks task
    cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
    where task.farm_id=v_membership.farm_id
      and task.assigned_membership_id=v_membership.id
      and task.status in ('open','blocked')
      and task.due_date=v_day
      and task.parent_task_id is null
      and task.metadata->>'parent_task_id' is null
      and coalesce((task.metadata->>'is_child_task')::boolean,false)=false
      and nullif(task.metadata->>'project_pull_item_id','') is null
      and capacity.expected_active_minutes>0;
  else
    select coalesce(sum(capacity.expected_active_minutes),0)::integer,
           coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
    into v_regular_minutes,v_heavy_minutes
    from atlas.presented_work_rows_v1(v_membership.farm_id,v_membership.id,v_day) presented
    join atlas.tasks task on task.id=presented.task_id
    cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
    where presented.presentation_state='presented'
      and nullif(task.metadata->>'project_pull_item_id','') is null
      and capacity.expected_active_minutes>0;

    select coalesce(sum(capacity.expected_active_minutes),0)::integer,
           coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
    into v_completed_minutes,v_completed_heavy
    from atlas.tasks task
    cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
    where task.farm_id=v_membership.farm_id
      and task.assigned_membership_id=v_membership.id
      and task.status='done'
      and task.completed_at is not null
      and (task.completed_at at time zone v_timezone)::date=v_day
      and task.parent_task_id is null
      and nullif(task.metadata->>'project_pull_item_id','') is null
      and capacity.expected_active_minutes>0;
    v_regular_minutes := v_regular_minutes + v_completed_minutes;
    v_heavy_minutes := v_heavy_minutes + v_completed_heavy;
  end if;

  select coalesce(sum(capacity.expected_active_minutes),0)::integer,
         coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
  into v_carry_minutes,v_carry_heavy
  from atlas.member_day_carryover_v1(v_membership.farm_id,v_membership.id,v_day) carry
  join atlas.tasks task on task.id=carry.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
  where nullif(task.metadata->>'project_pull_item_id','') is null
    and capacity.expected_active_minutes>0;

  v_regular_minutes := v_regular_minutes + v_carry_minutes;
  v_heavy_minutes := v_heavy_minutes + v_carry_heavy;

  select coalesce(sum(item.expected_active_minutes),0)::integer,
         coalesce(sum(item.expected_active_minutes) filter(where item.physical_load='heavy'),0)::integer
  into v_project_minutes,v_project_heavy
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  join atlas.tasks selected_task on selected_task.id=selection.task_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and (selection.state='completed' or (selection.state='selected' and selected_task.status='open'));

  v_regular_minutes := v_regular_minutes + v_project_minutes;
  v_heavy_minutes := v_heavy_minutes + v_project_heavy;
  v_remaining := greatest(v_regular_target-v_regular_minutes,0);
  v_budget := v_remaining;
  v_limit := least(greatest(coalesce(p_limit,nullif((v_project.metadata->>'daily_pull_choice_limit')::integer,0),24),1),24);

  select coalesce(jsonb_agg(row.payload order by row.fit_rank,row.priority_rank,row.expected_active_minutes,row.title),'[]'::jsonb)
  into v_options
  from (
    select item.title,item.expected_active_minutes,
      case when item.expected_active_minutes <= v_budget and not (item.physical_load='heavy' and v_heavy_minutes+item.expected_active_minutes>v_heavy_cap) then 0 else 1 end as fit_rank,
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end as priority_rank,
      jsonb_build_object(
        'projectItemId',item.id,'title',item.title,'note',item.note,
        'expectedActiveMinutes',item.expected_active_minutes,'physicalLoad',item.physical_load,
        'workClass',item.work_class,'environment',item.environment,'location',item.location_text,
        'priority',item.priority,
        'fitsToday',item.expected_active_minutes <= v_budget and not (item.physical_load='heavy' and v_heavy_minutes+item.expected_active_minutes>v_heavy_cap)
      ) as payload
    from atlas.project_pull_items item
    where item.project_id=p_project_id
      and item.farm_id=v_membership.farm_id
      and item.status='available'
      and (item.preferred_membership_id is null or item.preferred_membership_id=v_membership.id)
      and not exists (
        select 1 from atlas.project_pull_item_dependencies dependency
        join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
        where dependency.project_item_id=item.id and prerequisite.status <> dependency.required_status
      )
      and not exists (
        select 1 from atlas.project_pull_selections selection
        where selection.project_item_id=item.id and selection.state='selected'
      )
    order by fit_rank,priority_rank,item.expected_active_minutes,item.title
    limit v_limit
  ) row;

  return jsonb_build_object(
    'contractVersion','project_pull_options_v1','projectId',v_project.id,'projectTitle',v_project.title,
    'membershipId',v_membership.id,'serviceDate',v_day,
    'capacity',jsonb_build_object(
      'regularTargetMinutes',v_regular_target,'alreadyPresentedRegularMinutes',v_regular_minutes,
      'remainingRegularMinutes',v_remaining,'heavyMinutesSoftCap',v_heavy_cap,
      'alreadyPresentedHeavyMinutes',v_heavy_minutes,'projectPullBudgetMinutes',v_budget,
      'carriedRegularMinutes',v_carry_minutes,'carriedHeavyMinutes',v_carry_heavy
    ),'options',v_options
  );
end;
$$;

create or replace function atlas.owner_build_worker_day_schedule_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'pg_catalog', 'atlas'
as $$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target integer := 420;
  v_current_paid integer := 0;
  v_carried_paid integer := 0;
  v_approved_conditional integer := 0;
  v_selected_paid integer := 0;
  v_kind text;
  v_id uuid;
  v_minutes integer;
  v_selection jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_queue record;
  v_item atlas.project_pull_items%rowtype;
  v_task atlas.tasks%rowtype;
begin
  if p_day is null then raise exception 'A schedule date is required.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_selections,'[]'::jsonb)) <> 'array' then raise exception 'Selections must be an array.' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_selections,'[]'::jsonb)) > 40 then raise exception 'Too many schedule selections.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active;
  if v_membership.id is null then raise exception 'Active worker membership required.' using errcode='42501'; end if;
  if v_membership.role <> 'farm_hand' then raise exception 'Owner schedule approval currently applies to Farm Hand schedules.' using errcode='42501'; end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  if p_day < v_today then raise exception 'Past worker schedules cannot be built from the approval board.' using errcode='22023'; end if;

  select coalesce(settings.regular_target_minutes,420) into v_target
  from atlas.farm_memberships membership
  left join atlas.member_capacity_settings settings on settings.farm_id=membership.farm_id and settings.membership_id=membership.id and settings.active
  where membership.id=p_membership_id and membership.farm_id=p_farm_id;
  v_target := coalesce(v_target,420);

  select coalesce(sum(capacity.expected_active_minutes),0)::integer into v_current_paid
  from atlas.tasks task
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  where task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked') and task.due_date=p_day and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and coalesce((task.metadata->>'is_child_task')::boolean,false)=false
    and coalesce((task.metadata->>'personal_task')::boolean,false)=false
    and lower(coalesce(task.metadata->>'paid_work','true')) not in ('false','no','0')
    and capacity.expected_active_minutes > 0;

  select coalesce(sum(capacity.expected_active_minutes),0)::integer into v_carried_paid
  from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,p_day) carry
  join atlas.tasks task on task.id=carry.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  where coalesce((task.metadata->>'personal_task')::boolean,false)=false
    and lower(coalesce(task.metadata->>'paid_work','true')) not in ('false','no','0')
    and capacity.expected_active_minutes > 0;
  v_current_paid := v_current_paid + v_carried_paid;

  select coalesce(sum(coalesce(nullif(occurrence.task_payload->'metadata'->>'estimated_minutes','')::integer,
    case when coalesce(occurrence.effort_units,0)>0 then greatest(20,round(occurrence.effort_units*15)::integer) else 30 end)),0)::integer
  into v_approved_conditional
  from atlas.task_release_queue_items qi
  join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
  where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='queued'
    and occurrence.state not in ('cancelled','completed')
    and nullif(qi.metadata->>'owner_schedule_approved_date','')::date=p_day;
  v_current_paid := v_current_paid + v_approved_conditional;

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind := nullif(v_selection->>'sourceKind','');
    begin v_id := nullif(v_selection->>'sourceId','')::uuid;
    exception when invalid_text_representation then raise exception 'Every schedule selection needs a valid source id.' using errcode='22023'; end;
    if v_kind is null or v_id is null then raise exception 'Every schedule selection needs a source kind and source id.' using errcode='22023'; end if;

    if v_kind='project_pull' then
      select * into v_item from atlas.project_pull_items item
      where item.id=v_id and item.farm_id=p_farm_id and item.status='available'
        and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
        and not exists (
          select 1 from atlas.project_pull_item_dependencies dependency
          join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
          where dependency.project_item_id=item.id and prerequisite.status<>dependency.required_status
        );
      if v_item.id is null then raise exception 'A selected Finish Elm card is no longer available.' using errcode='55000'; end if;
      v_minutes := greatest(coalesce(v_item.expected_active_minutes,0),0);
    elsif v_kind='floating_task' then
      select task.* into v_task
      from atlas.tasks task join atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate on candidate.task_id=task.id
      where task.id=v_id;
      if v_task.id is null then raise exception 'A selected Atlas paid-work card is no longer eligible.' using errcode='55000'; end if;
      select candidate.expected_active_minutes into v_minutes from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate where candidate.task_id=v_id limit 1;
      v_minutes := greatest(coalesce(v_minutes,0),0);
    elsif v_kind='queue' then
      select qi.id as queue_item_id,qi.position,qi.state as queue_state,qi.planned_occurrence_id,
             occurrence.state as occurrence_state,occurrence.task_payload,occurrence.effort_units
      into v_queue
      from atlas.task_release_queue_items qi
      join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
      where qi.id=v_id and qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation'
        and qi.state='queued' and occurrence.state not in ('cancelled','completed')
        and nullif(qi.metadata->>'owner_schedule_approved_date','') is null;
      if v_queue.queue_item_id is null then raise exception 'The selected Weed Card is no longer waiting for Owner approval.' using errcode='55000'; end if;
      v_minutes := coalesce(nullif(v_queue.task_payload->'metadata'->>'estimated_minutes','')::integer,
        case when coalesce(v_queue.effort_units,0) > 0 then greatest(20,round(v_queue.effort_units*15)::integer) else 30 end);
    else
      raise exception 'Unsupported schedule candidate kind: %',v_kind using errcode='22023';
    end if;
    v_selected_paid := v_selected_paid + greatest(coalesce(v_minutes,0),0);
  end loop;

  if v_current_paid + v_selected_paid > v_target then
    raise exception 'The selected schedule would total % minutes against a % minute paid-work target.',v_current_paid + v_selected_paid, v_target using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_schedule_builder',0));

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind := v_selection->>'sourceKind';
    v_id := (v_selection->>'sourceId')::uuid;
    if v_kind='project_pull' then
      v_result := atlas.pull_project_item_to_today_v1(v_id,p_membership_id,p_day,'Approved by Owner in the worker day schedule builder.');
      v_results := v_results || jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','scheduled','taskId',v_result->>'taskId'));
    elsif v_kind='floating_task' then
      update atlas.tasks task set due_date=p_day,
        metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object('owner_schedule_approved',true,'owner_schedule_approved_date',p_day,'owner_schedule_approved_at',now(),'owner_schedule_approval_source','worker_day_builder'),updated_at=now()
      where task.id=v_id and task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id and task.status='open' and task.due_date is null;
      if not found then raise exception 'An Atlas paid-work card changed before the schedule could be built.' using errcode='55000'; end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','scheduled','taskId',v_id));
    elsif v_kind='queue' then
      update atlas.task_release_queue_items qi set metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object(
        'owner_schedule_approval_required',true,'owner_schedule_approved_date',p_day,'owner_schedule_approved_at',now(),'owner_schedule_approval_source','worker_day_builder'),updated_at=now()
      where qi.id=v_id and qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='queued' and nullif(qi.metadata->>'owner_schedule_approved_date','') is null;
      if not found then raise exception 'The Weed Card changed before the schedule could be built.' using errcode='55000'; end if;
      update atlas.planned_work_occurrences occurrence set metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
        'owner_schedule_approved_date',p_day,'owner_schedule_approved_at',now(),'owner_schedule_approval_source','worker_day_builder'),updated_at=now()
      where occurrence.id=(select planned_occurrence_id from atlas.task_release_queue_items where id=v_id);
      v_results := v_results || jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','approved_conditional','taskId',null));
    end if;
  end loop;

  perform atlas.release_next_task_in_queue_v1(p_farm_id,'anna_weeding_rotation',v_today);
  perform atlas.refresh_owner_week_projection_v1(p_farm_id,p_membership_id,p_day,1);
  return jsonb_build_object(
    'contractVersion','owner_worker_day_schedule_builder_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'paidTargetMinutes',v_target,'alreadyCommittedPaidMinutes',v_current_paid,'carriedPaidMinutes',v_carried_paid,
    'approvedConditionalMinutes',v_approved_conditional,'newlyApprovedPaidMinutes',v_selected_paid,
    'projectedPaidMinutes',v_current_paid+v_selected_paid,'results',v_results
  );
end;
$$;
