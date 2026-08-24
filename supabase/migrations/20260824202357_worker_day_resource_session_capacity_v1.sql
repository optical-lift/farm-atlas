update atlas.resources r
set metadata = coalesce(r.metadata,'{}'::jsonb) || jsonb_build_object(
  'worker_day_session_contract','resource_day_session_v1',
  'worker_day_session_capacity',1
),
updated_at = now()
where r.stable_key='battery_push_mower_battery_set'
  and coalesce(r.metadata->>'resource_role','')='reusable_energy_set';

update atlas.rhythm_rules rr
set failure_consequence = jsonb_set(
      jsonb_set(
        rr.failure_consequence,
        '{dueTask,metadata}',
        coalesce(rr.failure_consequence#>'{dueTask,metadata}','{}'::jsonb) || jsonb_build_object(
          'required_resource_keys',jsonb_build_array('battery_push_mower_battery_set'),
          'battery_resource_key','battery_push_mower_battery_set',
          'resource_session_group_key',case rr.rule_key
            when 'elm_mowing_follow_me_paths_edges' then 'mowing_follow_me_curve_shared'
            when 'elm_mowing_curve_garden_edges' then 'mowing_follow_me_curve_shared'
            when 'elm_mowing_field_rows_front_half' then 'mowing_field_rows_front_half'
            when 'elm_mowing_field_rows_back_half' then 'mowing_field_rows_back_half'
          end
        ),
        true
      ),
      '{failureTask,metadata}',
      coalesce(rr.failure_consequence#>'{failureTask,metadata}','{}'::jsonb) || jsonb_build_object(
        'required_resource_keys',jsonb_build_array('battery_push_mower_battery_set'),
        'battery_resource_key','battery_push_mower_battery_set',
        'resource_session_group_key',case rr.rule_key
          when 'elm_mowing_follow_me_paths_edges' then 'mowing_follow_me_curve_shared'
          when 'elm_mowing_curve_garden_edges' then 'mowing_follow_me_curve_shared'
          when 'elm_mowing_field_rows_front_half' then 'mowing_field_rows_front_half'
          when 'elm_mowing_field_rows_back_half' then 'mowing_field_rows_back_half'
        end
      ),
      true
    ),
    updated_at = now()
where rr.rule_key in (
  'elm_mowing_follow_me_paths_edges',
  'elm_mowing_curve_garden_edges',
  'elm_mowing_field_rows_front_half',
  'elm_mowing_field_rows_back_half'
)
  and rr.status='active';

update atlas.tasks t
set metadata = coalesce(t.metadata,'{}'::jsonb) || jsonb_build_object(
      'resource_session_group_key',coalesce(
        nullif(t.metadata->>'resource_session_group_key',''),
        nullif(t.metadata->>'mowing_route_key',''),
        nullif(t.metadata->>'canonical_collection_member_key',''),
        nullif(t.metadata->>'collection_member_key',''),
        nullif(t.engine_instance_key,''),
        'task:'||t.id::text
      )
    ),
    updated_at = now()
where t.status='open'
  and (
    t.metadata->>'battery_resource_key'='battery_push_mower_battery_set'
    or coalesce(t.metadata->'required_resource_keys','[]'::jsonb) ? 'battery_push_mower_battery_set'
    or exists(
      select 1
      from atlas.task_resource_requirements trr
      join atlas.resources r on r.id=trr.resource_id
      where trr.task_id=t.id
        and r.stable_key='battery_push_mower_battery_set'
    )
  );

create or replace function atlas.worker_day_resource_session_claims_v1(p_task_id uuid)
returns table(
  resource_id uuid,
  resource_key text,
  resource_label text,
  session_group_key text,
  session_capacity integer
)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  with task_row as (
    select t.id,t.farm_id,t.engine_instance_key,coalesce(t.metadata,'{}'::jsonb) as metadata
    from atlas.tasks t
    where t.id=p_task_id
  )
  select distinct
    r.id,
    r.stable_key,
    r.label,
    coalesce(
      nullif(t.metadata->>'resource_session_group_key',''),
      nullif(t.metadata->>'mowing_route_key',''),
      nullif(t.metadata->>'canonical_collection_member_key',''),
      nullif(t.metadata->>'collection_member_key',''),
      nullif(t.engine_instance_key,''),
      'task:'||t.id::text
    ) as session_group_key,
    (r.metadata->>'worker_day_session_capacity')::integer as session_capacity
  from task_row t
  join atlas.resources r on r.farm_id=t.farm_id
  where coalesce(r.metadata->>'worker_day_session_contract','')='resource_day_session_v1'
    and coalesce(r.metadata->>'worker_day_session_capacity','') ~ '^[1-9][0-9]*$'
    and (
      exists(
        select 1
        from atlas.task_resource_requirements trr
        where trr.task_id=t.id and trr.resource_id=r.id
      )
      or (
        jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
        and coalesce(t.metadata->'required_resource_keys','[]'::jsonb) ? r.stable_key
      )
    );
$function$;

revoke all on function atlas.worker_day_resource_session_claims_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.worker_day_resource_session_claims_v1(uuid) to service_role;

