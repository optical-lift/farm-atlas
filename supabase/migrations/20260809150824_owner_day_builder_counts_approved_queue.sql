create or replace function atlas.owner_build_worker_day_schedule_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target integer := 420;
  v_current_paid integer := 0;
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
  if p_day is null then
    raise exception 'A schedule date is required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_selections,'[]'::jsonb)) <> 'array' then
    raise exception 'Selections must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_selections,'[]'::jsonb)) > 40 then
    raise exception 'Too many schedule selections.' using errcode='22023';
  end if;

  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and farm_id=p_farm_id and active;
  if v_membership.id is null then
    raise exception 'Active worker membership required.' using errcode='42501';
  end if;
  if v_membership.role <> 'farm_hand' then
    raise exception 'Owner schedule approval currently applies to Farm Hand schedules.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  if p_day < v_today then
    raise exception 'Past worker schedules cannot be built from the approval board.' using errcode='22023';
  end if;

  select coalesce(settings.regular_target_minutes,420)
  into v_target
  from atlas.farm_memberships membership
  left join atlas.member_capacity_settings settings
    on settings.farm_id=membership.farm_id
   and settings.membership_id=membership.id
   and settings.active
  where membership.id=p_membership_id
    and membership.farm_id=p_farm_id;
  v_target := coalesce(v_target,420);

  select coalesce(sum(capacity.expected_active_minutes),0)::integer
  into v_current_paid
  from atlas.tasks task
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  where task.farm_id=p_farm_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and task.due_date=p_day
    and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and coalesce((task.metadata->>'is_child_task')::boolean,false)=false
    and coalesce((task.metadata->>'personal_task')::boolean,false)=false
    and lower(coalesce(task.metadata->>'paid_work','true')) not in ('false','no','0')
    and capacity.expected_active_minutes > 0;

  select coalesce(sum(
    coalesce(
      nullif(occurrence.task_payload->'metadata'->>'estimated_minutes','')::integer,
      case
        when coalesce(occurrence.effort_units,0)>0 then greatest(20,round(occurrence.effort_units*15)::integer)
        else 30
      end
    )
  ),0)::integer
  into v_approved_conditional
  from atlas.task_release_queue_items qi
  join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
  where qi.farm_id=p_farm_id
    and qi.queue_key='anna_weeding_rotation'
    and qi.state='queued'
    and occurrence.state not in ('cancelled','completed')
    and nullif(qi.metadata->>'owner_schedule_approved_date','')::date=p_day;

  v_current_paid := v_current_paid + v_approved_conditional;

  for v_selection in
    select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb))
  loop
    v_kind := nullif(v_selection->>'sourceKind','');
    begin
      v_id := nullif(v_selection->>'sourceId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Every schedule selection needs a valid source id.' using errcode='22023';
    end;
    if v_kind is null or v_id is null then
      raise exception 'Every schedule selection needs a source kind and source id.' using errcode='22023';
    end if;

    if v_kind='project_pull' then
      select * into v_item
      from atlas.project_pull_items item
      where item.id=v_id
        and item.farm_id=p_farm_id
        and item.status='available'
        and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
        and not exists (
          select 1
          from atlas.project_pull_item_dependencies dependency
          join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
          where dependency.project_item_id=item.id
            and prerequisite.status<>dependency.required_status
        );
      if v_item.id is null then
        raise exception 'A selected Finish Elm card is no longer available.' using errcode='55000';
      end if;
      v_minutes := greatest(coalesce(v_item.expected_active_minutes,0),0);

    elsif v_kind='floating_task' then
      select task.* into v_task
      from atlas.tasks task
      join atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate
        on candidate.task_id=task.id
      where task.id=v_id;
      if v_task.id is null then
        raise exception 'A selected Atlas paid-work card is no longer eligible.' using errcode='55000';
      end if;
      select candidate.expected_active_minutes into v_minutes
      from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate
      where candidate.task_id=v_id
      limit 1;
      v_minutes := greatest(coalesce(v_minutes,0),0);

    elsif v_kind='queue' then
      select qi.id as queue_item_id,
             qi.position,
             qi.state as queue_state,
             qi.planned_occurrence_id,
             occurrence.state as occurrence_state,
             occurrence.task_payload,
             occurrence.effort_units
      into v_queue
      from atlas.task_release_queue_items qi
      join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
      where qi.id=v_id
        and qi.farm_id=p_farm_id
        and qi.queue_key='anna_weeding_rotation'
        and qi.state='queued'
        and occurrence.state not in ('cancelled','completed')
        and nullif(qi.metadata->>'owner_schedule_approved_date','') is null;
      if v_queue.queue_item_id is null then
        raise exception 'The selected Weed Card is no longer waiting for Owner approval.' using errcode='55000';
      end if;
      v_minutes := coalesce(
        nullif(v_queue.task_payload->'metadata'->>'estimated_minutes','')::integer,
        case
          when coalesce(v_queue.effort_units,0) > 0 then greatest(20,round(v_queue.effort_units*15)::integer)
          else 30
        end
      );

    else
      raise exception 'Unsupported schedule candidate kind: %',v_kind using errcode='22023';
    end if;

    v_selected_paid := v_selected_paid + greatest(coalesce(v_minutes,0),0);
  end loop;

  if v_current_paid + v_selected_paid > v_target then
    raise exception 'The selected schedule would total % minutes against a % minute paid-work target.',
      v_current_paid + v_selected_paid, v_target using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_schedule_builder',0));

  for v_selection in
    select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb))
  loop
    v_kind := v_selection->>'sourceKind';
    v_id := (v_selection->>'sourceId')::uuid;

    if v_kind='project_pull' then
      v_result := atlas.pull_project_item_to_today_v1(
        v_id,
        p_membership_id,
        p_day,
        'Approved by Owner in the worker day schedule builder.'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'sourceKind',v_kind,
        'sourceId',v_id,
        'state','scheduled',
        'taskId',v_result->>'taskId'
      ));

    elsif v_kind='floating_task' then
      update atlas.tasks task
      set due_date=p_day,
          metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
            'owner_schedule_approved',true,
            'owner_schedule_approved_date',p_day,
            'owner_schedule_approved_at',now(),
            'owner_schedule_approval_source','worker_day_builder'
          ),
          updated_at=now()
      where task.id=v_id
        and task.farm_id=p_farm_id
        and task.assigned_membership_id=p_membership_id
        and task.status='open'
        and task.due_date is null;
      if not found then
        raise exception 'An Atlas paid-work card changed before the schedule could be built.' using errcode='55000';
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'sourceKind',v_kind,
        'sourceId',v_id,
        'state','scheduled',
        'taskId',v_id
      ));

    elsif v_kind='queue' then
      update atlas.task_release_queue_items qi
      set metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object(
            'owner_schedule_approval_required',true,
            'owner_schedule_approved_date',p_day,
            'owner_schedule_approved_at',now(),
            'owner_schedule_approval_source','worker_day_builder'
          ),
          updated_at=now()
      where qi.id=v_id
        and qi.farm_id=p_farm_id
        and qi.queue_key='anna_weeding_rotation'
        and qi.state='queued'
        and nullif(qi.metadata->>'owner_schedule_approved_date','') is null;
      if not found then
        raise exception 'The Weed Card changed before the schedule could be built.' using errcode='55000';
      end if;

      update atlas.planned_work_occurrences occurrence
      set metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
            'owner_schedule_approved_date',p_day,
            'owner_schedule_approved_at',now(),
            'owner_schedule_approval_source','worker_day_builder'
          ),
          updated_at=now()
      where occurrence.id=(
        select planned_occurrence_id
        from atlas.task_release_queue_items
        where id=v_id
      );

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'sourceKind',v_kind,
        'sourceId',v_id,
        'state','approved_conditional',
        'taskId',null
      ));
    end if;
  end loop;

  perform atlas.release_next_task_in_queue_v1(p_farm_id,'anna_weeding_rotation',v_today);
  perform atlas.refresh_owner_week_projection_v1(p_farm_id,p_membership_id,p_day,1);

  return jsonb_build_object(
    'contractVersion','owner_worker_day_schedule_builder_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'paidTargetMinutes',v_target,
    'alreadyCommittedPaidMinutes',v_current_paid,
    'approvedConditionalMinutes',v_approved_conditional,
    'newlyApprovedPaidMinutes',v_selected_paid,
    'projectedPaidMinutes',v_current_paid+v_selected_paid,
    'results',v_results
  );
end;
$function$;

revoke all on function atlas.owner_build_worker_day_schedule_v1(uuid,uuid,date,jsonb) from public, anon, authenticated;
grant execute on function atlas.owner_build_worker_day_schedule_v1(uuid,uuid,date,jsonb) to service_role;
