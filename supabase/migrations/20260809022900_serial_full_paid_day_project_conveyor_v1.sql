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
    and coalesce((p.metadata->>'daily_pull_enabled')::boolean,false)
  limit 1;

  if v_project.id is null then
    return jsonb_build_object('contractVersion','paid_project_conveyor_v1','state','no_enabled_project','serviceDate',v_day,'taskId',null);
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
        'Same-day full paid-day refill · added after the planned project sequence was exhausted',
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
    'Automatically dealt from the Owner full paid-day plan. Only one actionable project serving is released at a time.'
  );

  return jsonb_build_object(
    'contractVersion','paid_project_conveyor_v1',
    'state','dealt',
    'serviceDate',v_day,
    'taskId',v_result->>'taskId',
    'projectItemId',v_candidate.item_id,
    'planOrder',v_candidate.plan_order,
    'remainingPaidMinutesBeforeDeal',v_remaining,
    'expectedActiveMinutes',v_candidate.expected_active_minutes
  );
end;
$function$;

revoke all on function atlas.deal_next_paid_project_work_v1(uuid,uuid,date,boolean) from public,anon;
grant execute on function atlas.deal_next_paid_project_work_v1(uuid,uuid,date,boolean) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.deal_next_paid_project_work_v1(uuid,uuid,date,boolean)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'feature','full_paid_day_project_conveyor_v1',
    'authorization','member or farm owner; service role permitted',
    'release_behavior','materializes at most one open project serving; future dates remain projection-only',
    'reviewed_date','2026-08-08'
  ),now()
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;

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
      perform atlas.deal_next_paid_project_work_v1(new.farm_id,v_membership_id,v_service_date,true);
    exception when others then
      raise warning 'Could not deal next paid project serving after task %: %',new.id,sqlerrm;
    end;
  end if;

  return new;
end;
$function$;