create or replace function atlas.worker_day_resource_session_availability_v1(
  p_task_id uuid,
  p_membership_id uuid,
  p_service_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_claim record;
  v_existing_group_count integer:=0;
  v_same_group_present boolean:=false;
  v_existing_groups jsonb:='[]'::jsonb;
  v_claims jsonb:='[]'::jsonb;
  v_conflicts jsonb:='[]'::jsonb;
  v_allowed boolean:=true;
begin
  if p_task_id is null or p_membership_id is null or p_service_date is null then
    return jsonb_build_object(
      'contractVersion','worker_day_resource_session_availability_v1',
      'allowed',false,
      'reason','task_membership_and_service_date_required',
      'claims','[]'::jsonb,
      'conflicts','[]'::jsonb
    );
  end if;

  for v_claim in
    select * from atlas.worker_day_resource_session_claims_v1(p_task_id)
  loop
    v_existing_group_count:=0;
    v_same_group_present:=false;
    v_existing_groups:='[]'::jsonb;

    select
      count(distinct existing_claim.session_group_key)::integer,
      coalesce(bool_or(existing_claim.session_group_key=v_claim.session_group_key),false),
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'taskId',placement.task_id,
        'sessionGroupKey',existing_claim.session_group_key
      )),'[]'::jsonb)
    into v_existing_group_count,v_same_group_present,v_existing_groups
    from atlas.worker_day_task_placements placement
    cross join lateral atlas.worker_day_resource_session_claims_v1(placement.task_id) existing_claim
    where placement.membership_id=p_membership_id
      and placement.service_date=p_service_date
      and placement.state='placed'
      and placement.task_id<>p_task_id
      and existing_claim.resource_id=v_claim.resource_id;

    v_claims:=v_claims||jsonb_build_array(jsonb_build_object(
      'resourceId',v_claim.resource_id,
      'resourceKey',v_claim.resource_key,
      'resourceLabel',v_claim.resource_label,
      'sessionGroupKey',v_claim.session_group_key,
      'sessionCapacity',v_claim.session_capacity,
      'existingSessionGroupCount',v_existing_group_count,
      'sameSessionGroupPresent',v_same_group_present
    ));

    if not v_same_group_present and v_existing_group_count>=v_claim.session_capacity then
      v_allowed:=false;
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
        'resourceId',v_claim.resource_id,
        'resourceKey',v_claim.resource_key,
        'resourceLabel',v_claim.resource_label,
        'sessionGroupKey',v_claim.session_group_key,
        'sessionCapacity',v_claim.session_capacity,
        'existingSessions',v_existing_groups
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','worker_day_resource_session_availability_v1',
    'taskId',p_task_id,
    'membershipId',p_membership_id,
    'serviceDate',p_service_date,
    'allowed',v_allowed,
    'claims',v_claims,
    'conflicts',v_conflicts,
    'truthBoundary',jsonb_build_object(
      'resourceSessionCapacityIsSchedulingCapacity',true,
      'sameSessionGroupMayShareOneResourceSession',true,
      'differentSessionGroupsConsumeSeparateCapacity',true,
      'resourceReadinessRemainsSeparateFromSessionCapacity',true
    )
  );
end;
$function$;

revoke all on function atlas.worker_day_resource_session_availability_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_day_resource_session_availability_v1(uuid,uuid,date) to service_role;

create or replace function atlas.worker_day_validate_resource_session_capacity_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_contract jsonb;
begin
  if new.state<>'placed' then return new; end if;
  if new.task_id is null or new.membership_id is null or new.service_date is null then return new; end if;

  if tg_op='UPDATE'
     and new.state is not distinct from old.state
     and new.task_id is not distinct from old.task_id
     and new.membership_id is not distinct from old.membership_id
     and new.service_date is not distinct from old.service_date then
    return new;
  end if;

  v_contract:=atlas.worker_day_resource_session_availability_v1(
    new.task_id,new.membership_id,new.service_date
  );

  if not coalesce((v_contract->>'allowed')::boolean,true) then
    raise exception 'Worker Day resource-session capacity exceeded on %: %',
      new.service_date,
      coalesce(v_contract->'conflicts','[]'::jsonb)::text
      using errcode='55000';
  end if;

  return new;
end;
$function$;

revoke all on function atlas.worker_day_validate_resource_session_capacity_v1() from public,anon,authenticated;
grant execute on function atlas.worker_day_validate_resource_session_capacity_v1() to service_role;

do $block$
begin
  if exists(
    select 1
    from atlas.worker_day_task_placements placement
    cross join lateral atlas.worker_day_resource_session_claims_v1(placement.task_id) claim
    where placement.state='placed'
    group by placement.farm_id,placement.membership_id,placement.service_date,claim.resource_id,claim.session_capacity
    having count(distinct claim.session_group_key)>claim.session_capacity
  ) then
    raise exception 'Existing Worker Day placements violate resource-session capacity; migration aborted.' using errcode='55000';
  end if;
end;
$block$;

drop trigger if exists worker_day_resource_session_capacity_v1 on atlas.worker_day_task_placements;
create trigger worker_day_resource_session_capacity_v1
before insert or update of task_id,membership_id,farm_id,service_date,state
on atlas.worker_day_task_placements
for each row execute function atlas.worker_day_validate_resource_session_capacity_v1();