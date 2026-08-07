-- Project pull guardrails v1.
-- Keep all changes inside atlas.* because Atlas and Noel share this Supabase project.

insert into atlas.project_pull_item_dependencies(project_item_id, prerequisite_item_id, required_status)
select second.id, first.id, 'completed'
from atlas.project_pull_items first
join atlas.project_pull_items second on second.project_id = first.project_id
join atlas.projects project on project.id = first.project_id
where project.stable_key = 'elm_finish_renovation_pool'
  and first.title = 'Paint 2 Exterior House Doors Purple — First Coat'
  and second.title = 'Paint 2 Exterior House Doors Purple — Second Coat'
on conflict (project_item_id, prerequisite_item_id) do nothing;

create or replace function atlas.pull_project_item_to_today_v1(
  p_project_item_id uuid,
  p_membership_id uuid,
  p_day date default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_item atlas.project_pull_items%rowtype;
  v_project atlas.projects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_source atlas.tasks%rowtype;
  v_settings atlas.member_capacity_settings%rowtype;
  v_task_id uuid;
  v_effort numeric;
  v_daily_max_items integer;
  v_daily_pull_minutes integer;
  v_used_items integer := 0;
  v_used_minutes integer := 0;
  v_regular_target integer;
  v_presented_regular integer := 0;
  v_remaining_regular integer := 0;
  v_available_pull_minutes integer := 0;
begin
  select * into v_item
  from atlas.project_pull_items
  where id=p_project_item_id
  for update;
  if v_item.id is null then
    raise exception 'Project item not found.' using errcode='P0002';
  end if;
  if v_item.status <> 'available' then
    raise exception 'Project item is not available.' using errcode='55000';
  end if;

  select * into v_project
  from atlas.projects
  where id=v_item.project_id and status='active';
  if v_project.id is null then
    raise exception 'Project is not active.' using errcode='55000';
  end if;

  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_item.farm_id and active;
  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if v_item.preferred_membership_id is not null and v_item.preferred_membership_id <> v_membership.id then
    raise exception 'Project item is assigned to a different member.' using errcode='42501';
  end if;
  if auth.uid() is not null and v_membership.user_id <> auth.uid() and not atlas.is_farm_owner(v_item.farm_id) then
    raise exception 'Only the member or farm owner may pull this work.' using errcode='42501';
  end if;

  if exists (
    select 1
    from atlas.project_pull_item_dependencies dependency
    join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
    where dependency.project_item_id=v_item.id
      and prerequisite.status <> dependency.required_status
  ) then
    raise exception 'Project item still has an unfinished prerequisite.' using errcode='55000';
  end if;

  v_daily_max_items := greatest(coalesce(nullif((v_project.metadata->>'daily_pull_max_items')::integer,0),1),1);
  v_daily_pull_minutes := greatest(coalesce(nullif((v_project.metadata->>'daily_pull_minutes')::integer,0),90),1);

  select count(*)::integer,
         coalesce(sum(item.expected_active_minutes),0)::integer
  into v_used_items,v_used_minutes
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and selection.state in ('selected','completed');

  if v_used_items >= v_daily_max_items then
    raise exception 'Today''s project pull is already full.' using errcode='55000';
  end if;

  select * into v_settings
  from atlas.member_capacity_settings
  where membership_id=v_membership.id and farm_id=v_membership.farm_id and active;
  v_regular_target := coalesce(v_settings.regular_target_minutes,
    case v_membership.role when 'farm_hand' then 300 when 'manager' then 360 else 480 end);

  select coalesce(sum(capacity.expected_active_minutes) filter (
    where presented.presentation_state='presented'
      and capacity.effective_obligation_class <> 'recovery_work'
      and coalesce(task.metadata->>'project_pull_item_id','') = ''
  ),0)::integer
  into v_presented_regular
  from atlas.presented_work_rows_v1(v_membership.farm_id,v_membership.id,v_day) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity;

  v_remaining_regular := greatest(v_regular_target-v_presented_regular,0);
  v_available_pull_minutes := least(v_daily_pull_minutes,greatest(v_remaining_regular,0)) - v_used_minutes;

  if v_item.expected_active_minutes > greatest(v_available_pull_minutes,0) then
    raise exception 'This project card does not fit today''s remaining project pull budget.' using errcode='55000';
  end if;

  if v_item.source_task_id is not null then
    select * into v_source from atlas.tasks where id=v_item.source_task_id;
  end if;
  v_effort := coalesce(v_source.effort_units,
    case when v_item.expected_active_minutes <= 30 then 0.5 when v_item.expected_active_minutes > 120 then 2 else 1 end);

  insert into atlas.tasks (
    farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,unlock_text,blocker_text,
    generated_from,generated_from_id,note,metadata,action_key,work_class,parent_task_id,visibility_scope,
    assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,task_scope,work_lane,commitment_kind,effort_units
  ) values (
    v_item.farm_id,v_item.organization_id,v_source.zone_id,v_item.title,coalesce(v_source.task_type,'project_pull'),'open',
    coalesce(v_item.priority,v_source.priority,'normal'),v_day,v_source.unlock_text,null,
    'project_pull_item',v_item.id,coalesce(v_item.note,v_source.note),
    coalesce(v_source.metadata,'{}'::jsonb) || jsonb_build_object(
      'project_pull_item_id',v_item.id,
      'project_id',v_item.project_id,
      'project_pull_service_date',v_day,
      'project_pull_source_task_id',v_item.source_task_id
    ),
    v_source.action_key,coalesce(v_item.work_class,v_source.work_class,'standard'),null,
    coalesce(v_source.visibility_scope,'assigned_worker'),v_membership.id,v_membership.user_id,auth.uid(),
    'generated','farm_operation','discretionary','floating',v_effort
  ) returning id into v_task_id;

  insert into atlas.task_objects(task_id,object_id,role)
  select v_task_id,object_id,role
  from atlas.task_objects
  where task_id=v_item.source_task_id
  on conflict do nothing;

  insert into atlas.task_capacity_profiles(
    task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,
    estimate_source,estimate_confidence,recovery_origin_due_date,owner_locked,owner_note,metadata
  ) values (
    v_task_id,v_item.farm_id,v_item.expected_active_minutes,v_item.physical_load,'optional_improvement',null,
    'project_pull_item','owner_confirmed',null,true,'Pulled from durable project pool.',
    jsonb_build_object('project_pull_item_id',v_item.id)
  ) on conflict (task_id) do nothing;

  insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata)
  values (v_item.project_id,v_task_id,'daily_pull',100,'project_pull',jsonb_build_object('project_pull_item_id',v_item.id))
  on conflict do nothing;

  insert into atlas.project_pull_selections(project_item_id,project_id,farm_id,membership_id,service_date,task_id,state,note)
  values (v_item.id,v_item.project_id,v_item.farm_id,v_membership.id,v_day,v_task_id,'selected',p_note);

  update atlas.project_pull_items
  set status='selected',active_task_id=v_task_id,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object(
    'contractVersion','project_pull_selection_v1',
    'projectItemId',v_item.id,
    'taskId',v_task_id,
    'serviceDate',v_day,
    'state','selected',
    'dailyPullMaxItems',v_daily_max_items,
    'dailyPullMinutes',v_daily_pull_minutes
  );
end;
$function$;
