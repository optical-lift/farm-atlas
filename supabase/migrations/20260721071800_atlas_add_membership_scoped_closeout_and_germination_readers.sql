create or replace function atlas.closeout_summary_source_v1(
  p_farm_id uuid,
  p_start_date date,
  p_end_date date
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
    select 1 from atlas.farm_memberships fm
    where fm.user_id = v_user_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date <= p_start_date then
    raise exception 'Valid closeout date bounds are required.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'logs', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.log_date desc, source_row.created_at desc)
      from (
        select fl.id, fl.log_date, fl.action_types, fl.summary_sentence,
               fl.note, fl.source, fl.metadata, fl.created_at
        from atlas.field_logs fl
        where fl.farm_id = p_farm_id
          and fl.log_date >= p_start_date
          and fl.log_date < p_end_date
        order by fl.log_date desc, fl.created_at desc
        limit 200
      ) source_row
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.event_date desc, source_row.id)
      from (
        select e.id, e.event_type, e.event_date, e.note, e.metadata
        from atlas.object_activity_events e
        where e.farm_id = p_farm_id
          and e.event_date >= p_start_date
          and e.event_date < p_end_date
        order by e.event_date desc
        limit 200
      ) source_row
    ), '[]'::jsonb),
    'taskOutcomes', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.created_at desc)
      from (
        select o.id, o.task_id, o.outcome, o.task_title, o.task_type,
               o.due_date, o.note, o.created_at
        from atlas.task_outcome_events o
        where o.farm_id = p_farm_id
          and o.created_at >= p_start_date::timestamptz
          and o.created_at < p_end_date::timestamptz
        order by o.created_at desc
        limit 300
      ) source_row
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.due_date nulls last, source_row.id)
      from (
        select t.id, t.title, t.task_type, t.status, t.due_date,
               t.completed_at, t.generated_from
        from atlas.tasks t
        where t.farm_id = p_farm_id
          and (
            t.due_date >= p_start_date
            or t.completed_at >= p_start_date::timestamptz
            or t.created_at >= p_start_date::timestamptz
          )
        order by t.due_date nulls last, t.created_at desc
        limit 300
      ) source_row
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function atlas.germination_check_source_v1(
  p_farm_id uuid,
  p_task_id uuid default null,
  p_task_title text default null
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
  v_profile atlas.crop_profiles%rowtype;
  v_object_id uuid;
  v_object_label text;
  v_object_key text;
  v_profile_id uuid;
  v_profile_key text;
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

  if p_task_id is not null then
    select * into v_task
    from atlas.tasks t
    where t.id = p_task_id
      and t.farm_id = p_farm_id
      and t.status in ('open', 'blocked');
  elsif nullif(btrim(p_task_title), '') is not null then
    select * into v_task
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.status in ('open', 'blocked')
      and t.title ilike btrim(p_task_title)
    order by t.due_date nulls last, t.created_at
    limit 1;
  else
    raise exception 'Task id or title is required.' using errcode = '22023';
  end if;

  if v_task.id is null then
    raise exception 'Germination check task was not found.' using errcode = 'P0002';
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

  select go.id, go.label, go.stable_key
    into v_object_id, v_object_label, v_object_key
  from atlas.task_objects t_o
  join atlas.growing_objects go on go.id = t_o.object_id
  where t_o.task_id = v_task.id
  order by go.sort_order nulls last, go.label
  limit 1;

  begin
    v_profile_id := nullif(v_task.metadata->>'crop_profile_id', '')::uuid;
  exception when invalid_text_representation then
    v_profile_id := null;
  end;
  v_profile_key := nullif(v_task.metadata->>'crop_profile_stable_key', '');

  if v_profile_id is not null then
    select * into v_profile from atlas.crop_profiles where id = v_profile_id;
  elsif v_profile_key is not null then
    select * into v_profile from atlas.crop_profiles where stable_key = v_profile_key order by created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'task_type', v_task.task_type,
      'status', v_task.status,
      'due_date', v_task.due_date,
      'priority', v_task.priority,
      'note', v_task.note,
      'metadata', v_task.metadata
    ),
    'object', jsonb_build_object(
      'objectId', v_object_id,
      'objectLabel', coalesce(v_object_label, 'Unassigned growing area'),
      'objectKey', v_object_key
    ),
    'profile', case when v_profile.id is null then null else jsonb_build_object(
      'id', v_profile.id,
      'stable_key', v_profile.stable_key,
      'crop_label', v_profile.crop_label,
      'variety', v_profile.variety,
      'days_to_germination_min', v_profile.days_to_germination_min,
      'days_to_germination_max', v_profile.days_to_germination_max,
      'days_to_harvest_watch_min', v_profile.days_to_harvest_watch_min,
      'days_to_harvest_watch_max', v_profile.days_to_harvest_watch_max,
      'metadata', v_profile.metadata
    ) end
  );
end;
$function$;

revoke all on function atlas.closeout_summary_source_v1(uuid, date, date) from public, anon;
revoke all on function atlas.germination_check_source_v1(uuid, uuid, text) from public, anon;
grant execute on function atlas.closeout_summary_source_v1(uuid, date, date) to authenticated;
grant execute on function atlas.germination_check_source_v1(uuid, uuid, text) to authenticated;
