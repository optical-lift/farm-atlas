create or replace function atlas.sync_task_required_resource_keys_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
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
      case
        when state.resource_id is not null and state.readiness_state='ready' then 'available'
        when state.resource_id is not null and state.readiness_state='unknown' then 'needs_check'
        when state.resource_id is not null then 'needed'
        when resource.status='available' then 'available'
        when resource.status in ('unknown','needs_check') then 'needs_check'
        else 'needed'
      end,
      case
        when state.resource_id is not null and state.readiness_state='unknown'
          then 'Required resource readiness is unknown; verify before execution.'
        else 'Required by canonical task resource key.' end,
      jsonb_build_object(
        'source','task_required_resource_keys_v1','resource_key',resource.stable_key,
        'readiness_source',case when state.resource_id is not null then 'resource_operational_state' else 'legacy_resource_status' end
      ),
      now(),now()
    from (
      select distinct value as stable_key
      from jsonb_array_elements_text(coalesce(new.metadata->'required_resource_keys','[]'::jsonb)) key(value)
      where nullif(btrim(value),'') is not null
    ) wanted
    join atlas.resources resource
      on resource.farm_id=new.farm_id
     and resource.stable_key=wanted.stable_key
    left join atlas.resource_operational_state state on state.resource_id=resource.id;
  end if;
  return new;
end;
$$;

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb),updated_at=now()
where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and t.status in ('open','blocked')
  and jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
  and coalesce(t.metadata->'required_resource_keys','[]'::jsonb) ? 'battery_push_mower_battery_set';

comment on function atlas.sync_task_required_resource_keys_v1() is
'Canonical task resource-key synchronizer. OR2 preserves unknown modeled resource readiness as needs_check rather than fabricating a missing/acquisition condition.';