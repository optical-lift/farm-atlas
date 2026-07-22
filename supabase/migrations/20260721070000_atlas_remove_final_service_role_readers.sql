create or replace function atlas.zone_registry_source_v1(
  p_farm_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = v_user_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'zones', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.sort_order nulls last, source_row.label)
      from (
        select z.id, z.stable_key, z.label, z.zone_type, z.mode_bias,
               z.goal_text, z.current_state, z.sort_order, z.metadata
        from atlas.zones z
        where z.farm_id = p_farm_id
      ) source_row
    ), '[]'::jsonb),
    'objects', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.sort_order nulls last, source_row.label)
      from (
        select go.id, go.zone_id, go.stable_key, go.label, go.object_type,
               go.object_mode, go.length_ft, go.width_ft, go.area_sqft,
               go.guest_visible, go.sort_order, go.metadata
        from atlas.growing_objects go
        where go.farm_id = p_farm_id
      ) source_row
    ), '[]'::jsonb),
    'contents', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.planted_date desc nulls last, source_row.id)
      from (
        select oc.id, oc.object_id, oc.content_label, oc.content_type, oc.variety,
               oc.planted_date, oc.status, oc.confidence, oc.start_method,
               oc.germinated_date, oc.pinch_required, oc.pinch_note,
               oc.bloom_start_date, oc.clear_bed_date, oc.next_crop_planned,
               oc.expected_germination_start, oc.expected_germination_end,
               oc.expected_harvest_watch_start, oc.expected_harvest_watch_end,
               oc.expected_clear_date, oc.note
        from atlas.object_contents oc
        join atlas.growing_objects go on go.id = oc.object_id
        where go.farm_id = p_farm_id
      ) source_row
    ), '[]'::jsonb),
    'cropCycles', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.sown_date desc nulls last, source_row.crop_cycle_id)
      from (
        select v.crop_cycle_id, v.object_id, v.crop_label, v.variety,
               v.cycle_state, v.lifecycle_status, v.sown_date, v.planted_date,
               v.germination_checked_date, v.expected_germination_start,
               v.expected_germination_end, v.harvest_started_date,
               v.last_harvest_date, v.cleared_date,
               v.expected_harvest_watch_start, v.expected_harvest_watch_end,
               v.expected_clear_date, v.crop_profile_stable_key,
               v.default_planting_method, v.note
        from atlas.v_crop_cycle_registry v
        where v.farm_id = p_farm_id
          and v.lifecycle_status = 'active'
      ) source_row
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.event_date, source_row.id)
      from (
        select e.id, e.object_id, e.object_content_id, e.event_type,
               e.event_date, e.note, e.metadata
        from atlas.object_activity_events e
        where e.farm_id = p_farm_id
      ) source_row
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function atlas.germination_history_source_v1(
  p_farm_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_role text;
  v_task atlas.tasks%rowtype;
  v_source atlas.tasks%rowtype;
  v_source_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  select fm.id, fm.role
    into v_membership_id, v_role
  from atlas.farm_memberships fm
  where fm.user_id = v_user_id
    and fm.farm_id = p_farm_id
    and fm.active = true
  limit 1;

  if v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select * into v_task
  from atlas.tasks t
  where t.id = p_task_id
    and t.farm_id = p_farm_id;

  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  if not (
    v_role = 'owner'
    or (v_role = 'manager' and v_task.visibility_scope in ('management', 'assigned_worker', 'farm_shared'))
    or (v_role = 'farm_hand' and (
      v_task.visibility_scope = 'farm_shared'
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_membership_id)
    ))
  ) then
    raise exception 'Task is outside this membership scope.' using errcode = '42501';
  end if;

  begin
    v_source_id := nullif(v_task.metadata->>'source_sowing_task_id', '')::uuid;
  exception when invalid_text_representation then
    v_source_id := null;
  end;

  if v_source_id is not null then
    select * into v_source
    from atlas.tasks t
    where t.id = v_source_id
      and t.farm_id = p_farm_id;
  end if;

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'task_type', v_task.task_type,
      'status', v_task.status,
      'due_date', v_task.due_date,
      'completed_at', v_task.completed_at,
      'created_at', v_task.created_at,
      'note', v_task.note,
      'metadata', v_task.metadata
    ),
    'sourceTask', case when v_source.id is null then null else jsonb_build_object(
      'id', v_source.id,
      'title', v_source.title,
      'task_type', v_source.task_type,
      'status', v_source.status,
      'due_date', v_source.due_date,
      'completed_at', v_source.completed_at,
      'created_at', v_source.created_at,
      'note', v_source.note,
      'metadata', v_source.metadata
    ) end
  );
end;
$function$;

revoke all on function atlas.zone_registry_source_v1(uuid) from public, anon;
revoke all on function atlas.germination_history_source_v1(uuid, uuid) from public, anon;
grant execute on function atlas.zone_registry_source_v1(uuid) to authenticated;
grant execute on function atlas.germination_history_source_v1(uuid, uuid) to authenticated;
