alter table atlas.field_logs
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  add column if not exists actor_role text,
  add column if not exists idempotency_key text;

alter table atlas.field_logs
  drop constraint if exists field_logs_actor_role_check;

alter table atlas.field_logs
  add constraint field_logs_actor_role_check
  check (actor_role is null or actor_role in ('owner', 'manager', 'farm_hand', 'system'));

create unique index if not exists field_logs_farm_idempotency_idx
on atlas.field_logs (farm_id, idempotency_key)
where idempotency_key is not null;

create index if not exists field_logs_actor_membership_date_idx
on atlas.field_logs (actor_membership_id, log_date desc, created_at desc)
where actor_membership_id is not null;

create or replace function atlas.record_quick_log_v1(
  p_farm_id uuid,
  p_log_date date,
  p_action_types text[],
  p_summary_sentence text,
  p_note text default null,
  p_zone_ids uuid[] default '{}'::uuid[],
  p_object_ids uuid[] default '{}'::uuid[],
  p_idempotency_key text default null
)
returns table (
  field_log_id uuid,
  actor_membership_id uuid,
  actor_role text,
  zone_link_count integer,
  object_link_count integer,
  replayed boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_role text;
  v_worker_key text;
  v_display_name text;
  v_actions text[];
  v_zone_ids uuid[];
  v_object_ids uuid[];
  v_log_id uuid;
  v_existing atlas.field_logs%rowtype;
  v_zone_count integer := 0;
  v_object_count integer := 0;
  v_has_weed boolean;
  v_has_water boolean;
  v_has_check boolean;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  select fm.id, fm.role, fm.worker_key, coalesce(up.display_name, fm.worker_key, fm.role)
  into v_membership_id, v_role, v_worker_key, v_display_name
  from atlas.farm_memberships fm
  left join atlas.user_profiles up on up.user_id = fm.user_id
  where fm.user_id = v_user_id
    and fm.farm_id = p_farm_id
    and fm.active = true
  limit 1;

  if v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if p_log_date is null or p_log_date < date '2000-01-01' or p_log_date > current_date + 1 then
    raise exception 'Quick Log date is outside the supported range.' using errcode = '22023';
  end if;

  if nullif(btrim(p_summary_sentence), '') is null
    or char_length(btrim(p_summary_sentence)) < 3
    or char_length(btrim(p_summary_sentence)) > 500
  then
    raise exception 'Quick Log summary must be 3 to 500 characters.' using errcode = '22023';
  end if;

  if p_note is not null and char_length(p_note) > 4000 then
    raise exception 'Quick Log note must not exceed 4000 characters.' using errcode = '22023';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null
    or char_length(btrim(p_idempotency_key)) < 8
    or char_length(btrim(p_idempotency_key)) > 120
  then
    raise exception 'Quick Log idempotency key must be 8 to 120 characters.' using errcode = '22023';
  end if;

  select array_agg(action order by action)
  into v_actions
  from (
    select distinct lower(btrim(value)) as action
    from unnest(coalesce(p_action_types, '{}'::text[])) value
    where nullif(btrim(value), '') is not null
  ) normalized;

  if coalesce(cardinality(v_actions), 0) < 1 or cardinality(v_actions) > 12 then
    raise exception 'Quick Log requires 1 to 12 action types.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_actions) action
    where char_length(action) > 50
      or action !~ '^[a-z0-9][a-z0-9_+ -]*$'
  ) then
    raise exception 'Quick Log action types contain unsupported characters.' using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into v_zone_ids
  from (
    select distinct id
    from unnest(coalesce(p_zone_ids, '{}'::uuid[])) id
  ) deduped;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into v_object_ids
  from (
    select distinct id
    from unnest(coalesce(p_object_ids, '{}'::uuid[])) id
  ) deduped;

  if cardinality(v_zone_ids) > 50 or cardinality(v_object_ids) > 50 then
    raise exception 'Quick Log may touch at most 50 zones and 50 objects.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_zone_ids) requested(id)
    left join atlas.zones z on z.id = requested.id and z.farm_id = p_farm_id
    where z.id is null
  ) then
    raise exception 'Quick Log includes a zone outside the active farm.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(v_object_ids) requested(id)
    left join atlas.growing_objects go on go.id = requested.id and go.farm_id = p_farm_id
    where go.id is null
  ) then
    raise exception 'Quick Log includes an object outside the active farm.' using errcode = '42501';
  end if;

  select fl.*
  into v_existing
  from atlas.field_logs fl
  where fl.farm_id = p_farm_id
    and fl.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if v_existing.id is not null then
    return query
    select
      v_existing.id,
      v_existing.actor_membership_id,
      v_existing.actor_role,
      (select count(*)::integer from atlas.field_log_objects flo where flo.field_log_id = v_existing.id and flo.zone_id is not null and flo.object_id is null),
      (select count(*)::integer from atlas.field_log_objects flo where flo.field_log_id = v_existing.id and flo.object_id is not null),
      true;
    return;
  end if;

  insert into atlas.field_logs (
    farm_id,
    log_date,
    action_types,
    summary_sentence,
    note,
    created_by,
    source,
    metadata,
    actor_user_id,
    actor_membership_id,
    actor_role,
    idempotency_key
  ) values (
    p_farm_id,
    p_log_date,
    v_actions,
    btrim(p_summary_sentence),
    nullif(btrim(p_note), ''),
    v_display_name,
    'atlas_quick_log',
    jsonb_build_object(
      'actor_worker_key', v_worker_key,
      'input_zone_count', cardinality(v_zone_ids),
      'input_object_count', cardinality(v_object_ids)
    ),
    v_user_id,
    v_membership_id,
    v_role,
    btrim(p_idempotency_key)
  )
  returning id into v_log_id;

  insert into atlas.field_log_objects (field_log_id, zone_id, role)
  select v_log_id, zone_id, 'touched'
  from unnest(v_zone_ids) zone_id;
  get diagnostics v_zone_count = row_count;

  insert into atlas.field_log_objects (field_log_id, zone_id, object_id, role)
  select v_log_id, go.zone_id, go.id, 'touched'
  from atlas.growing_objects go
  where go.id = any(v_object_ids);
  get diagnostics v_object_count = row_count;

  insert into atlas.object_activity_events (
    farm_id,
    object_id,
    event_type,
    event_date,
    note,
    created_by,
    source,
    metadata,
    field_log_id,
    idempotency_key
  )
  select
    p_farm_id,
    go.id,
    v_actions[1],
    p_log_date,
    nullif(btrim(p_note), ''),
    v_display_name,
    'atlas_quick_log',
    jsonb_build_object(
      'action_types', to_jsonb(v_actions),
      'summary_sentence', btrim(p_summary_sentence),
      'actor_user_id', v_user_id,
      'actor_membership_id', v_membership_id,
      'actor_role', v_role
    ),
    v_log_id,
    btrim(p_idempotency_key) || ':' || go.id::text
  from atlas.growing_objects go
  where go.id = any(v_object_ids)
  on conflict (farm_id, idempotency_key) where idempotency_key is not null do nothing;

  v_has_weed := v_actions && array['weed', 'weeded', 'weeding', 'weed-whack'];
  v_has_water := v_actions && array['water', 'watered', 'watering', 'watering_rain'];
  v_has_check := v_actions && array[
    'check', 'checked', 'field_check', 'germination_check', 'germination_checked',
    'inspection', 'observe', 'observed', 'site_observation', 'verify', 'weather_observation'
  ];

  insert into atlas.object_state (
    object_id,
    farm_id,
    last_touched_at,
    last_weeded_at,
    last_watered_at,
    last_checked_at,
    metadata,
    updated_at
  )
  select
    go.id,
    p_farm_id,
    p_log_date,
    case when v_has_weed then p_log_date else null end,
    case when v_has_water then p_log_date else null end,
    case when v_has_check then p_log_date else null end,
    jsonb_build_object('last_field_log_id', v_log_id),
    now()
  from atlas.growing_objects go
  where go.id = any(v_object_ids)
  on conflict (object_id) do update
  set last_touched_at = greatest(atlas.object_state.last_touched_at, excluded.last_touched_at),
      last_weeded_at = case
        when v_has_weed then greatest(atlas.object_state.last_weeded_at, excluded.last_weeded_at)
        else atlas.object_state.last_weeded_at
      end,
      last_watered_at = case
        when v_has_water then greatest(atlas.object_state.last_watered_at, excluded.last_watered_at)
        else atlas.object_state.last_watered_at
      end,
      last_checked_at = case
        when v_has_check then greatest(atlas.object_state.last_checked_at, excluded.last_checked_at)
        else atlas.object_state.last_checked_at
      end,
      metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb)
        || jsonb_build_object('last_field_log_id', v_log_id),
      updated_at = now();

  return query
  select v_log_id, v_membership_id, v_role, v_zone_count, v_object_count, false;
end;
$function$;

revoke all on function atlas.record_quick_log_v1(uuid, date, text[], text, text, uuid[], uuid[], text) from public, anon;
grant execute on function atlas.record_quick_log_v1(uuid, date, text[], text, text, uuid[], uuid[], text) to authenticated;

revoke insert, update, delete on atlas.field_logs from authenticated;
revoke insert, update, delete on atlas.field_log_objects from authenticated;
revoke insert, update, delete on atlas.object_state from authenticated;
revoke insert, update, delete on atlas.object_activity_events from authenticated;