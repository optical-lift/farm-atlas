create or replace function atlas.reconcile_sowing_bed_subtasks_v1(p_parent_task_id uuid)
returns void
language plpgsql
security definer
set search_path = 'atlas', 'public'
as $function$
declare
  p atlas.tasks%rowtype;
  linked_count integer;
  child_id uuid;
  obj record;
begin
  select * into p from atlas.tasks where id = p_parent_task_id;
  if not found or p.parent_task_id is not null then return; end if;

  if p.status not in ('open', 'blocked') then
    return;
  end if;

  if lower(concat_ws(' ', p.task_type, p.action_key, p.metadata->>'work_route', p.metadata->>'display_action', p.title)) !~ '(sow|seed)' then
    return;
  end if;

  select count(*) into linked_count from atlas.task_objects where task_id = p.id;
  if linked_count <= 1 then return; end if;

  for obj in
    select go.id, go.label, go.sort_order
    from atlas.task_objects t_o
    join atlas.growing_objects go on go.id = t_o.object_id
    where t_o.task_id = p.id
    order by go.sort_order, go.label
  loop
    select t.id into child_id
    from atlas.tasks t
    where t.parent_task_id = p.id
      and t.generated_from = 'sowing_bed_checklist'
      and t.metadata->>'sowing_bed_object_id' = obj.id::text
    limit 1;

    if child_id is null then
      insert into atlas.tasks (
        farm_id, zone_id, title, task_type, status, priority, due_date,
        generated_from, generated_from_id, note, metadata, action_key,
        work_class, parent_task_id, task_series_key, engine_instance_key,
        updated_at
      ) values (
        p.farm_id,
        p.zone_id,
        'Checklist — ' || obj.label,
        'sowing_bed_checklist',
        case when p.status = 'blocked' then 'blocked' else 'open' end,
        p.priority,
        p.due_date,
        'sowing_bed_checklist',
        p.id,
        null,
        jsonb_build_object(
          'task_key', 'sowing_bed_checklist_' || p.id::text || '_' || obj.id::text,
          'checklist_label', obj.label,
          'display_action', 'Sow',
          'display_subject', obj.label,
          'display_detail', obj.label,
          'checklist_status', case when p.status = 'blocked' then 'blocked' else 'open' end,
          'is_child_task', true,
          'sowing_bed_subtask', true,
          'sowing_bed_object_id', obj.id::text,
          'target_object_id', obj.id::text,
          'crop_profile_id', p.metadata->>'crop_profile_id',
          'crop_profile_stable_key', p.metadata->>'crop_profile_stable_key',
          'seed_packet_name', coalesce(p.metadata->>'seed_packet_name', p.metadata->>'seed_variety', p.metadata->>'crop_variety', p.metadata->>'variety', p.metadata->>'crop_label', p.metadata->>'crop'),
          'assigned_to', p.metadata->>'assigned_to',
          'anna_task', coalesce(p.metadata->'anna_task', 'false'::jsonb),
          'collection_zone', coalesce(p.metadata->>'collection_zone', p.metadata->>'location_label'),
          'detail_lines', '[]'::jsonb
        ),
        'sow',
        coalesce(p.work_class, 'planting_sowing'),
        p.id,
        p.task_series_key,
        'sowing-bed:' || p.id::text || ':' || obj.id::text,
        now()
      )
      returning id into child_id;

      insert into atlas.task_objects (task_id, object_id, role)
      values (child_id, obj.id, 'target')
      on conflict do nothing;
    end if;
  end loop;

  update atlas.tasks c
  set status = 'archived',
      due_date = null,
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_reason', 'Bed no longer linked to parent sowing task',
        'archived_at', now()
      ),
      updated_at = now()
  where c.parent_task_id = p.id
    and c.generated_from = 'sowing_bed_checklist'
    and not exists (
      select 1 from atlas.task_objects pto
      where pto.task_id = p.id
        and pto.object_id::text = c.metadata->>'sowing_bed_object_id'
    )
    and c.status <> 'archived';
end;
$function$;

update atlas.tasks
set status = 'archived',
    due_date = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'checklist_status', 'archived',
      'archived_reason', 'Object links were added after the parent sowing work was already complete.',
      'archived_at', now(),
      'terminal_parent_cleanup_source', 'atlas_operational_audit_20260721'
    ),
    updated_at = now()
where id in (
  '84866e58-e704-4d6c-b09b-9ccd86bbc838'::uuid,
  '4c81c0ae-9484-43e9-b100-84735e02869c'::uuid,
  'c6376aaf-5a62-4d86-bf5e-739e5a2dbac4'::uuid
);
