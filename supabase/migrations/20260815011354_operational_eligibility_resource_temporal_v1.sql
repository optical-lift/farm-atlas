create or replace function atlas.task_required_resources_available_v1(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog','atlas'
as $$
  select coalesce((
    select
      not exists (
        select 1
        from atlas.task_resource_requirements requirement
        left join atlas.resources resource on resource.id=requirement.resource_id
        where requirement.task_id=task.id
          and requirement.requirement_role='required'
          and (resource.id is null or resource.status <> 'available')
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(task.metadata->'required_resource_keys','[]'::jsonb))='array'
              then coalesce(task.metadata->'required_resource_keys','[]'::jsonb)
            else '[]'::jsonb
          end
        ) wanted(stable_key)
        left join atlas.resources resource
          on resource.farm_id=task.farm_id
         and resource.stable_key=wanted.stable_key
        where resource.id is null or resource.status <> 'available'
      )
    from atlas.tasks task
    where task.id=p_task_id
  ),false)
$$;

revoke all on function atlas.task_required_resources_available_v1(uuid) from public, anon;
grant execute on function atlas.task_required_resources_available_v1(uuid) to authenticated, service_role;

create or replace function atlas.task_temporally_eligible_v1(p_task_id uuid,p_service_date date)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog','atlas'
as $$
  select coalesce((
    select case
      when task.metadata->>'temporal_gate_kind'='not_before'
        and nullif(task.metadata->>'temporal_not_before_date','') is not null
      then p_service_date >= (task.metadata->>'temporal_not_before_date')::date
      else true
    end
    from atlas.tasks task
    where task.id=p_task_id
  ),false)
$$;

revoke all on function atlas.task_temporally_eligible_v1(uuid,date) from public, anon;
grant execute on function atlas.task_temporally_eligible_v1(uuid,date) to authenticated, service_role;

create or replace function atlas.sync_task_required_resource_keys_v1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','atlas'
as $$
begin
  delete from atlas.task_resource_requirements requirement
  where requirement.task_id=new.id
    and requirement.requirement_source='system_generated'
    and coalesce(requirement.metadata->>'source','')='task_required_resource_keys_v1';

  if jsonb_typeof(coalesce(new.metadata->'required_resource_keys','[]'::jsonb))='array' then
    insert into atlas.task_resource_requirements(
      task_id,resource_id,requirement_role,requirement_source,status,note,metadata,created_at,updated_at
    )
    select new.id,resource.id,'required','system_generated',
      case when resource.status='available' then 'available' else 'needed' end,
      'Required by canonical task resource key.',
      jsonb_build_object('source','task_required_resource_keys_v1','resource_key',resource.stable_key),
      now(),now()
    from (
      select distinct value as stable_key
      from jsonb_array_elements_text(coalesce(new.metadata->'required_resource_keys','[]'::jsonb)) key(value)
      where nullif(btrim(value),'') is not null
    ) wanted
    join atlas.resources resource
      on resource.farm_id=new.farm_id
     and resource.stable_key=wanted.stable_key;
  end if;
  return new;
end;
$$;

revoke all on function atlas.sync_task_required_resource_keys_v1() from public, anon, authenticated;

drop trigger if exists tasks_sync_required_resource_keys_v1 on atlas.tasks;
create trigger tasks_sync_required_resource_keys_v1
after insert or update of metadata,farm_id on atlas.tasks
for each row execute function atlas.sync_task_required_resource_keys_v1();

create or replace function atlas.sync_generated_resource_requirement_status_v1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','atlas'
as $$
begin
  if new.status is distinct from old.status then
    update atlas.task_resource_requirements requirement
    set status=case when new.status='available' then 'available' else 'needed' end,
        updated_at=now()
    where requirement.resource_id=new.id
      and requirement.requirement_role='required'
      and requirement.requirement_source='system_generated'
      and coalesce(requirement.metadata->>'source','')='task_required_resource_keys_v1';
  end if;
  return new;
end;
$$;

revoke all on function atlas.sync_generated_resource_requirement_status_v1() from public, anon, authenticated;

drop trigger if exists resources_sync_generated_requirement_status_v1 on atlas.resources;
create trigger resources_sync_generated_requirement_status_v1
after update of status on atlas.resources
for each row execute function atlas.sync_generated_resource_requirement_status_v1();

-- Normalize rider-mower tasks into the generic resource-key contract. Field Rows
-- front/back are intentionally excluded because those halves are push-mowed.
update atlas.tasks task
set metadata=jsonb_set(
      coalesce(task.metadata,'{}'::jsonb),
      '{required_resource_keys}',
      coalesce((
        select jsonb_agg(distinct key order by key)
        from (
          select jsonb_array_elements_text(
            case when jsonb_typeof(coalesce(task.metadata->'required_resource_keys','[]'::jsonb))='array'
              then coalesce(task.metadata->'required_resource_keys','[]'::jsonb)
              else '[]'::jsonb end
          ) as key
          union all select 'cub_cadet_lawn_mower'
        ) keys
      ),'[]'::jsonb),true
    ) || jsonb_build_object('resource_gate_version','required_resource_keys_v1'),
    updated_at=now()
where task.task_type='mowing'
  and coalesce(task.metadata->>'mowing_route_key','') not in ('mowing_field_rows_front_half','mowing_field_rows_back_half')
  and (
    lower(coalesce(task.metadata->>'equipment_group','')) in ('riding_mower','riding mower')
    or lower(coalesce(task.metadata->>'equipment_required',''))='riding mower'
  );

