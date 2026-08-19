create or replace function atlas.sync_community_event_worker_service_reservation_v1(
  p_event_id uuid,
  p_membership_id uuid,
  p_role_key text,
  p_evidence_source text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_event atlas.community_events%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_reservation atlas.day_reservations%rowtype;
  v_tz text;
begin
  if p_event_id is null or p_membership_id is null then
    raise exception 'Event and worker membership are required.' using errcode='22023';
  end if;
  select * into v_event from atlas.community_events where id=p_event_id;
  if v_event.id is null then raise exception 'Community event was not found.' using errcode='P0002'; end if;
  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_event.farm_id and active=true;
  if v_membership.id is null then raise exception 'Active worker membership on the event farm is required.' using errcode='P0002'; end if;
  if v_event.event_date is null or v_event.start_local_time is null or v_event.end_local_time is null then
    raise exception 'Community event must have a complete dated time span before worker service can reserve capacity.' using errcode='22023';
  end if;
  if v_event.end_local_time<=v_event.start_local_time then
    raise exception 'Community event service span must end after it starts on the same day.' using errcode='22023';
  end if;

  v_tz:=coalesce(nullif(v_event.timezone_name,''),'America/Chicago');
  v_start:=(v_event.event_date::timestamp+v_event.start_local_time) at time zone v_tz;
  v_end:=(v_event.event_date::timestamp+v_event.end_local_time) at time zone v_tz;

  insert into atlas.day_reservations(
    farm_id,membership_id,stable_key,kind,service_date,title,starts_at,ends_at,
    source,source_reference,active,metadata
  ) values (
    v_event.farm_id,p_membership_id,
    'community_event:'||v_event.id::text||':worker_service',
    'external_commitment',v_event.event_date,
    v_event.title||' · event service',v_start,v_end,
    'atlas_rule',v_event.id::text,true,
    jsonb_strip_nulls(jsonb_build_object(
      'capacityBlocking',true,
      'sourceKind','community_event',
      'communityEventId',v_event.id,
      'communityEventKey',v_event.stable_key,
      'eventKind',v_event.event_kind,
      'serviceRole',nullif(btrim(coalesce(p_role_key,'')),''),
      'evidenceSource',nullif(btrim(coalesce(p_evidence_source,'')),''),
      'truthBoundary','This reservation expresses worker service time already committed to the public event; it is not additional task work.'
    ))
  )
  on conflict (membership_id,service_date,stable_key)
  do update set
    kind=excluded.kind,
    title=excluded.title,
    starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,
    source=excluded.source,
    source_reference=excluded.source_reference,
    active=true,
    metadata=excluded.metadata,
    updated_at=now()
  returning * into v_reservation;

  return jsonb_build_object(
    'contractVersion','community_event_worker_service_reservation_v1',
    'eventId',v_event.id,
    'membershipId',p_membership_id,
    'reservationId',v_reservation.id,
    'serviceDate',v_reservation.service_date,
    'startsAt',v_reservation.starts_at,
    'endsAt',v_reservation.ends_at,
    'durationMinutes',(extract(epoch from (v_reservation.ends_at-v_reservation.starts_at))/60)::integer,
    'roleKey',v_reservation.metadata->>'serviceRole',
    'capacityBlocking',true
  );
end;
$function$;

revoke all on function atlas.sync_community_event_worker_service_reservation_v1(uuid,uuid,text,text) from public,anon,authenticated;