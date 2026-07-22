-- Keep object task counts current whenever linked task state changes, and expose
-- object state through the shared zone registry source.

create or replace function atlas.refresh_object_active_task_count_v1(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_farm_id uuid;
  v_count integer;
begin
  select go.farm_id
  into v_farm_id
  from atlas.growing_objects go
  where go.id = p_object_id;

  if v_farm_id is null then
    return;
  end if;

  select count(*)::integer
  into v_count
  from atlas.task_objects task_object
  join atlas.tasks task on task.id = task_object.task_id
  where task_object.object_id = p_object_id
    and task.status in ('open', 'blocked');

  insert into atlas.object_state (
    object_id,
    farm_id,
    active_task_count,
    metadata
  )
  values (
    p_object_id,
    v_farm_id,
    v_count,
    jsonb_build_object('task_count_synced_at', now())
  )
  on conflict (object_id) do update
  set active_task_count = excluded.active_task_count,
      metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
end;
$function$;

create or replace function atlas.sync_task_object_counts_from_task_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object_id uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  for v_object_id in
    select task_object.object_id
    from atlas.task_objects task_object
    where task_object.task_id = coalesce(new.id, old.id)
  loop
    perform atlas.refresh_object_active_task_count_v1(v_object_id);
  end loop;

  return coalesce(new, old);
end;
$function$;

create or replace function atlas.sync_task_object_counts_from_link_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform atlas.refresh_object_active_task_count_v1(old.object_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform atlas.refresh_object_active_task_count_v1(new.object_id);
  end if;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists sync_task_object_counts_from_task on atlas.tasks;
create trigger sync_task_object_counts_from_task
after update of status on atlas.tasks
for each row
execute function atlas.sync_task_object_counts_from_task_v1();

drop trigger if exists sync_task_object_counts_from_link on atlas.task_objects;
create trigger sync_task_object_counts_from_link
after insert or update of object_id or delete on atlas.task_objects
for each row
execute function atlas.sync_task_object_counts_from_link_v1();

create or replace function atlas.zone_registry_source_v1(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas, auth
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
               go.guest_visible, go.sort_order, go.metadata,
               os.life_status, os.presentability, os.active_task_count,
               os.decision_required, os.metadata as state_metadata
        from atlas.growing_objects go
        left join atlas.object_state os on os.object_id = go.id
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
