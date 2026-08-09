create or replace function atlas.pull_project_item_to_today_owner_override_v1(
  p_project_item_id uuid,
  p_membership_id uuid,
  p_day date,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_day date:=coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_item atlas.project_pull_items%rowtype;
  v_project atlas.projects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_source atlas.tasks%rowtype;
  v_task_id uuid;
  v_effort numeric;
  v_capacity jsonb;
  v_regular_target integer:=0;
  v_remaining_regular integer:=0;
  v_plan_order integer:=null;
begin
  select * into v_item from atlas.project_pull_items where id=p_project_item_id for update;
  if v_item.id is null then raise exception 'Project item not found.' using errcode='P0002'; end if;
  if v_item.status<>'available' then raise exception 'Project item is not available.' using errcode='55000'; end if;

  select * into v_project from atlas.projects where id=v_item.project_id and status='active';
  if v_project.id is null then raise exception 'Project is not active.' using errcode='55000'; end if;

  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_item.farm_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_item.preferred_membership_id is not null and v_item.preferred_membership_id<>v_membership.id then
    raise exception 'Project item is assigned to a different member.' using errcode='42501';
  end if;
  if auth.uid() is not null and v_membership.user_id<>auth.uid() and not atlas.is_farm_owner(v_item.farm_id) then
    raise exception 'Only the member or farm owner may pull this work.' using errcode='42501';
  end if;

  if exists (
    select 1 from atlas.project_pull_item_dependencies dependency
    join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
    where dependency.project_item_id=v_item.id and prerequisite.status<>dependency.required_status
  ) then
    raise exception 'Project item still has an unfinished prerequisite.' using errcode='55000';
  end if;

  v_capacity:=atlas.project_pull_options_for_member_v1(v_project.id,v_membership.id,v_day,24)->'capacity';
  v_regular_target:=coalesce((v_capacity->>'regularTargetMinutes')::integer,0);
  v_remaining_regular:=coalesce((v_capacity->>'remainingRegularMinutes')::integer,0);

  select projection.plan_order into v_plan_order
  from atlas.owner_week_projection projection
  where projection.farm_id=v_item.farm_id
    and projection.membership_id=v_membership.id
    and projection.planned_date=v_day
    and projection.source_kind='project_pull'
    and projection.source_id=v_item.id
  order by projection.locked desc,projection.updated_at desc
  limit 1;

  if v_item.source_task_id is not null then select * into v_source from atlas.tasks where id=v_item.source_task_id; end if;
  v_effort:=coalesce(v_source.effort_units,case when v_item.expected_active_minutes<=30 then 0.5 when v_item.expected_active_minutes>120 then 2 else 1 end);

  insert into atlas.tasks (
    farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,unlock_text,blocker_text,
    generated_from,generated_from_id,note,metadata,action_key,work_class,parent_task_id,visibility_scope,
    assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,task_scope,work_lane,commitment_kind,effort_units
  ) values (
    v_item.farm_id,v_item.organization_id,v_source.zone_id,v_item.title,coalesce(v_source.task_type,'project_pull'),'open',
    coalesce(v_item.priority,v_source.priority,'normal'),v_day,v_source.unlock_text,null,
    'project_pull_item',v_item.id,coalesce(v_item.note,v_source.note),
    coalesce(v_source.metadata,'{}'::jsonb)||jsonb_build_object(
      'project_pull_item_id',v_item.id,'project_id',v_item.project_id,'project_pull_service_date',v_day,
      'project_pull_source_task_id',v_item.source_task_id,'project_pull_plan_order',v_plan_order,
      'paid_day_contract','full_paid_day_v2','serial_project_serving',true,
      'owner_capacity_override',true,'owner_capacity_override_date',v_day,
      'owner_capacity_override_at',now(),'owner_capacity_override_source','worker_day_builder_v2'
    ),
    v_source.action_key,coalesce(v_item.work_class,v_source.work_class,'standard'),null,
    coalesce(v_source.visibility_scope,'assigned_worker'),v_membership.id,v_membership.user_id,auth.uid(),
    'generated','farm_operation','discretionary','floating',v_effort
  ) returning id into v_task_id;

  insert into atlas.task_objects(task_id,object_id,role)
  select v_task_id,object_id,role from atlas.task_objects where task_id=v_item.source_task_id on conflict do nothing;

  insert into atlas.task_capacity_profiles(
    task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,
    estimate_source,estimate_confidence,recovery_origin_due_date,owner_locked,owner_note,metadata
  ) values (
    v_task_id,v_item.farm_id,v_item.expected_active_minutes,v_item.physical_load,'optional_improvement',null,
    'project_pull_item','owner_confirmed',null,true,'Pulled from Finish Elm by explicit Owner schedule approval.',
    jsonb_build_object('project_pull_item_id',v_item.id,'full_paid_day_v2',true,'owner_capacity_override',true)
  ) on conflict (task_id) do nothing;

  insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata)
  values (v_item.project_id,v_task_id,'daily_pull',coalesce(v_plan_order,1000),'project_pull',jsonb_build_object('project_pull_item_id',v_item.id,'owner_capacity_override',true))
  on conflict do nothing;

  insert into atlas.project_pull_selections(project_item_id,project_id,farm_id,membership_id,service_date,task_id,state,note,metadata)
  values (v_item.id,v_item.project_id,v_item.farm_id,v_membership.id,v_day,v_task_id,'selected',p_note,
    jsonb_build_object('plan_order',v_plan_order,'paid_day_contract','full_paid_day_v2','owner_capacity_override',true));

  update atlas.project_pull_items set status='selected',active_task_id=v_task_id,updated_at=now() where id=v_item.id;

  return jsonb_build_object(
    'contractVersion','project_pull_selection_owner_override_v1','projectItemId',v_item.id,'taskId',v_task_id,
    'serviceDate',v_day,'state','selected','planOrder',v_plan_order,'dailyPullMaxItems',24,'dailyPullMinutes',v_regular_target,
    'remainingPaidMinutesBeforeSelection',greatest(v_remaining_regular,0),'ownerCapacityOverride',true
  );
