alter table atlas.planting_claims
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  add column if not exists actor_role text,
  add column if not exists idempotency_key text;

alter table atlas.planting_claims
  drop constraint if exists planting_claims_actor_role_check;

alter table atlas.planting_claims
  add constraint planting_claims_actor_role_check
  check (actor_role is null or actor_role in ('owner', 'manager', 'farm_hand', 'system'));

create unique index if not exists planting_claims_farm_idempotency_idx
on atlas.planting_claims (farm_id, idempotency_key)
where idempotency_key is not null;

create index if not exists planting_claims_actor_membership_date_idx
on atlas.planting_claims (actor_membership_id, planted_date desc, created_at desc)
where actor_membership_id is not null;

create or replace function atlas.record_planting_claim_v1(
  p_farm_id uuid,
  p_planted_date date,
  p_crop_label text,
  p_variety text,
  p_planting_method text,
  p_amount numeric,
  p_unit text,
  p_object_ids uuid[],
  p_crop_profile_id uuid default null,
  p_coverage_kind text default 'whole_object',
  p_bed_length_ft numeric default null,
  p_bed_width_ft numeric default null,
  p_confidence text default 'field_logged',
  p_note text default null,
  p_idempotency_key text default null
)
returns table (
  planting_claim_id uuid,
  field_log_id uuid,
  actor_membership_id uuid,
  actor_role text,
  object_count integer,
  object_content_count integer,
  crop_cycle_count integer,
  expected_germination_start date,
  expected_germination_end date,
  expected_harvest_watch_start date,
  expected_harvest_watch_end date,
  expected_clear_date date,
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
  v_display_name text;
  v_worker_key text;
  v_crop_label text := nullif(btrim(p_crop_label), '');
  v_variety text := nullif(btrim(p_variety), '');
  v_method text := lower(nullif(btrim(p_planting_method), ''));
  v_unit text := nullif(btrim(p_unit), '');
  v_confidence text := lower(coalesce(nullif(btrim(p_confidence), ''), 'field_logged'));
  v_coverage_kind text := lower(coalesce(nullif(btrim(p_coverage_kind), ''), 'whole_object'));
  v_note text := nullif(btrim(p_note), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_object_ids uuid[];
  v_profile atlas.crop_profiles%rowtype;
  v_claim atlas.planting_claims%rowtype;
  v_field_log_id uuid;
  v_object_count integer := 0;
  v_content_count integer := 0;
  v_cycle_count integer := 0;
  v_summary text;
  v_location_text text;
  v_germination_start date;
  v_germination_end date;
  v_harvest_start date;
  v_harvest_end date;
  v_clear_date date;
  v_object record;
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

  if v_membership_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Owner or Manager membership required.' using errcode = '42501';
  end if;

  if p_planted_date is null
    or p_planted_date < date '2000-01-01'
    or p_planted_date > current_date + 1
  then
    raise exception 'Planting date is outside the supported range.' using errcode = '22023';
  end if;

  if v_crop_label is null or char_length(v_crop_label) > 120 then
    raise exception 'Crop label is required and must not exceed 120 characters.' using errcode = '22023';
  end if;

  if v_variety is not null and char_length(v_variety) > 160 then
    raise exception 'Variety must not exceed 160 characters.' using errcode = '22023';
  end if;

  if v_method not in ('direct_sow', 'transplant', 'clump', 'division', 'start', 'bulb', 'seed_scatter', 'full_bed_claim') then
    raise exception 'Unsupported planting method.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'Planting amount must be greater than zero.' using errcode = '22023';
  end if;

  if v_unit is null or char_length(v_unit) > 50 then
    raise exception 'Planting unit is required and must not exceed 50 characters.' using errcode = '22023';
  end if;

  if v_confidence not in ('unknown', 'low', 'medium', 'high', 'field_logged') then
    raise exception 'Unsupported planting confidence.' using errcode = '22023';
  end if;

  if v_coverage_kind not in ('whole_object', 'full_bed', 'partial_object', 'row', 'section') then
    raise exception 'Unsupported planting coverage kind.' using errcode = '22023';
  end if;

  if p_bed_length_ft is not null and (p_bed_length_ft <= 0 or p_bed_length_ft > 10000) then
    raise exception 'Bed length is outside the supported range.' using errcode = '22023';
  end if;

  if p_bed_width_ft is not null and (p_bed_width_ft <= 0 or p_bed_width_ft > 1000) then
    raise exception 'Bed width is outside the supported range.' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 4000 then
    raise exception 'Planting note must not exceed 4000 characters.' using errcode = '22023';
  end if;

  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'Planting idempotency key must be 8 to 120 characters.' using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into v_object_ids
  from (
    select distinct id
    from unnest(coalesce(p_object_ids, '{}'::uuid[])) id
  ) deduped;

  if cardinality(v_object_ids) < 1 or cardinality(v_object_ids) > 50 then
    raise exception 'A planting claim must identify 1 to 50 farm objects.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_object_ids) requested(id)
    left join atlas.growing_objects go
      on go.id = requested.id
     and go.farm_id = p_farm_id
    where go.id is null
  ) then
    raise exception 'Planting claim includes an object outside the active farm.' using errcode = '42501';
  end if;

  select pc.*
  into v_claim
  from atlas.planting_claims pc
  where pc.farm_id = p_farm_id
    and pc.idempotency_key = v_key
  limit 1;

  if v_claim.id is not null then
    return query
    select
      v_claim.id,
      v_claim.field_log_id,
      v_claim.actor_membership_id,
      v_claim.actor_role,
      (select count(*)::integer from atlas.planting_claim_objects pco where pco.planting_claim_id = v_claim.id),
      (select count(*)::integer from atlas.object_contents oc where oc.planting_claim_id = v_claim.id),
      (select count(*)::integer from atlas.crop_cycles cc where cc.planting_claim_id = v_claim.id),
      v_claim.expected_germination_start,
      v_claim.expected_germination_end,
      v_claim.expected_harvest_watch_start,
      v_claim.expected_harvest_watch_end,
      v_claim.expected_clear_date,
      true;
    return;
  end if;

  if p_crop_profile_id is not null then
    select cp.* into v_profile
    from atlas.crop_profiles cp
    where cp.id = p_crop_profile_id;

    if v_profile.id is null then
      raise exception 'Selected crop profile was not found.' using errcode = '22023';
    end if;
  else
    select cp.* into v_profile
    from atlas.crop_profiles cp
    where lower(cp.crop_label) = lower(v_crop_label)
    order by
      case
        when v_variety is not null and lower(coalesce(cp.variety, '')) = lower(v_variety) then 0
        when cp.variety is null then 1
        else 2
      end,
      cp.updated_at desc
    limit 1;
  end if;

  v_germination_start := case
    when v_profile.days_to_germination_min is not null
      then p_planted_date + v_profile.days_to_germination_min
  end;
  v_germination_end := case
    when v_profile.days_to_germination_max is not null
      then p_planted_date + v_profile.days_to_germination_max
  end;
  v_harvest_start := case
    when v_profile.days_to_harvest_watch_min is not null
      then p_planted_date + v_profile.days_to_harvest_watch_min
  end;
  v_harvest_end := case
    when v_profile.days_to_harvest_watch_max is not null
      then p_planted_date + v_profile.days_to_harvest_watch_max
  end;
  v_clear_date := case
    when v_profile.clear_offset_days is not null
      then p_planted_date + v_profile.clear_offset_days
    when v_harvest_end is not null and v_profile.productive_days_max is not null
      then v_harvest_end + v_profile.productive_days_max
  end;

  select string_agg(go.label, ', ' order by go.sort_order, go.label)
  into v_location_text
  from atlas.growing_objects go
  where go.id = any(v_object_ids);

  v_summary := 'Planted ' || p_amount::text || ' ' || v_unit || ' '
    || coalesce(v_variety || ' ', '') || v_crop_label
    || ' in ' || v_location_text || '.';

  select q.field_log_id
  into v_field_log_id
  from atlas.record_quick_log_v1(
    p_farm_id,
    p_planted_date,
    array['plant', 'planting', v_method],
    v_summary,
    v_note,
    '{}'::uuid[],
    v_object_ids,
    v_key || ':log'
  ) q;

  insert into atlas.planting_claims (
    farm_id, field_log_id, crop_profile_id, crop_label, variety,
    planted_date, planting_method, amount, unit, bed_length_ft,
    bed_width_ft, status, confidence, expected_germination_start,
    expected_germination_end, expected_harvest_watch_start,
    expected_harvest_watch_end, expected_clear_date, note, metadata,
    actor_user_id, actor_membership_id, actor_role, idempotency_key
  ) values (
    p_farm_id, v_field_log_id, v_profile.id, v_crop_label, v_variety,
    p_planted_date, v_method, p_amount, v_unit, p_bed_length_ft,
    p_bed_width_ft, 'planted', v_confidence, v_germination_start,
    v_germination_end, v_harvest_start, v_harvest_end, v_clear_date,
    v_note,
    jsonb_build_object(
      'source', 'record_planting_claim_v1',
      'actor_worker_key', v_worker_key,
      'object_ids', to_jsonb(v_object_ids),
      'location', v_location_text
    ),
    v_user_id, v_membership_id, v_role, v_key
  ) returning * into v_claim;

  insert into atlas.planting_claim_objects (
    planting_claim_id, object_id, coverage_kind, coverage_amount, coverage_unit
  )
  select
    v_claim.id,
    go.id,
    v_coverage_kind,
    case when cardinality(v_object_ids) = 1 then p_amount else null end,
    case when cardinality(v_object_ids) = 1 then v_unit else null end
  from atlas.growing_objects go
  where go.id = any(v_object_ids)
  on conflict on constraint planting_claim_objects_planting_claim_id_object_id_key do nothing;

  get diagnostics v_object_count = row_count;

  insert into atlas.object_contents (
    farm_id, object_id, planting_claim_id, crop_profile_id,
    content_label, content_type, variety, planted_date, status,
    confidence, expected_germination_start, expected_germination_end,
    expected_harvest_watch_start, expected_harvest_watch_end,
    expected_clear_date, note, metadata, start_method, clear_bed_date
  )
  select
    p_farm_id, go.id, v_claim.id, v_profile.id, v_crop_label,
    'planting', v_variety, p_planted_date, 'planted', v_confidence,
    v_germination_start, v_germination_end, v_harvest_start,
    v_harvest_end, v_clear_date, v_note,
    jsonb_build_object(
      'source', 'record_planting_claim_v1',
      'planting_claim_id', v_claim.id,
      'claim_amount', p_amount,
      'claim_unit', v_unit,
      'coverage_kind', v_coverage_kind,
      'actor_membership_id', v_membership_id
    ),
    v_method,
    v_clear_date
  from atlas.growing_objects go
  where go.id = any(v_object_ids);

  get diagnostics v_content_count = row_count;

  for v_object in
    select go.id, go.zone_id
    from atlas.growing_objects go
    where go.id = any(v_object_ids)
  loop
    insert into atlas.object_activity_events (
      farm_id, object_id, field_log_id, event_type, event_date,
      note, quantity, unit, created_by, source, idempotency_key, metadata
    ) values (
      p_farm_id, v_object.id, v_field_log_id, 'planted', p_planted_date,
      coalesce(v_note, v_summary),
      case when cardinality(v_object_ids) = 1 then p_amount else null end,
      case when cardinality(v_object_ids) = 1 then v_unit else null end,
      v_display_name,
      'record_planting_claim_v1',
      v_key || ':planting:' || v_object.id::text,
      jsonb_build_object(
        'planting_claim_id', v_claim.id,
        'crop_label', v_crop_label,
        'variety', v_variety,
        'planting_method', v_method,
        'actor_user_id', v_user_id,
        'actor_membership_id', v_membership_id,
        'actor_role', v_role
      )
    )
    on conflict (farm_id, idempotency_key) where idempotency_key is not null do nothing;

    insert into atlas.object_state (
      object_id, farm_id, life_status, last_touched_at, last_checked_at,
      decision_required, metadata, updated_at
    ) values (
      v_object.id, p_farm_id, 'planted', p_planted_date, p_planted_date,
      false,
      jsonb_build_object(
        'last_field_log_id', v_field_log_id,
        'last_planting_claim_id', v_claim.id,
        'last_crop_label', v_crop_label,
        'last_variety', v_variety
      ),
      now()
    )
    on conflict (object_id) do update
    set life_status = 'planted',
        last_touched_at = greatest(atlas.object_state.last_touched_at, excluded.last_touched_at),
        last_checked_at = greatest(atlas.object_state.last_checked_at, excluded.last_checked_at),
        decision_required = false,
        metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();

    perform atlas.sync_crop_cycle_registry_v1(p_farm_id, v_object.id);
  end loop;

  select count(*)::integer
  into v_cycle_count
  from atlas.crop_cycles cc
  where cc.planting_claim_id = v_claim.id;

  return query
  select
    v_claim.id,
    v_field_log_id,
    v_membership_id,
    v_role,
    v_object_count,
    v_content_count,
    v_cycle_count,
    v_germination_start,
    v_germination_end,
    v_harvest_start,
    v_harvest_end,
    v_clear_date,
    false;
end;
$function$;

revoke all on function atlas.record_planting_claim_v1(uuid, date, text, text, text, numeric, text, uuid[], uuid, text, numeric, numeric, text, text, text) from public, anon;
grant execute on function atlas.record_planting_claim_v1(uuid, date, text, text, text, numeric, text, uuid[], uuid, text, numeric, numeric, text, text, text) to authenticated;

revoke insert, update, delete on atlas.planting_claims from authenticated;
revoke insert, update, delete on atlas.planting_claim_objects from authenticated;
revoke insert, update, delete on atlas.object_contents from authenticated;
revoke insert, update, delete on atlas.crop_cycles from authenticated;
