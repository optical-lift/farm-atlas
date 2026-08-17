create or replace function atlas.worker_human_time_reservations_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_timezone text:='America/Chicago';
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_rows jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_full_day boolean:=false;
  v_raw_blocked integer:=0;
  v_capacity jsonb;
  v_capacity_known boolean:=false;
  v_capacity_blocked integer;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='P0002';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_day_start:=p_day::timestamp at time zone v_timezone;
  v_day_end:=(p_day+1)::timestamp at time zone v_timezone;

  with source_rows as (
    select
      'full_day_unavailability'::text as reservation_kind,
      u.id,
      coalesce(nullif(btrim(u.reason),''),'Unavailable')::text as title,
      v_day_start as starts_at,
      v_day_end as ends_at,
      u.source,
      true as capacity_blocking,
      jsonb_build_object('stableKey',u.stable_key,'sourceKind','member_unavailability') as metadata
    from atlas.member_unavailability u
    where u.farm_id=p_farm_id and u.membership_id=p_membership_id and u.active=true
      and p_day between u.unavailable_start and u.unavailable_end
      and u.unavailable_local_start is null and u.unavailable_local_end is null

    union all

    select
      'partial_unavailability'::text,
      u.id,
      coalesce(nullif(btrim(u.reason),''),'Unavailable')::text,
      (p_day::timestamp+u.unavailable_local_start) at time zone v_timezone,
      (p_day::timestamp+u.unavailable_local_end) at time zone v_timezone,
      u.source,
      true,
      jsonb_build_object('stableKey',u.stable_key,'sourceKind','member_unavailability')
    from atlas.member_unavailability u
    where u.farm_id=p_farm_id and u.membership_id=p_membership_id and u.active=true
      and p_day between u.unavailable_start and u.unavailable_end
      and u.unavailable_local_start is not null and u.unavailable_local_end is not null

    union all

    select
      r.kind,
      r.id,
      r.title,
      greatest(r.starts_at,v_day_start),
      least(r.ends_at,v_day_end),
      r.source,
      lower(coalesce(nullif(r.metadata->>'capacityBlocking',''),'true')) not in ('false','0','no'),
      jsonb_strip_nulls(jsonb_build_object(
        'stableKey',r.stable_key,
        'sourceKind','day_reservation',
        'sourceReference',r.source_reference,
        'operationalNote',r.metadata->>'operationalNote',
        'enteredBy',r.metadata->>'enteredBy'
      ))
    from atlas.day_reservations r
    where r.farm_id=p_farm_id and r.membership_id=p_membership_id
      and r.service_date=p_day and r.active=true
      and r.ends_at>v_day_start and r.starts_at<v_day_end
  ), packed as (
    select *, greatest((extract(epoch from (ends_at-starts_at))/60.0)::integer,0) as duration_minutes
    from source_rows where ends_at>starts_at
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'reservationId',id,
      'kind',reservation_kind,
      'title',title,
      'startsAt',starts_at,
      'endsAt',ends_at,
      'durationMinutes',duration_minutes,
      'source',source,
      'capacityBlocking',capacity_blocking,
      'metadata',metadata
    ) order by starts_at,ends_at,id),'[]'::jsonb),
    count(*)::integer,
    bool_or(reservation_kind='full_day_unavailability'),
    coalesce(sum(duration_minutes) filter(where capacity_blocking),0)::integer
  into v_rows,v_count,v_full_day,v_raw_blocked
  from packed;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_day);
  v_capacity_known:=coalesce((v_capacity->>'capacityKnown')::boolean,false);
  if v_capacity_known and coalesce(v_capacity->>'blockedMinutes','') ~ '^[0-9]+$' then
    v_capacity_blocked:=(v_capacity->>'blockedMinutes')::integer;
  end if;

  return jsonb_build_object(
    'contractVersion','worker_human_time_reservations_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'reservationCount',v_count,
    'hasRecordedReservations',v_count>0,
    'fullDayUnavailable',coalesce(v_full_day,false),
    'rawCapacityBlockingMinutes',v_raw_blocked,
    'capacityShapeKnown',v_capacity_known,
    'capacityBlockedMinutesInsideDayShape',v_capacity_blocked,
    'reservations',v_rows
  );
end;
$$;

revoke all on function atlas.worker_human_time_reservations_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_human_time_reservations_v1(uuid,uuid,date) to service_role;

create or replace function atlas.worker_weekly_farm_contract_v4(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_base jsonb;
  v_week_start date;
  v_day date;
  v_day_packet jsonb;
  v_days jsonb:='[]'::jsonb;
  v_total_count integer:=0;
  v_days_with_reservations integer:=0;
  v_raw_blocked integer:=0;
  v_shape_known_days integer:=0;
  v_shape_blocked integer:=0;
begin
  v_base:=atlas.worker_weekly_farm_contract_v3(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_base->>'weekStart')::date;

  for v_day in select d::date from generate_series(v_week_start,v_week_start+6,interval '1 day') d loop
    v_day_packet:=atlas.worker_human_time_reservations_v1(p_farm_id,p_membership_id,v_day);
    v_days:=v_days||jsonb_build_array(v_day_packet);
    v_total_count:=v_total_count+coalesce((v_day_packet->>'reservationCount')::integer,0);
    if coalesce((v_day_packet->>'reservationCount')::integer,0)>0 then
      v_days_with_reservations:=v_days_with_reservations+1;
    end if;
    v_raw_blocked:=v_raw_blocked+coalesce((v_day_packet->>'rawCapacityBlockingMinutes')::integer,0);
    if coalesce((v_day_packet->>'capacityShapeKnown')::boolean,false) then
      v_shape_known_days:=v_shape_known_days+1;
      v_shape_blocked:=v_shape_blocked+coalesce((v_day_packet->>'capacityBlockedMinutesInsideDayShape')::integer,0);
    end if;
  end loop;

  return v_base||jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v4',
    'humanTimeReservationContractVersion','worker_human_time_reservations_v1',
    'humanTimeReservations',v_days,
    'humanTimeReservationCount',v_total_count,
    'humanTimeReservationDays',v_days_with_reservations,
    'humanTimeRawCapacityBlockingMinutes',v_raw_blocked,
    'humanTimeCapacityShapeKnownDays',v_shape_known_days,
    'humanTimeCapacityBlockedMinutesInsideKnownShapes',case when v_shape_known_days=7 then v_shape_blocked else null end,
    'humanTimeReservationsDoNotImplyAvailability',true
  );
end;
$$;

revoke all on function atlas.worker_weekly_farm_contract_v4(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v4(uuid,uuid,date) to service_role;

create or replace function atlas.owner_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v4(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

create or replace function atlas.worker_self_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand') then
    raise exception 'The Weekly Farm Contract may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v4(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;