update atlas.growing_objects
set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{equipment_group}',to_jsonb('battery_push_mower'::text),true)
  || jsonb_build_object('equipment_truth_reason','Owner-established Field Rows front/back halves are push mowing, not riding mowing.'),
  updated_at=now()
where stable_key in ('mowing_field_rows_front_half','mowing_field_rows_back_half');

update atlas.rhythm_rules
set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{equipmentGroup}',to_jsonb('battery_push_mower'::text),true)
  || jsonb_build_object('equipmentTruthReason','Owner-established Field Rows front/back halves are push mowing, not riding mowing.'),
  updated_at=now()
where rule_key in ('elm_mowing_field_rows_front_half','elm_mowing_field_rows_back_half')
  and status='active';

-- Existing rider work blocked only because the mower broke becomes canonically open;
-- resource availability now owns executability and does not mutate due dates.
update atlas.tasks
set status='open',blocker_text=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'resource_gate_managed',true,
      'resource_gate_normalized_at',now(),
      'resource_gate_normalized_reason','Equipment availability now controls executability without rewriting the task schedule.'
    ),updated_at=now()
where status='blocked'
  and task_type='mowing'
  and (
    lower(coalesce(metadata->>'equipment_group','')) in ('riding_mower','riding mower')
    or lower(coalesce(metadata->>'equipment_required',''))='riding mower'
  )
  and lower(coalesce(metadata->'last_transition'->>'transition',''))='blocked'
  and lower(coalesce(metadata->'last_transition'->>'note',metadata->'last_transition'->>'reason','')) in ('it broke','mower broke','riding mower broke');

-- Legacy waiting_until rows become explicit not-before eligibility. Temporal waiting
-- no longer owns task status, so passing the date needs no wake-up mutation.
update atlas.tasks
set status='open',blocker_text=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'temporal_gate_kind','not_before',
      'temporal_not_before_date',metadata->>'waiting_until',
      'temporal_gate_reason',coalesce(metadata->>'waiting_on','not before date'),
      'temporal_gate_version','not_before_v1'
    ),updated_at=now()
where status in ('open','blocked')
  and nullif(metadata->>'waiting_until','') is not null
  and (metadata->>'waiting_until') ~ '^\d{4}-\d{2}-\d{2}$';

-- Patch all worker-presentation walls. Fail rather than partially applying if a
-- later function body has drifted.
do $patch$
declare d text; p text;
begin
  select pg_get_functiondef('atlas.owner_worker_day_plan_v1(uuid,uuid,date)'::regprocedure) into d;
  p:=replace(d,
    E'        and coalesce(t.visibility_scope,'''') <> ''system_internal''\n        and t.parent_task_id is null',
    E'        and coalesce(t.visibility_scope,'''') <> ''system_internal''\n        and atlas.task_temporally_eligible_v1(t.id,p_day)\n        and atlas.task_required_resources_available_v1(t.id)\n        and t.parent_task_id is null');
  if p=d then raise exception 'owner_worker_day_plan_v1 exact-date eligibility seam drifted'; end if;
  d:=p;
  p:=replace(d,
    E'      where t.status = ''open''\n        and coalesce(t.visibility_scope,'''') <> ''system_internal''',
    E'      where t.status = ''open''\n        and coalesce(t.visibility_scope,'''') <> ''system_internal''\n        and atlas.task_temporally_eligible_v1(t.id,p_day)\n        and atlas.task_required_resources_available_v1(t.id)');
  if p=d then raise exception 'owner_worker_day_plan_v1 carry eligibility seam drifted'; end if;
  execute p;

  select pg_get_functiondef('atlas.owner_worker_day_plan_choreographed_v1(uuid,uuid,date)'::regprocedure) into d;
  p:=replace(d,
    E'    and coalesce(task.visibility_scope,'''') <> ''system_internal''\n    and task.parent_task_id is null',
    E'    and coalesce(task.visibility_scope,'''') <> ''system_internal''\n    and atlas.task_temporally_eligible_v1(task.id,p_day)\n    and atlas.task_required_resources_available_v1(task.id)\n    and task.parent_task_id is null');
  if p=d then raise exception 'owner_worker_day_plan_choreographed_v1 eligibility seam drifted'; end if;
  execute p;

  select pg_get_functiondef('atlas.worker_day_operational_task_cards_v1(uuid,uuid,uuid[])'::regprocedure) into d;
  p:=replace(d,
    E'      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and (',
    E'      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and (task.status=''done'' or (atlas.task_temporally_eligible_v1(task.id,(now() at time zone ''America/Chicago'')::date) and atlas.task_required_resources_available_v1(task.id)))\n      and (');
  if p=d then raise exception 'worker_day_operational_task_cards_v1 eligibility seam drifted'; end if;
  execute p;

  select pg_get_functiondef('atlas.worker_day_operational_task_cards_v2(uuid,uuid,date,uuid[])'::regprocedure) into d;
  p:=replace(d,
    E'      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and (',
    E'      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and (task.status=''done'' or (atlas.task_temporally_eligible_v1(task.id,p_service_date) and atlas.task_required_resources_available_v1(task.id)))\n      and (');
  if p=d then raise exception 'worker_day_operational_task_cards_v2 eligibility seam drifted'; end if;
  execute p;
end $patch$;