end;
$$;

revoke all on function atlas.pull_project_item_to_today_owner_override_v1(uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function atlas.pull_project_item_to_today_owner_override_v1(uuid,uuid,date,text) to service_role;

create or replace function atlas.owner_build_worker_day_schedule_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_plan jsonb;
  v_target integer:=420;
  v_current integer:=0;
  v_automatic integer:=0;
  v_selected integer:=0;
  v_kind text;
  v_id uuid;
  v_minutes integer;
  v_selection jsonb;
  v_results jsonb:='[]'::jsonb;
  v_result jsonb;
  v_item atlas.project_pull_items%rowtype;
  v_task atlas.tasks%rowtype;
begin
  if p_day is null then raise exception 'A schedule date is required.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_selections,'[]'::jsonb))<>'array' then raise exception 'Selections must be an array.' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_selections,'[]'::jsonb))>40 then raise exception 'Too many schedule selections.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active=true;
  if v_membership.id is null or v_membership.role<>'farm_hand' then raise exception 'Active Farm Hand membership required.' using errcode='42501'; end if;

  v_plan:=atlas.owner_worker_day_plan_v1(p_farm_id,p_membership_id,p_day);
  v_target:=coalesce((v_plan->>'paidTargetMinutes')::integer,420);
  v_current:=coalesce((v_plan->>'committedPaidMinutes')::integer,0);
  v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind:=nullif(v_selection->>'sourceKind','');
    begin v_id:=nullif(v_selection->>'sourceId','')::uuid;
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
      v_minutes:=greatest(coalesce(v_item.expected_active_minutes,0),0);
    elsif v_kind='floating_task' then
      select task.* into v_task from atlas.tasks task
      join atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate on candidate.task_id=task.id
      where task.id=v_id;
      if v_task.id is null then raise exception 'A selected Atlas paid-work card is no longer eligible.' using errcode='55000'; end if;
      select candidate.expected_active_minutes into v_minutes from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate where candidate.task_id=v_id limit 1;
      v_minutes:=greatest(coalesce(v_minutes,0),0);
    else
      raise exception 'Only Owner-choice Finish Elm or floating work may be committed from this board.' using errcode='22023';
    end if;
    v_selected:=v_selected+v_minutes;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_schedule_builder_v2',0));

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind:=v_selection->>'sourceKind';
    v_id:=(v_selection->>'sourceId')::uuid;
    if v_kind='project_pull' then
      if v_current+v_automatic+v_selected>v_target then
        v_result:=atlas.pull_project_item_to_today_owner_override_v1(v_id,p_membership_id,p_day,'Approved by Owner in the worker day schedule builder beyond the normal capacity target.');
      else
        v_result:=atlas.pull_project_item_to_today_v1(v_id,p_membership_id,p_day,'Approved by Owner in the worker day schedule builder.');
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','scheduled','taskId',v_result->>'taskId'));
    elsif v_kind='floating_task' then
      update atlas.tasks task set due_date=p_day,
        metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
          'owner_schedule_approved',true,'owner_schedule_approved_date',p_day,'owner_schedule_approved_at',now(),
          'owner_schedule_approval_source','worker_day_builder_v2','owner_capacity_override',(v_current+v_automatic+v_selected>v_target),
          'owner_capacity_override_date',case when v_current+v_automatic+v_selected>v_target then p_day else null end
        ),updated_at=now()
      where task.id=v_id and task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id and task.status='open' and task.due_date is null;
      if not found then raise exception 'An Atlas paid-work card changed before the schedule could be built.' using errcode='55000'; end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','scheduled','taskId',v_id));
    end if;
  end loop;

  perform atlas.refresh_owner_week_projection_v1(p_farm_id,p_membership_id,p_day,1);
  return jsonb_build_object(
    'contractVersion','owner_worker_day_schedule_builder_v2','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'paidTargetMinutes',v_target,'alreadyCommittedPaidMinutes',v_current,'automaticPaidMinutes',v_automatic,
    'newlyApprovedPaidMinutes',v_selected,'projectedPaidMinutes',v_current+v_automatic+v_selected,
    'overTargetMinutes',greatest(v_current+v_automatic+v_selected-v_target,0),'results',v_results
  );
end;
$$;
