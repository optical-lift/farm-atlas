update atlas.projects project
set metadata = coalesce(project.metadata,'{}'::jsonb) || jsonb_build_object(
  'presence_hold_contract','assignee_scoped_v1',
  'offsite_hold_scope',jsonb_build_array('owner','marshall'),
  'farm_hand_assigned_work_continues',true
)
where project.stable_key='elm_finish_renovation_pool';

create or replace function atlas.deal_next_paid_project_work_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date default null::date,
  p_allow_outdoor boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_project atlas.projects%rowtype;
  v_project_enabled boolean := false;
  v_member_assigned_bypass boolean := false;
  v_timezone text := 'America/Chicago';
  v_today date;
  v_day date;
  v_current_task_id uuid;
  v_projection_count integer := 0;
  v_candidate record;
  v_capacity jsonb;
  v_remaining integer := 0;
  v_heavy_minutes integer := 0;
  v_heavy_cap integer := 0;
  v_result jsonb;
  v_next_order integer := 1001;
begin
  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and farm_id=p_farm_id and active;
  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if auth.uid() is not null
     and v_membership.user_id <> auth.uid()
     and not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only the member or farm owner may deal this work.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_day := coalesce(p_day,v_today);

  if v_day is distinct from v_today then
    return jsonb_build_object(
      'contractVersion','paid_project_conveyor_v1',
      'state','future_plan_only',
      'serviceDate',v_day,
      'taskId',null
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||v_day::text||'|paid_project_conveyor',0));

  select task.id into v_current_task_id
  from atlas.project_pull_selections selection
  join atlas.tasks task on task.id=selection.task_id
  where selection.farm_id=p_farm_id
    and selection.membership_id=p_membership_id
    and selection.service_date=v_day
    and selection.state='selected'
    and task.status='open'
  order by selection.selected_at,selection.id
  limit 1;

  if v_current_task_id is not null then
    return jsonb_build_object(
      'contractVersion','paid_project_conveyor_v1',
      'state','current_serving_exists',
      'serviceDate',v_day,
      'taskId',v_current_task_id
    );
  end if;

  select p.* into v_project
  from atlas.projects p
  where p.farm_id=p_farm_id
    and p.status='active'
    and p.stable_key='elm_finish_renovation_pool'
  limit 1;

  if v_project.id is null then
    return jsonb_build_object('contractVersion','paid_project_conveyor_v1','state','no_project','serviceDate',v_day,'taskId',null);
  end if;

  v_project_enabled := coalesce((v_project.metadata->>'daily_pull_enabled')::boolean,false);
  v_member_assigned_bypass :=
    not v_project_enabled
    and v_membership.role='farm_hand'
    and coalesce((v_project.metadata->>'farm_hand_assigned_work_continues')::boolean,false)
    and exists(
      select 1
      from atlas.project_pull_items item
      where item.project_id=v_project.id
        and item.farm_id=p_farm_id
        and item.status='available'
        and item.preferred_membership_id=p_membership_id
    );

  if not v_project_enabled and not v_member_assigned_bypass then
    return jsonb_build_object(
      'contractVersion','paid_project_conveyor_v1',
      'state','project_presence_hold',
      'serviceDate',v_day,
      'taskId',null
    );
  end if;

  select count(*)::integer into v_projection_count
  from atlas.owner_week_projection projection
  where projection.farm_id=p_farm_id
    and projection.membership_id=p_membership_id
    and projection.planned_date=v_day
    and projection.source_kind='project_pull';

  if v_projection_count=0 then
    perform atlas.refresh_owner_week_projection_v1(p_farm_id,p_membership_id,v_day,1);
  end if;

  v_capacity := atlas.project_pull_options_for_member_v2(v_project.id,p_membership_id,v_day,24)->'capacity';
  v_remaining := coalesce((v_capacity->>'remainingRegularMinutes')::integer,0);
  v_heavy_minutes := coalesce((v_capacity->>'alreadyPresentedHeavyMinutes')::integer,0);
  v_heavy_cap := coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,0);

  if v_remaining<=15 then
    return jsonb_build_object(
      'contractVersion','paid_project_conveyor_v1',
      'state','paid_day_filled',
      'serviceDate',v_day,
      'taskId',null,
      'remainingPaidMinutes',v_remaining
    );
  end if;

  select
    projection.source_id as item_id,
    projection.plan_order,
    item.title,
    item.expected_active_minutes,
    item.physical_load,
    item.environment
  into v_candidate
  from atlas.owner_week_projection projection
  join atlas.project_pull_items item
    on item.id=projection.source_id
   and item.project_id=v_project.id
  where projection.farm_id=p_farm_id
    and projection.membership_id=p_membership_id
    and projection.planned_date=v_day
    and projection.source_kind='project_pull'
    and item.status='available'
    and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
    and (v_project_enabled or item.preferred_membership_id=p_membership_id)
    and (p_allow_outdoor or item.environment<>'outdoor')
    and item.expected_active_minutes<=v_remaining
    and (item.physical_load<>'heavy' or v_heavy_minutes+item.expected_active_minutes<=v_heavy_cap)
    and not exists(
      select 1 from atlas.project_pull_item_dependencies dependency
      join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
      where dependency.project_item_id=item.id
        and prerequisite.status<>dependency.required_status
    )
    and not exists(
      select 1 from atlas.project_pull_selections returned
      where returned.project_item_id=item.id
        and returned.membership_id=p_membership_id
        and returned.service_date=v_day
        and returned.state='returned'
    )
  order by projection.plan_order,projection.created_at,projection.id
  limit 1;

  if v_candidate.item_id is null then
    select coalesce(max(plan_order),1000)+1 into v_next_order
    from atlas.owner_week_projection
    where farm_id=p_farm_id and membership_id=p_membership_id and planned_date=v_day;

    select
      item.id as item_id,
      v_next_order as plan_order,
      item.title,
      item.expected_active_minutes,
      item.physical_load,
      item.environment
    into v_candidate
    from jsonb_array_elements(coalesce(atlas.project_pull_options_for_member_v2(v_project.id,p_membership_id,v_day,24)->'options','[]'::jsonb)) option
    join atlas.project_pull_items item on item.id=(option->>'projectItemId')::uuid
    where coalesce((option->>'fitsToday')::boolean,false)
      and (v_project_enabled or item.preferred_membership_id=p_membership_id)
      and (p_allow_outdoor or item.environment<>'outdoor')
      and item.expected_active_minutes<=v_remaining
      and not exists(
        select 1 from atlas.project_pull_selections returned
        where returned.project_item_id=item.id
          and returned.membership_id=p_membership_id
          and returned.service_date=v_day
          and returned.state='returned'
      )
      and not exists(
        select 1 from atlas.owner_week_projection reserved
        where reserved.farm_id=p_farm_id
          and reserved.membership_id=p_membership_id
          and reserved.source_kind='project_pull'
          and reserved.source_id=item.id
          and reserved.planned_date<>v_day
      )
    order by
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end,
      item.expected_active_minutes,item.title
    limit 1;

    if v_candidate.item_id is not null then
      insert into atlas.owner_week_projection(
        farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
      ) values(
        p_farm_id,p_membership_id,v_day,'project_pull',v_candidate.item_id,v_candidate.title,
        case when v_candidate.environment='outdoor' then 'flexible' else 'planned' end,
        v_candidate.environment,v_candidate.expected_active_minutes,
        case when v_project_enabled
          then 'Same-day full paid-day refill · Finish + Renovation pool'
          else 'Same-day full paid-day refill · explicitly assigned farm-hand Finish + Renovation work remains active during Owner/Marshall presence hold'
        end,
        v_candidate.plan_order
      ) on conflict do nothing;
    end if;
  end if;

  if v_candidate.item_id is null then
    return jsonb_build_object(
      'contractVersion','paid_project_conveyor_v1',
      'state',case when not p_allow_outdoor then 'no_indoor_serving_available' else 'no_fitting_serving_available' end,
      'serviceDate',v_day,
      'taskId',null,
      'remainingPaidMinutes',v_remaining
    );
  end if;

  v_result := atlas.pull_project_item_to_today_v1(
    v_candidate.item_id,
    p_membership_id,
    v_day,
    case when v_project_enabled
      then 'Automatically dealt from the Owner full paid-day plan. Only one actionable project serving is released at a time.'
      else 'Automatically dealt from work explicitly assigned to this farm hand. Owner/Marshall off-site hold does not suspend the farm hand''s assigned work.'
    end
  );

  return jsonb_build_object(
    'contractVersion','paid_project_conveyor_v1',
    'state','dealt',
    'serviceDate',v_day,
    'taskId',v_result->>'taskId',
    'projectItemId',v_candidate.item_id,
    'planOrder',v_candidate.plan_order,
    'remainingPaidMinutesBeforeDeal',v_remaining,
    'expectedActiveMinutes',v_candidate.expected_active_minutes,
    'projectPresenceHoldBypassedForAssignedFarmHand',v_member_assigned_bypass
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
  v_today date;
  v_timezone text:='America/Chicago';
  v_count integer:=0;
  v_project_id uuid;
  v_project_enabled boolean:=false;
  v_membership_role text;
  v_date date;
  v_target_minutes integer:=420;
  v_heavy_cap integer:=210;
  v_paid_minutes integer:=0;
  v_heavy_minutes integer:=0;
  v_remaining integer:=0;
  v_iteration integer;
  v_floating record;
  v_project record;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;

  delete from atlas.owner_week_projection
  where farm_id=p_farm_id
    and membership_id=p_membership_id
    and planned_date between p_start_date and v_end
    and locked=false;

  insert into atlas.owner_week_projection(
    farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
  )
  select
    task.farm_id,task.assigned_membership_id,task.due_date,'task',task.id,task.title,
    case when coalesce(task.metadata->>'commitment_kind','')='dependency' then 'conditional' else 'planned' end,
    coalesce(nullif(lower(task.metadata->>'environment'),''),null),
    capacity.expected_active_minutes,
    case
      when coalesce((task.metadata->>'personal_task')::boolean,false)
        or lower(coalesce(task.metadata->>'paid_work','true')) in ('false','no','0')
        then 'Personal obligation · visible, not paid-work capacity'
      when capacity.micro_round_key='grow_room_observation'
        then 'Micro observation · required on this date, not a work block'
      when coalesce(task.metadata->>'commitment_kind','')='dependency'
        then 'Dependency-gated task'
      else 'Dated Atlas task'
    end,
    100 + row_number() over(
      partition by task.due_date
      order by
        case task.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
        task.created_at,task.id
    )::integer
  from atlas.tasks task
  cross join lateral atlas.task_capacity_plan_v1(task,task.due_date) capacity
  where task.farm_id=p_farm_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and task.due_date between p_start_date and v_end
    and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and coalesce((task.metadata->>'is_child_task')::boolean,false)=false
  on conflict do nothing;

  select
    coalesce(settings.regular_target_minutes,
      case membership.role when 'farm_hand' then 420 when 'manager' then 360 else 480 end),
    coalesce(settings.heavy_minutes_soft_cap,
      case membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end),
    membership.role
  into v_target_minutes,v_heavy_cap,v_membership_role
  from atlas.farm_memberships membership
  left join atlas.member_capacity_settings settings
    on settings.membership_id=membership.id
   and settings.farm_id=membership.farm_id
   and settings.active
  where membership.id=p_membership_id
    and membership.farm_id=p_farm_id
    and membership.active;

  select project.id,
         coalesce((project.metadata->>'daily_pull_enabled')::boolean,false)
  into v_project_id,v_project_enabled
  from atlas.projects project
  where project.farm_id=p_farm_id
    and project.status='active'
    and project.stable_key='elm_finish_renovation_pool'
    and (
      coalesce((project.metadata->>'daily_pull_enabled')::boolean,false)=true
      or (
        v_membership_role='farm_hand'
        and coalesce((project.metadata->>'farm_hand_assigned_work_continues')::boolean,false)=true
        and exists(
          select 1
          from atlas.project_pull_items assigned_item
          where assigned_item.project_id=project.id
            and assigned_item.farm_id=p_farm_id
            and assigned_item.status='available'
            and assigned_item.preferred_membership_id=p_membership_id
        )
      )
    )
  limit 1;

  for v_date in
    select generate_series(p_start_date,v_end,interval '1 day')::date
  loop
    if extract(isodow from v_date)=7 then
      continue;
    end if;

    select
      coalesce(sum(projection.expected_active_minutes),0)::integer,
      coalesce(sum(projection.expected_active_minutes) filter (
        where coalesce(
          case projection.source_kind
            when 'task' then task_capacity.physical_load
            when 'floating_task' then floating_capacity.physical_load
            when 'project_pull' then project_item.physical_load
            else null
          end,
          'moderate'
        )='heavy'
      ),0)::integer
    into v_paid_minutes,v_heavy_minutes
    from atlas.owner_week_projection projection
    left join atlas.tasks dated_task
      on projection.source_kind='task' and dated_task.id=projection.source_id
    left join atlas.task_capacity_profiles task_capacity
      on task_capacity.task_id=dated_task.id
    left join atlas.tasks floating_task
      on projection.source_kind='floating_task' and floating_task.id=projection.source_id
    left join atlas.task_capacity_profiles floating_capacity
      on floating_capacity.task_id=floating_task.id
    left join atlas.project_pull_items project_item
      on projection.source_kind='project_pull' and project_item.id=projection.source_id
    where projection.farm_id=p_farm_id
      and projection.membership_id=p_membership_id
      and projection.planned_date=v_date;

    v_remaining:=greatest(v_target_minutes-v_paid_minutes,0);

    for v_iteration in 1..24 loop
      exit when v_remaining<=15;
      v_floating:=null;

      select candidate.* into v_floating
      from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,v_date) candidate
      where candidate.expected_active_minutes<=v_remaining
        and (candidate.physical_load<>'heavy' or v_heavy_minutes+candidate.expected_active_minutes<=v_heavy_cap)
        and not exists (
          select 1
          from atlas.owner_week_projection reserved
          where reserved.farm_id=p_farm_id
            and reserved.membership_id=p_membership_id
            and reserved.source_kind='floating_task'
            and reserved.source_id=candidate.task_id
            and reserved.planned_date>=v_today
        )
      order by
        candidate.obligation_order,
        case candidate.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end,
        candidate.sky_preference_order,
        candidate.expected_active_minutes desc,
        candidate.created_at,
        candidate.task_id
      limit 1;

      exit when v_floating.task_id is null;

      insert into atlas.owner_week_projection(
        farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
      ) values(
        p_farm_id,p_membership_id,v_date,'floating_task',v_floating.task_id,v_floating.title,
        case when v_floating.environment='outdoor' then 'flexible' else 'planned' end,
        v_floating.environment,v_floating.expected_active_minutes,
        case when v_floating.environment='outdoor'
          then 'General paid-work reservoir · existing undated Atlas task · weather-sensitive · task date remains unchanged'
          else 'General paid-work reservoir · existing undated Atlas task · task date remains unchanged'
        end,
        700+v_iteration
      ) on conflict do nothing;

      v_remaining:=greatest(v_remaining-v_floating.expected_active_minutes,0);
      if v_floating.physical_load='heavy' then
        v_heavy_minutes:=v_heavy_minutes+v_floating.expected_active_minutes;
      end if;
    end loop;

    if v_project_id is not null then
      for v_iteration in 1..24 loop
        exit when v_remaining<=15;
        v_project:=null;

        select item.* into v_project
        from atlas.project_pull_items item
        where item.project_id=v_project_id
          and item.farm_id=p_farm_id
          and item.status='available'
          and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
          and (v_project_enabled or item.preferred_membership_id=p_membership_id)
          and item.expected_active_minutes>0
          and item.expected_active_minutes<=v_remaining
          and (item.physical_load<>'heavy' or v_heavy_minutes+item.expected_active_minutes<=v_heavy_cap)
          and not exists (
            select 1
            from atlas.project_pull_item_dependencies dependency
            join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
            where dependency.project_item_id=item.id
              and prerequisite.status<>dependency.required_status
          )
          and not exists (
            select 1
            from atlas.project_pull_selections selection
            where selection.project_item_id=item.id
              and selection.state='selected'
          )
          and not exists (
            select 1
            from atlas.owner_week_projection reserved
            where reserved.farm_id=p_farm_id
              and reserved.membership_id=p_membership_id
              and reserved.source_kind='project_pull'
              and reserved.source_id=item.id
              and reserved.planned_date>=v_today
          )
        order by
          case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end,
          case coalesce(item.activation_demand,'medium') when 'low' then 0 when 'medium' then 1 else 2 end,
          case coalesce(item.ambiguity_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end,
          item.expected_active_minutes desc,
          item.title,
          item.id
        limit 1;

        exit when v_project.id is null;

        insert into atlas.owner_week_projection(
          farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
        ) values(
          p_farm_id,p_membership_id,v_date,'project_pull',v_project.id,v_project.title,
          case when v_project.environment='outdoor' then 'flexible' else 'planned' end,
          v_project.environment,v_project.expected_active_minutes,
          case
            when not v_project_enabled and v_project.environment='outdoor'
              then 'Assigned farm-hand Finish + Renovation work · Owner/Marshall presence hold does not apply · weather-sensitive'
            when not v_project_enabled
              then 'Assigned farm-hand Finish + Renovation work · Owner/Marshall presence hold does not apply'
            when v_project.environment='outdoor'
              then 'General paid-work reservoir · Finish + Renovation pool · fits remaining paid capacity · weather-sensitive'
            else 'General paid-work reservoir · Finish + Renovation pool · fits remaining paid capacity'
          end,
          1000+v_iteration
        ) on conflict do nothing;

        v_remaining:=greatest(v_remaining-v_project.expected_active_minutes,0);
        if v_project.physical_load='heavy' then
          v_heavy_minutes:=v_heavy_minutes+v_project.expected_active_minutes;
        end if;
      end loop;
    end if;
  end loop;

  select count(*) into v_count
  from atlas.owner_week_projection
  where farm_id=p_farm_id
    and membership_id=p_membership_id
    and planned_date between p_start_date and v_end;

  return v_count;
end;
$function$;

update atlas.authenticated_rpc_registry
set evidence=coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
      'presence_hold_scope','owner_and_marshall_only',
      'farm_hand_assigned_finish_work_continues',true,
      'reviewed_date','2026-08-08'
    ),
    reviewed_at=now()
where signature in (
  'atlas.deal_next_paid_project_work_v1(uuid,uuid,date,boolean)',
  'atlas.refresh_owner_week_projection_v1(uuid, uuid, date, integer)'
);