alter table atlas.owner_week_projection
  add column if not exists plan_order integer not null default 1000;

create index if not exists owner_week_projection_day_order_v1
  on atlas.owner_week_projection(farm_id,membership_id,planned_date,plan_order,created_at);

update atlas.projects
set metadata = coalesce(metadata,'{}'::jsonb)
  || jsonb_build_object(
    'daily_pull_contract','paid_capacity_conveyor_v2',
    'daily_pull_minutes',420,
    'daily_pull_max_items',24,
    'daily_pull_choice_limit',24,
    'one_at_a_time_release',true,
    'completion_does_not_lower_daily_expectation',true
  ),
  updated_at=now()
where stable_key='elm_finish_renovation_pool';

create or replace function atlas.project_pull_options_for_member_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date default null::date,
  p_limit integer default null::integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
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
  v_project_minutes integer := 0;
  v_project_heavy integer := 0;
  v_regular_target integer;
  v_heavy_cap integer;
  v_remaining integer;
  v_budget integer;
  v_limit integer;
  v_options jsonb := '[]'::jsonb;
begin
  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and active;
  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_project from atlas.projects where id=p_project_id and status='active';
  if v_project.id is null or v_project.farm_id is distinct from v_membership.farm_id then
    raise exception 'Active project is not available to this membership.' using errcode='P0002';
  end if;

  if auth.uid() is not null
     and v_membership.user_id <> auth.uid()
     and not atlas.is_farm_owner(v_membership.farm_id) then
    raise exception 'Only the member or farm owner may view project pull options.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f where f.id=v_membership.farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_day := coalesce(p_day,v_today);

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=v_membership.id and farm_id=v_membership.farm_id and active;

  v_regular_target := coalesce(v_settings.regular_target_minutes,
    case v_membership.role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_heavy_cap := coalesce(v_settings.heavy_minutes_soft_cap,
    case v_membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end);

  if v_day > v_today then
    select
      coalesce(sum(capacity.expected_active_minutes),0)::integer,
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
    select
      coalesce(sum(capacity.expected_active_minutes),0)::integer,
      coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
    into v_regular_minutes,v_heavy_minutes
    from atlas.presented_work_rows_v1(v_membership.farm_id,v_membership.id,v_day) presented
    join atlas.tasks task on task.id=presented.task_id
    cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
    where presented.presentation_state='presented'
      and nullif(task.metadata->>'project_pull_item_id','') is null
      and capacity.expected_active_minutes>0;

    select
      coalesce(sum(capacity.expected_active_minutes),0)::integer,
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

  select
    coalesce(sum(item.expected_active_minutes),0)::integer,
    coalesce(sum(item.expected_active_minutes) filter(where item.physical_load='heavy'),0)::integer
  into v_project_minutes,v_project_heavy
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and selection.state in ('selected','completed');

  v_regular_minutes := v_regular_minutes + v_project_minutes;
  v_heavy_minutes := v_heavy_minutes + v_project_heavy;
  v_remaining := greatest(v_regular_target-v_regular_minutes,0);
  v_budget := v_remaining;
  v_limit := least(greatest(coalesce(p_limit,nullif((v_project.metadata->>'daily_pull_choice_limit')::integer,0),24),1),24);

  select coalesce(jsonb_agg(row.payload order by row.fit_rank,row.priority_rank,row.expected_active_minutes,row.title),'[]'::jsonb)
  into v_options
  from (
    select
      item.title,
      item.expected_active_minutes,
      case when item.expected_active_minutes <= v_budget
             and not (item.physical_load='heavy' and v_heavy_minutes+item.expected_active_minutes>v_heavy_cap)
           then 0 else 1 end as fit_rank,
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end as priority_rank,
      jsonb_build_object(
        'projectItemId',item.id,
        'title',item.title,
        'note',item.note,
        'expectedActiveMinutes',item.expected_active_minutes,
        'physicalLoad',item.physical_load,
        'workClass',item.work_class,
        'environment',item.environment,
        'location',item.location_text,
        'priority',item.priority,
        'fitsToday',item.expected_active_minutes <= v_budget
          and not (item.physical_load='heavy' and v_heavy_minutes+item.expected_active_minutes>v_heavy_cap)
      ) as payload
    from atlas.project_pull_items item
    where item.project_id=p_project_id
      and item.farm_id=v_membership.farm_id
      and item.status='available'
      and (item.preferred_membership_id is null or item.preferred_membership_id=v_membership.id)
      and not exists (
        select 1
        from atlas.project_pull_item_dependencies dependency
        join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
        where dependency.project_item_id=item.id
          and prerequisite.status <> dependency.required_status
      )
      and not exists (
        select 1 from atlas.project_pull_selections selection
        where selection.project_item_id=item.id and selection.state='selected'
      )
    order by fit_rank,priority_rank,item.expected_active_minutes,item.title
    limit v_limit
  ) row;

  return jsonb_build_object(
    'contractVersion','project_pull_options_v1',
    'projectId',v_project.id,
    'projectTitle',v_project.title,
    'membershipId',v_membership.id,
    'serviceDate',v_day,
    'capacity',jsonb_build_object(
      'regularTargetMinutes',v_regular_target,
      'alreadyPresentedRegularMinutes',v_regular_minutes,
      'remainingRegularMinutes',v_remaining,
      'heavyMinutesSoftCap',v_heavy_cap,
      'alreadyPresentedHeavyMinutes',v_heavy_minutes,
      'projectPullBudgetMinutes',v_budget
    ),
    'options',v_options
  );
end;
$function$;

create or replace function atlas.project_pull_status_for_member_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_project atlas.projects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_options jsonb;
  v_target integer := 0;
  v_remaining integer := 0;
  v_used_items integer := 0;
  v_used_minutes integer := 0;
  v_available_items integer := 0;
begin
  select * into v_project from atlas.projects where id=p_project_id and status='active';
  if v_project.id is null then raise exception 'Active project not found.' using errcode='P0002'; end if;

  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_project.farm_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  if auth.uid() is not null
     and v_membership.user_id <> auth.uid()
     and not atlas.is_farm_owner(v_membership.farm_id) then
    raise exception 'Only the member or farm owner may inspect project pull status.' using errcode='42501';
  end if;

  v_options := atlas.project_pull_options_for_member_v1(v_project.id,v_membership.id,v_day,24);
  v_target := coalesce((v_options#>>'{capacity,regularTargetMinutes}')::integer,0);
  v_remaining := coalesce((v_options#>>'{capacity,remainingRegularMinutes}')::integer,0);

  select count(*)::integer,coalesce(sum(item.expected_active_minutes),0)::integer
  into v_used_items,v_used_minutes
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and selection.state in ('selected','completed');

  select count(*)::integer into v_available_items
  from atlas.project_pull_items item
  where item.project_id=v_project.id
    and item.status='available'
    and (item.preferred_membership_id is null or item.preferred_membership_id=v_membership.id)
    and not exists (
      select 1
      from atlas.project_pull_item_dependencies dependency
      join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
      where dependency.project_item_id=item.id
        and prerequisite.status <> dependency.required_status
    );

  return jsonb_build_object(
    'contractVersion','project_pull_status_v1',
    'projectId',v_project.id,
    'projectTitle',v_project.title,
    'serviceDate',v_day,
    'enabled',coalesce((v_project.metadata->>'daily_pull_enabled')::boolean,false),
    'dailyPullMaxItems',24,
    'dailyPullMinutes',v_target,
    'usedItems',v_used_items,
    'remainingItems',v_available_items,
    'usedPullMinutes',v_used_minutes,
    'remainingPullMinutes',v_remaining,
    'availableItemCount',v_available_items,
    'completeForToday',v_remaining<=15 or v_available_items=0
  );
end;
$function$;

create or replace function atlas.pull_project_item_to_today_v1(
  p_project_item_id uuid,
  p_membership_id uuid,
  p_day date default null::date,
  p_note text default null::text
)
returns jsonb
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
  v_task_id uuid;
  v_effort numeric;
  v_capacity jsonb;
  v_regular_target integer := 0;
  v_remaining_regular integer := 0;
  v_heavy_minutes integer := 0;
  v_heavy_cap integer := 0;
  v_plan_order integer := null;
begin
  select * into v_item from atlas.project_pull_items where id=p_project_item_id for update;
  if v_item.id is null then raise exception 'Project item not found.' using errcode='P0002'; end if;
  if v_item.status <> 'available' then raise exception 'Project item is not available.' using errcode='55000'; end if;

  select * into v_project from atlas.projects where id=v_item.project_id and status='active';
  if v_project.id is null then raise exception 'Project is not active.' using errcode='55000'; end if;

  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_item.farm_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_item.preferred_membership_id is not null and v_item.preferred_membership_id <> v_membership.id then
    raise exception 'Project item is assigned to a different member.' using errcode='42501';
  end if;
  if auth.uid() is not null and v_membership.user_id <> auth.uid() and not atlas.is_farm_owner(v_item.farm_id) then
    raise exception 'Only the member or farm owner may pull this work.' using errcode='42501';
  end if;

  if exists (
    select 1 from atlas.project_pull_item_dependencies dependency
    join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
    where dependency.project_item_id=v_item.id
      and prerequisite.status <> dependency.required_status
  ) then
    raise exception 'Project item still has an unfinished prerequisite.' using errcode='55000';
  end if;

  v_capacity := atlas.project_pull_options_for_member_v1(v_project.id,v_membership.id,v_day,24)->'capacity';
  v_regular_target := coalesce((v_capacity->>'regularTargetMinutes')::integer,0);
  v_remaining_regular := coalesce((v_capacity->>'remainingRegularMinutes')::integer,0);
  v_heavy_minutes := coalesce((v_capacity->>'alreadyPresentedHeavyMinutes')::integer,0);
  v_heavy_cap := coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,0);

  if v_item.expected_active_minutes > greatest(v_remaining_regular,0) then
    raise exception 'This project card does not fit the remaining paid-work capacity.' using errcode='55000';
  end if;
  if v_item.physical_load='heavy' and v_heavy_minutes+v_item.expected_active_minutes>v_heavy_cap then
    raise exception 'This project card exceeds the remaining heavy-work capacity.' using errcode='55000';
  end if;

  select projection.plan_order into v_plan_order
  from atlas.owner_week_projection projection
  where projection.farm_id=v_item.farm_id
    and projection.membership_id=v_membership.id
    and projection.planned_date=v_day
    and projection.source_kind='project_pull'
    and projection.source_id=v_item.id
  order by projection.locked desc,projection.updated_at desc
  limit 1;

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
      'project_pull_source_task_id',v_item.source_task_id,
      'project_pull_plan_order',v_plan_order,
      'paid_day_contract','full_paid_day_v2',
      'serial_project_serving',true
    ),
    v_source.action_key,coalesce(v_item.work_class,v_source.work_class,'standard'),null,
    coalesce(v_source.visibility_scope,'assigned_worker'),v_membership.id,v_membership.user_id,auth.uid(),
    'generated','farm_operation','discretionary','floating',v_effort
  ) returning id into v_task_id;

  insert into atlas.task_objects(task_id,object_id,role)
  select v_task_id,object_id,role from atlas.task_objects where task_id=v_item.source_task_id
  on conflict do nothing;

  insert into atlas.task_capacity_profiles(
    task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,
    estimate_source,estimate_confidence,recovery_origin_due_date,owner_locked,owner_note,metadata
  ) values (
    v_task_id,v_item.farm_id,v_item.expected_active_minutes,v_item.physical_load,'optional_improvement',null,
    'project_pull_item','owner_confirmed',null,true,'Pulled from durable project pool as one serving of a full paid day.',
    jsonb_build_object('project_pull_item_id',v_item.id,'full_paid_day_v2',true)
  ) on conflict (task_id) do nothing;

  insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata)
  values (v_item.project_id,v_task_id,'daily_pull',coalesce(v_plan_order,1000),'project_pull',jsonb_build_object('project_pull_item_id',v_item.id))
  on conflict do nothing;

  insert into atlas.project_pull_selections(project_item_id,project_id,farm_id,membership_id,service_date,task_id,state,note,metadata)
  values (v_item.id,v_item.project_id,v_item.farm_id,v_membership.id,v_day,v_task_id,'selected',p_note,
    jsonb_build_object('plan_order',v_plan_order,'paid_day_contract','full_paid_day_v2'));

  update atlas.project_pull_items set status='selected',active_task_id=v_task_id,updated_at=now() where id=v_item.id;

  return jsonb_build_object(
    'contractVersion','project_pull_selection_v2',
    'projectItemId',v_item.id,
    'taskId',v_task_id,
    'serviceDate',v_day,
    'state','selected',
    'planOrder',v_plan_order,
    'dailyPullMaxItems',24,
    'dailyPullMinutes',v_regular_target,
    'remainingPaidMinutesAfterSelection',greatest(v_remaining_regular-v_item.expected_active_minutes,0)
  );
end;
$function$;

create or replace function atlas.refresh_owner_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path to 'atlas','public'
as $function$
declare
  v_end date:=p_start_date+greatest(p_days,1)-1;
  v_count integer:=0;
  v_project_id uuid;
  v_date date;
  v_option jsonb;
  v_capacity jsonb;
  v_item record;
  v_target_minutes integer:=420;
  v_heavy_cap integer:=210;
  v_heavy_minutes integer:=0;
  v_remaining integer:=0;
  v_option_minutes integer:=0;
  v_option_load text;
  v_iteration integer;
begin
  delete from atlas.owner_week_projection
  where farm_id=p_farm_id and membership_id=p_membership_id
    and planned_date between p_start_date and v_end and locked=false;

  insert into atlas.owner_week_projection(
    farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
  )
  select
    t.farm_id,t.assigned_membership_id,t.due_date,'task',t.id,t.title,
    case when coalesce(t.metadata->>'commitment_kind','')='dependency' then 'conditional' else 'planned' end,
    coalesce(t.metadata->>'environment',null),capacity.expected_active_minutes,
    case
      when coalesce((t.metadata->>'personal_task')::boolean,false) or lower(coalesce(t.metadata->>'paid_work','true')) in ('false','no','0') then 'Personal obligation · visible, not paid-work capacity'
      when capacity.micro_round_key='grow_room_observation' then 'Micro observation · required on this date, not a work block'
      when coalesce(t.metadata->>'commitment_kind','')='dependency' then 'Dependency-gated task'
      else 'Dated Atlas task' end,
    100 + row_number() over(partition by t.due_date order by
      case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
      t.created_at,t.id)::integer
  from atlas.tasks t
  cross join lateral atlas.task_capacity_plan_v1(t,t.due_date) capacity
  where t.farm_id=p_farm_id
    and t.assigned_membership_id=p_membership_id
    and t.status in ('open','blocked')
    and t.due_date between p_start_date and v_end
    and t.parent_task_id is null
    and t.metadata->>'parent_task_id' is null
    and coalesce((t.metadata->>'is_child_task')::boolean,false)=false
  on conflict do nothing;

  select p.id into v_project_id
  from atlas.projects p
  where p.farm_id=p_farm_id and p.stable_key='elm_finish_renovation_pool'
  limit 1;

  if v_project_id is not null then
    for v_date in select generate_series(p_start_date,v_end,interval '1 day')::date loop
      if extract(isodow from v_date)=7 then continue; end if;

      v_capacity := atlas.project_pull_options_for_member_v2(v_project_id,p_membership_id,v_date,24)->'capacity';
      v_target_minutes := coalesce((v_capacity->>'regularTargetMinutes')::integer,420);
      v_heavy_cap := coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,210);
      v_heavy_minutes := coalesce((v_capacity->>'alreadyPresentedHeavyMinutes')::integer,0);
      v_remaining := coalesce((v_capacity->>'remainingRegularMinutes')::integer,0);

      for v_iteration in 1..24 loop
        exit when v_remaining<=15;
        v_option:=null;

        select option.value into v_option
        from jsonb_array_elements(coalesce(atlas.project_pull_options_for_member_v2(v_project_id,p_membership_id,v_date,24)->'options','[]'::jsonb))
          with ordinality as option(value,position)
        where coalesce((option.value->>'fitsToday')::boolean,false)
          and coalesce((option.value->>'expectedActiveMinutes')::integer,0)>0
          and coalesce((option.value->>'expectedActiveMinutes')::integer,0)<=v_remaining
          and (coalesce(option.value->>'physicalLoad','moderate')<>'heavy'
            or v_heavy_minutes+coalesce((option.value->>'expectedActiveMinutes')::integer,0)<=v_heavy_cap)
          and not exists(
            select 1 from atlas.owner_week_projection used
            where used.farm_id=p_farm_id and used.membership_id=p_membership_id
              and used.source_kind='project_pull'
              and used.source_id=(option.value->>'projectItemId')::uuid
          )
        order by option.position
        limit 1;

        exit when v_option is null;
        v_option_minutes:=coalesce((v_option->>'expectedActiveMinutes')::integer,0);
        v_option_load:=coalesce(v_option->>'physicalLoad','moderate');

        select i.* into v_item from atlas.project_pull_items i
        where i.id=(v_option->>'projectItemId')::uuid and i.project_id=v_project_id and i.status='available';
        exit when not found;

        insert into atlas.owner_week_projection(
          farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
        ) values(
          p_farm_id,p_membership_id,v_date,'project_pull',v_item.id,v_item.title,
          case when v_item.environment='outdoor' then 'flexible' else 'planned' end,
          v_item.environment,v_item.expected_active_minutes,
          case when v_item.environment='outdoor'
            then 'Full paid-day fill · fits remaining capacity · weather-sensitive'
            else 'Full paid-day fill · fits remaining capacity' end,
          1000+v_iteration
        ) on conflict do nothing;

        v_remaining:=greatest(v_remaining-v_option_minutes,0);
        if v_option_load='heavy' then v_heavy_minutes:=v_heavy_minutes+v_option_minutes; end if;
      end loop;
    end loop;
  end if;

  select count(*) into v_count from atlas.owner_week_projection
  where farm_id=p_farm_id and membership_id=p_membership_id and planned_date between p_start_date and v_end;
  return v_count;
end;
$function$;
