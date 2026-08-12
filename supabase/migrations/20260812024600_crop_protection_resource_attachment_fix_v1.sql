-- Follow-up schema alignment for the crop-protection layer. Resource requirements
-- belong to the task and resource; farm identity is inherited through those rows.
-- Use the canonical requirement-source and move-role vocabularies already enforced
-- by task_resource_requirements.

create or replace function atlas.attach_crop_protection_task_resources_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_policy atlas.crop_protection_policies%rowtype;
begin
  if nullif(new.metadata->>'crop_protection_policy_id','') is null then return new; end if;

  select * into v_policy
  from atlas.crop_protection_policies
  where id=(new.metadata->>'crop_protection_policy_id')::uuid;

  if v_policy.id is null then return new; end if;

  insert into atlas.task_resource_requirements(
    task_id,resource_id,requirement_role,requirement_source,
    quantity_needed,unit,status,move_role,note,metadata
  )
  select
    new.id,
    candidate.resource_id,
    'required',
    'system_generated',
    null,
    null,
    case when resource.status='available' then 'available' else 'needs_check' end,
    candidate.move_role,
    null,
    jsonb_build_object(
      'policy_id',v_policy.id,
      'worker_required',true,
      'crop_protection_role',candidate.protection_role
    )
  from (values
    (v_policy.concentrate_resource_id,'material'::text,'treatment'),
    (v_policy.applicator_resource_id,'equipment'::text,'applicator')
  ) candidate(resource_id,move_role,protection_role)
  join atlas.resources resource on resource.id=candidate.resource_id
  where candidate.resource_id is not null
    and not exists(
      select 1
      from atlas.task_resource_requirements existing
      where existing.task_id=new.id
        and existing.resource_id=candidate.resource_id
        and existing.requirement_source='system_generated'
        and existing.metadata->>'policy_id'=v_policy.id::text
    );

  return new;
end;
$function$;

revoke all on function atlas.attach_crop_protection_task_resources_v1() from public,anon,authenticated;
grant execute on function atlas.attach_crop_protection_task_resources_v1() to service_role;

-- Green observations are evidence, not a repeated event every time the enrollment
-- reconciler runs. Preserve at most one green-confirmation event per observation.
create unique index if not exists crop_protection_green_observation_event_uidx
  on atlas.crop_protection_events(enrollment_id,((metadata->>'observation_id')))
  where event_kind='green_confirmed' and nullif(metadata->>'observation_id','') is not null;
