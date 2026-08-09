alter table atlas.owner_week_projection
  drop constraint if exists owner_week_projection_source_kind_check;

alter table atlas.owner_week_projection
  add constraint owner_week_projection_source_kind_check
  check (source_kind = any (array[
    'task'::text,
    'floating_task'::text,
    'project_pull'::text,
    'queue'::text,
    'rhythm'::text
  ]));

create or replace function atlas.floating_paid_work_candidates_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns table(
  task_id uuid,
  title text,
  expected_active_minutes integer,
  physical_load text,
  environment text,
  priority text,
  effective_obligation_class text,
  sky_preference_order integer,
  obligation_order integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
  select
    task.id,
    task.title,
    capacity.expected_active_minutes,
    capacity.physical_load,
    case
      when lower(coalesce(task.metadata->>'environment','')) in ('indoor','outdoor','either')
        then lower(task.metadata->>'environment')
      when task.operation_class in (
        'establish_aboveground','divide_reestablish_belowground','cultivate_prepare',
        'harvest_collect','irrigate_water','mow_cut','inspect_assess'
      ) and task.task_type not in ('inventory','administrative','network')
        then 'outdoor'
      when lower(coalesce(task.task_type,'')) in ('sowing','transplanting','weeding','mowing','watering','harvest')
        then 'outdoor'
      else 'either'
    end as environment,
    task.priority,
    capacity.effective_obligation_class,
    case
      when coalesce(sky.gate->'fitness'->>'enforcementMode','')='preferred'
       and coalesce(sky.gate->'fitness'->>'fitness','')='favored'
      then 0 else 1
    end as sky_preference_order,
    case capacity.effective_obligation_class
      when 'hard_window' then 0
      when 'process_continuation' then 1
      when 'routine_production' then 2
      when 'recovery_work' then 3
      else 4
    end as obligation_order,
    task.created_at
  from atlas.tasks task
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  cross join lateral (
    select atlas.task_sky_presentation_gate_v1(task.id,p_day) as gate
  ) sky
  where task.farm_id=p_farm_id
    and task.assigned_membership_id=p_membership_id
    and task.task_scope='farm_operation'
    and task.status='open'
    and task.due_date is null
    and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and lower(coalesce(task.metadata->>'is_child_task','false'))<>'true'
    and nullif(task.metadata->>'project_pull_item_id','') is null
    and coalesce((task.metadata->>'personal_task')::boolean,false)=false
    and lower(coalesce(task.metadata->>'paid_work','true')) not in ('false','no','0')
    and lower(coalesce(task.metadata->>'reservoirDecisionState',''))<>'owner_review'
    and task.work_lane='discretionary'
    and task.commitment_kind='floating'
    and capacity.expected_active_minutes>0
    and atlas.task_prerequisites_ready_v1(task.id)
    and coalesce((sky.gate->>'withheldUnderSky')::boolean,false)=false
    and (
      task.planned_occurrence_id is null
      or exists (
        select 1
        from atlas.planned_work_occurrences occurrence
        where occurrence.id=task.planned_occurrence_id
          and occurrence.state='released'
      )
    )
    and not exists (
      select 1
      from atlas.task_release_queue_items queue_item
      where queue_item.farm_id=task.farm_id
        and queue_item.state in ('active','queued')
        and (
          queue_item.task_id=task.id
          or (
            task.planned_occurrence_id is not null
            and queue_item.planned_occurrence_id=task.planned_occurrence_id
          )
        )
    );
$function$;

revoke all on function atlas.floating_paid_work_candidates_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.floating_paid_work_candidates_v1(uuid,uuid,date) to service_role;

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

  select coalesce(settings.regular_target_minutes,
           case membership.role when 'farm_hand' then 420 when 'manager' then 360 else 480 end),
         coalesce(settings.heavy_minutes_soft_cap,
           case membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
  into v_target_minutes,v_heavy_cap
  from atlas.farm_memberships membership
  left join atlas.member_capacity_settings settings
    on settings.membership_id=membership.id
   and settings.farm_id=membership.farm_id
   and settings.active
  where membership.id=p_membership_id
    and membership.farm_id=p_farm_id
    and membership.active;

  -- A durable project pool can only contribute work while its release switch is on.
  -- This preserves presence/off-site holds instead of letting Owner projection leak
  -- disabled Finish Elm work into future days.
  select project.id into v_project_id
  from atlas.projects project
  where project.farm_id=p_farm_id
    and project.status='active'
    and project.stable_key='elm_finish_renovation_pool'
    and coalesce((project.metadata->>'daily_pull_enabled')::boolean,false)=true
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

    -- Existing canonical, undated paid tasks are a first-class reservoir. They keep
    -- their real task identity and due_date=NULL; the projection only reserves a
    -- tentative day for Owner planning.
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

    -- Finish Elm remains one reservoir source, not the definition of paid work.
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
          case when v_project.environment='outdoor'
            then 'General paid-work reservoir · Finish Elm pool · fits remaining paid capacity · weather-sensitive'
            else 'General paid-work reservoir · Finish Elm pool · fits remaining paid capacity'
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

create or replace function atlas.deal_next_paid_work_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date default null,
  p_allow_outdoor boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_timezone text:='America/Chicago';
  v_today date;
  v_day date;
  v_task_id uuid;
  v_environment text;
  v_project_result jsonb;
begin
  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id
    and farm_id=p_farm_id
    and active;

  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if auth.uid() is not null
     and v_membership.user_id<>auth.uid()
     and not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only the member or farm owner may deal this work.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;
  v_today:=(now() at time zone v_timezone)::date;
  v_day:=coalesce(p_day,v_today);

  if v_day is distinct from v_today then
    return jsonb_build_object(
      'contractVersion','paid_work_conveyor_v1',
      'state','future_plan_only',
      'serviceDate',v_day,
      'taskId',null
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_farm_id::text||'|'||p_membership_id::text||'|'||v_day::text||'|paid_work_conveyor',0
  ));

  -- Never open a second materialized project serving while one is already open.
  select task.id into v_task_id
  from atlas.project_pull_selections selection
  join atlas.tasks task on task.id=selection.task_id
  where selection.farm_id=p_farm_id
    and selection.membership_id=p_membership_id
    and selection.service_date=v_day
    and selection.state='selected'
    and task.status='open'
  order by selection.selected_at,selection.id
  limit 1;

  if v_task_id is not null then
    return jsonb_build_object(
      'contractVersion','paid_work_conveyor_v1',
      'state','current_project_serving_exists',
      'serviceDate',v_day,
      'taskId',v_task_id,
      'sourceKind','project_pull'
    );
  end if;

  -- If Owner projection already reserved an existing undated task for today and it
  -- is actually presentable now, reuse that canonical task rather than cloning it.
  select task.id,
         case
           when lower(coalesce(task.metadata->>'environment','')) in ('indoor','outdoor','either')
             then lower(task.metadata->>'environment')
           when task.operation_class in (
             'establish_aboveground','divide_reestablish_belowground','cultivate_prepare',
             'harvest_collect','irrigate_water','mow_cut','inspect_assess'
           ) and task.task_type not in ('inventory','administrative','network')
             then 'outdoor'
           when lower(coalesce(task.task_type,'')) in ('sowing','transplanting','weeding','mowing','watering','harvest')
             then 'outdoor'
           else 'either'
         end
  into v_task_id,v_environment
  from atlas.owner_week_projection projection
  join atlas.tasks task
    on projection.source_kind='floating_task'
   and task.id=projection.source_id
  join atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_day) presented
    on presented.task_id=task.id
   and presented.presentation_state='presented'
  where projection.farm_id=p_farm_id
    and projection.membership_id=p_membership_id
    and projection.planned_date=v_day
    and task.status='open'
    and task.due_date is null
    and (p_allow_outdoor or (
      case
        when lower(coalesce(task.metadata->>'environment','')) in ('indoor','outdoor','either')
          then lower(task.metadata->>'environment')
        when task.operation_class in (
          'establish_aboveground','divide_reestablish_belowground','cultivate_prepare',
          'harvest_collect','irrigate_water','mow_cut','inspect_assess'
        ) and task.task_type not in ('inventory','administrative','network')
          then 'outdoor'
        when lower(coalesce(task.task_type,'')) in ('sowing','transplanting','weeding','mowing','watering','harvest')
          then 'outdoor'
        else 'either'
      end
    )<>'outdoor')
  order by projection.plan_order,projection.created_at,projection.id
  limit 1;

  if v_task_id is not null then
    return jsonb_build_object(
      'contractVersion','paid_work_conveyor_v1',
      'state','current_floating_serving_exists',
      'serviceDate',v_day,
      'taskId',v_task_id,
      'sourceKind','floating_task',
      'environment',v_environment
    );
  end if;

  -- Same-day refill: any already-presented undated floating paid task is preferable
  -- to manufacturing another task. Serial queues, rhythm work, personal work, and
  -- project-materialized tasks are deliberately excluded.
  select task.id,
         case
           when lower(coalesce(task.metadata->>'environment','')) in ('indoor','outdoor','either')
             then lower(task.metadata->>'environment')
           when task.operation_class in (
             'establish_aboveground','divide_reestablish_belowground','cultivate_prepare',
             'harvest_collect','irrigate_water','mow_cut','inspect_assess'
           ) and task.task_type not in ('inventory','administrative','network')
             then 'outdoor'
           when lower(coalesce(task.task_type,'')) in ('sowing','transplanting','weeding','mowing','watering','harvest')
             then 'outdoor'
           else 'either'
         end
  into v_task_id,v_environment
  from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_day) presented
  join atlas.tasks task on task.id=presented.task_id
  where presented.presentation_state='presented'
    and task.status='open'
    and task.due_date is null
    and task.assigned_membership_id=p_membership_id
    and task.task_scope='farm_operation'
    and task.parent_task_id is null
    and nullif(task.metadata->>'project_pull_item_id','') is null
    and task.work_lane='discretionary'
    and task.commitment_kind='floating'
    and coalesce((task.metadata->>'personal_task')::boolean,false)=false
    and lower(coalesce(task.metadata->>'paid_work','true')) not in ('false','no','0')
    and not exists (
      select 1 from atlas.task_release_queue_items queue_item
      where queue_item.farm_id=task.farm_id
        and queue_item.state in ('active','queued')
        and (
          queue_item.task_id=task.id
          or (task.planned_occurrence_id is not null and queue_item.planned_occurrence_id=task.planned_occurrence_id)
        )
    )
    and (p_allow_outdoor or (
      case
        when lower(coalesce(task.metadata->>'environment','')) in ('indoor','outdoor','either')
          then lower(task.metadata->>'environment')
        when task.operation_class in (
          'establish_aboveground','divide_reestablish_belowground','cultivate_prepare',
          'harvest_collect','irrigate_water','mow_cut','inspect_assess'
        ) and task.task_type not in ('inventory','administrative','network')
          then 'outdoor'
        when lower(coalesce(task.task_type,'')) in ('sowing','transplanting','weeding','mowing','watering','harvest')
          then 'outdoor'
        else 'either'
      end
    )<>'outdoor')
  order by presented.lane_order,presented.selection_rank,task.created_at,task.id
  limit 1;

  if v_task_id is not null then
    insert into atlas.owner_week_projection(
      farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason,plan_order
    )
    select
      p_farm_id,p_membership_id,v_day,'floating_task',task.id,task.title,
      case when v_environment='outdoor' then 'flexible' else 'planned' end,
      v_environment,capacity.expected_active_minutes,
      'Same-day general paid-work reservoir serving · existing undated Atlas task · task date remains unchanged',
      coalesce((
        select max(plan_order)+1
        from atlas.owner_week_projection
        where farm_id=p_farm_id and membership_id=p_membership_id and planned_date=v_day
      ),700)
    from atlas.tasks task
    cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity
    where task.id=v_task_id
    on conflict do nothing;

    return jsonb_build_object(
      'contractVersion','paid_work_conveyor_v1',
      'state','adopted_floating_serving',
      'serviceDate',v_day,
      'taskId',v_task_id,
      'sourceKind','floating_task',
      'environment',v_environment
    );
  end if;

  -- Finish Elm remains a delegated reservoir. Its own enabled/presence gate stays
  -- authoritative, so an off-site hold cannot leak project work back into the day.
  v_project_result:=atlas.deal_next_paid_project_work_v1(
    p_farm_id,p_membership_id,v_day,p_allow_outdoor
  );

  return jsonb_build_object(
    'contractVersion','paid_work_conveyor_v1',
    'state',coalesce(v_project_result->>'state','no_fitting_paid_work'),
    'serviceDate',v_day,
    'taskId',v_project_result->>'taskId',
    'sourceKind',case when v_project_result->>'taskId' is not null then 'project_pull' else null end,
    'delegate',v_project_result
  );
end;
$function$;

revoke all on function atlas.deal_next_paid_work_v1(uuid,uuid,date,boolean) from public, anon;
grant execute on function atlas.deal_next_paid_work_v1(uuid,uuid,date,boolean) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.deal_next_paid_work_v1(uuid,uuid,date,boolean)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'feature','general_paid_work_reservoir_v1',
    'authorization','member or farm owner; service role permitted',
    'reviewed_date','2026-08-08',
    'release_behavior','reuses eligible undated floating tasks before delegating to one enabled Finish Elm project serving; serial/rhythm/queued work is excluded'
  ),now(),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
