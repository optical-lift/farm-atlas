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

  -- Completed project work always consumes the day's target. Selected project
  -- work consumes current capacity only while the materialized task is open.
  -- A blocked serving remains an obligation but frees capacity for another
  -- executable serving rather than stalling the paid workday.
  select
    coalesce(sum(item.expected_active_minutes),0)::integer,
    coalesce(sum(item.expected_active_minutes) filter(where item.physical_load='heavy'),0)::integer
  into v_project_minutes,v_project_heavy
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  join atlas.tasks selected_task on selected_task.id=selection.task_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and (
      selection.state='completed'
      or (selection.state='selected' and selected_task.status='open')
    );

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

create or replace function atlas.sync_project_pull_item_from_task_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_item_id uuid;
  v_service_date date;
  v_membership_id uuid;
  v_allow_chain boolean := false;
begin
  v_item_id := nullif(new.metadata->>'project_pull_item_id','')::uuid;
  if v_item_id is null then return new; end if;

  v_service_date := nullif(new.metadata->>'project_pull_service_date','')::date;
  v_membership_id := new.assigned_membership_id;

  if new.status='done' and old.status is distinct from new.status then
    update atlas.project_pull_items
    set status='completed',active_task_id=null,updated_at=now()
    where id=v_item_id;
    update atlas.project_pull_selections
    set state='completed',completed_at=coalesce(new.completed_at,now())
    where task_id=new.id and state='selected';
    v_allow_chain := true;
  elsif new.status in ('archived','skipped') and old.status is distinct from new.status then
    update atlas.project_pull_items
    set status='available',active_task_id=null,updated_at=now()
    where id=v_item_id and status='selected';
    update atlas.project_pull_selections
    set state='returned',returned_at=now()
    where task_id=new.id and state='selected';
    v_allow_chain := true;
  elsif new.status='blocked' and old.status is distinct from new.status then
    v_allow_chain := true;
  end if;

  if v_allow_chain and v_service_date is not null and v_membership_id is not null then
    begin
      -- Status triggers have no trustworthy live weather context, so automatic
      -- chaining may deal indoor/either work only. Home can later deal outdoor
      -- work through the weather-aware p_allow_outdoor input.
      perform atlas.deal_next_paid_project_work_v1(new.farm_id,v_membership_id,v_service_date,false);
    exception when others then
      raise warning 'Could not deal next paid project serving after task %: %',new.id,sqlerrm;
    end;
  end if;

  return new;
end;
$function$;
