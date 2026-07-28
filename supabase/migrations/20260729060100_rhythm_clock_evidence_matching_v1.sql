create or replace function atlas.rhythm_touch_matches_workflow_v1(
  p_touch jsonb,
  p_workflow_event_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.workflow_events%rowtype;
  v_task atlas.tasks%rowtype;
  v_source_kinds jsonb;
  v_source_events jsonb;
begin
  if jsonb_typeof(coalesce(p_touch, '{}'::jsonb)) <> 'object' then
    return false;
  end if;

  select * into v_event
  from atlas.workflow_events
  where id = p_workflow_event_id;

  if v_event.id is null then
    return false;
  end if;

  if v_event.source_kind = 'task' then
    select * into v_task from atlas.tasks where id = v_event.source_id;
  end if;

  v_source_kinds := p_touch -> 'sourceKinds';
  v_source_events := p_touch -> 'sourceEvents';

  if p_touch ? 'sourceKind' and lower(p_touch ->> 'sourceKind') <> lower(v_event.source_kind) then
    return false;
  end if;
  if jsonb_typeof(v_source_kinds) = 'array' and not exists (
    select 1 from jsonb_array_elements_text(v_source_kinds) value
    where lower(value) = lower(v_event.source_kind)
  ) then
    return false;
  end if;

  if p_touch ? 'sourceEvent' and lower(p_touch ->> 'sourceEvent') <> lower(v_event.source_event) then
    return false;
  end if;
  if jsonb_typeof(v_source_events) = 'array' and not exists (
    select 1 from jsonb_array_elements_text(v_source_events) value
    where lower(value) = lower(v_event.source_event)
  ) then
    return false;
  end if;

  if p_touch ? 'taskType' and coalesce(v_task.task_type, '') <> p_touch ->> 'taskType' then
    return false;
  end if;
  if p_touch ? 'actionKey' and coalesce(
      v_task.action_key,
      v_event.payload #>> '{metadata,action_key}',
      ''
    ) <> p_touch ->> 'actionKey' then
    return false;
  end if;
  if p_touch ? 'workClass' and coalesce(
      v_task.work_class,
      v_event.payload #>> '{metadata,work_class}',
      ''
    ) <> p_touch ->> 'workClass' then
    return false;
  end if;
  if p_touch ? 'payloadContains'
     and jsonb_typeof(p_touch -> 'payloadContains') = 'object'
     and not (v_event.payload @> (p_touch -> 'payloadContains')) then
    return false;
  end if;

  -- A touch policy may not use task titles or an empty wildcard as evidence.
  -- At least one explicit canonical identity must be present.
  if p_touch ? 'taskTitle' or p_touch ? 'titleContains' then
    return false;
  end if;
  if not (
    p_touch ? 'sourceKind'
    or p_touch ? 'sourceKinds'
    or p_touch ? 'sourceEvent'
    or p_touch ? 'sourceEvents'
    or p_touch ? 'taskType'
    or p_touch ? 'actionKey'
    or p_touch ? 'workClass'
    or p_touch ? 'payloadContains'
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function atlas.rhythm_touch_matches_workflow_v1(jsonb, uuid)
  from public, anon, authenticated;

create or replace function atlas.rhythm_workflow_subjects_v1(p_workflow_event_id uuid)
returns table(subject_kind text, subject_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with w as (
    select * from atlas.workflow_events where id = p_workflow_event_id
  ), direct_subjects as (
    select 'farm'::text as subject_kind, w.farm_id as subject_id from w
    union all
    select 'growing_object', w.source_id from w where w.source_kind = 'object'
    union all
    select 'crop_cycle', w.source_id from w where w.source_kind = 'crop_cycle'
    union all
    select 'project', w.source_id from w where w.source_kind = 'project'
    union all
    select 'growing_object', mo.object_id
      from w join atlas.maintenance_objects mo on w.source_kind = 'maintenance' and mo.id = w.source_id
      where mo.object_id is not null
    union all
    select 'growing_object', task_object.object_id
      from w join atlas.task_objects task_object on w.source_kind = 'task' and task_object.task_id = w.source_id
    union all
    select 'crop_cycle', task_cycle.crop_cycle_id
      from w join atlas.task_crop_cycles task_cycle on w.source_kind = 'task' and task_cycle.task_id = w.source_id
    union all
    select 'growing_object', field_object.object_id
      from w join atlas.field_log_objects field_object on w.source_kind = 'field_log' and field_object.field_log_id = w.source_id
      where field_object.object_id is not null
  ), expanded as (
    select * from direct_subjects
    union all
    select 'growing_object', cc.object_id
      from direct_subjects ds join atlas.crop_cycles cc
        on ds.subject_kind = 'crop_cycle' and cc.id = ds.subject_id
      where cc.object_id is not null
    union all
    select 'zone', go.zone_id
      from direct_subjects ds join atlas.growing_objects go
        on ds.subject_kind = 'growing_object' and go.id = ds.subject_id
      where go.zone_id is not null
    union all
    select 'zone', t.zone_id
      from w join atlas.tasks t on w.source_kind = 'task' and t.id = w.source_id
      where t.zone_id is not null
    union all
    select 'zone', flo.zone_id
      from w join atlas.field_log_objects flo on w.source_kind = 'field_log' and flo.field_log_id = w.source_id
      where flo.zone_id is not null
  )
  select distinct e.subject_kind::text, e.subject_id::uuid
  from expanded e
  where e.subject_id is not null;
$$;

revoke all on function atlas.rhythm_workflow_subjects_v1(uuid)
  from public, anon, authenticated;
