create or replace function atlas.task_plant_contents_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_contents jsonb;
begin
  select t.* into v_task
  from atlas.tasks t
  where t.id = p_task_id;

  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  if not atlas.can_read_task_in_journal_v1(p_task_id) then
    raise exception 'This task is not available to the signed-in farm member.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'contentId', row.content_id,
      'objectId', row.object_id,
      'objectKey', row.object_key,
      'objectLabel', row.object_label,
      'contentLabel', row.content_label,
      'displayLabel', row.display_label,
      'variety', row.variety,
      'contentType', row.content_type,
      'status', row.status,
      'displayOrder', row.display_order
    ) order by row.display_order, row.display_label
  ), '[]'::jsonb)
  into v_contents
  from (
    select distinct on (oc.id)
      oc.id as content_id,
      go.id as object_id,
      go.stable_key as object_key,
      go.label as object_label,
      oc.content_label,
      case
        when lower(oc.content_label) = 'sunflower'
          and nullif(btrim(coalesce(oc.variety, '')), '') is not null
          then btrim(oc.variety) || ' sunflower'
        when lower(oc.content_label) in ('bearded iris', 'iris') then 'Iris'
        else oc.content_label
      end as display_label,
      oc.variety,
      oc.content_type,
      oc.status,
      case
        when coalesce(oc.metadata ->> 'display_order', '') ~ '^\d+$'
          then (oc.metadata ->> 'display_order')::integer
        else 999
      end as display_order
    from atlas.task_objects task_object
    join atlas.growing_objects go on go.id = task_object.object_id
    join atlas.object_contents oc on oc.object_id = go.id
    where task_object.task_id = p_task_id
      and lower(coalesce(oc.status, '')) not in ('cleared', 'archived', 'removed', 'failed')
    order by oc.id
  ) row;

  return jsonb_build_object('taskId', p_task_id, 'contents', v_contents);
end;
$$;

revoke all on function atlas.task_plant_contents_v1(uuid) from public;
grant execute on function atlas.task_plant_contents_v1(uuid) to authenticated, service_role;

do $$
declare
  v_farm_id uuid;
  v_object_id uuid;
  v_lemon_content_id uuid;
begin
  select f.id into v_farm_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  select go.id into v_object_id
  from atlas.growing_objects go
  where go.farm_id = v_farm_id
    and go.stable_key = 'eb_sunflower_7';

  if v_object_id is null then
    raise exception 'Entry Billboard Bed 7 was not found.' using errcode = 'P0002';
  end if;

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 10),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) = 'zinnia';

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 20),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) = 'sunflower';

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 30),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) = 'celosia';

  update atlas.object_contents
  set content_label = 'Iris',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 40),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) in ('bearded iris', 'iris');

  insert into atlas.object_contents(
    farm_id, object_id, content_label, content_type, status, confidence, metadata
  )
  select v_farm_id, v_object_id, 'Lemon balm', 'perennial', 'established', 'high',
         jsonb_build_object('display_order', 50, 'source', 'owner_ground_truth_20260729')
  where not exists (
    select 1 from atlas.object_contents oc
    where oc.object_id = v_object_id and lower(oc.content_label) = 'lemon balm'
  );

  select oc.id into v_lemon_content_id
  from atlas.object_contents oc
  where oc.object_id = v_object_id and lower(oc.content_label) = 'lemon balm'
  order by oc.created_at
  limit 1;

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 50),
      updated_at = now()
  where id = v_lemon_content_id;

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 60),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) = 'yarrow';

  update atlas.object_contents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('display_order', 70),
      updated_at = now()
  where object_id = v_object_id and lower(content_label) = 'salvia';

  update atlas.crop_cycles
  set crop_label = 'Iris', updated_at = now()
  where object_id = v_object_id and lower(crop_label) in ('bearded iris', 'iris');

  insert into atlas.crop_cycles(
    farm_id, object_id, object_content_id, crop_cycle_key, crop_label,
    cycle_state, lifecycle_status, metadata
  )
  select v_farm_id, v_object_id, v_lemon_content_id,
         'eb7_lemon_balm_established_20260729', 'Lemon balm',
         'established', 'active',
         jsonb_build_object('source', 'owner_ground_truth_20260729')
  where v_lemon_content_id is not null
    and not exists (
      select 1 from atlas.crop_cycles cc
      where cc.object_id = v_object_id
        and lower(cc.crop_label) = 'lemon balm'
        and cc.lifecycle_status = 'active'
    );

  update atlas.tasks t
  set note = null,
      metadata = (coalesce(t.metadata, '{}'::jsonb) - 'display_detail')
        || jsonb_build_object('hide_details', true, 'plant_contents_source', 'object_contents'),
      updated_at = now()
  where t.id in (
    select task_object.task_id
    from atlas.task_objects task_object
    where task_object.object_id = v_object_id
  )
    and t.action_key = 'weed'
    and t.status in ('open', 'blocked');
end;
$$;
