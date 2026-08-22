create or replace function atlas.worker_day_choreography_bundle_api_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_choreography jsonb;
  v_reservations jsonb := '[]'::jsonb;
begin
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;

  v_choreography := atlas.worker_day_choreography_api_v1(
    p_farm_id,
    p_membership_id,
    p_day
  );

  if exists(
    select 1
    from atlas.fixed_routines routine
    where routine.farm_id = p_farm_id
      and routine.membership_id = p_membership_id
      and routine.active
      and routine.effective_from <= p_day
      and (routine.effective_through is null or routine.effective_through >= p_day)
      and extract(dow from p_day)::smallint = any(routine.weekdays)
  ) or exists(
    select 1
    from atlas.day_reservations reservation
    where reservation.farm_id = p_farm_id
      and reservation.membership_id = p_membership_id
      and reservation.service_date = p_day
      and reservation.source = 'fixed_routine'
      and reservation.active
  ) then
    perform atlas.sync_fixed_routine_reservations_for_day_v1(
      p_farm_id,
      p_membership_id,
      p_day
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reservation.id,
    'service_date', reservation.service_date,
    'kind', reservation.kind,
    'title', reservation.title,
    'starts_at', reservation.starts_at,
    'ends_at', reservation.ends_at,
    'source', reservation.source,
    'source_reference', reservation.source_reference,
    'metadata', reservation.metadata
  ) order by reservation.starts_at, reservation.id), '[]'::jsonb)
  into v_reservations
  from atlas.day_reservations reservation
  where reservation.farm_id = p_farm_id
    and reservation.membership_id = p_membership_id
    and reservation.service_date = p_day
    and reservation.active;

  return jsonb_build_object(
    'contractVersion', 'worker_day_choreography_bundle_v2',
    'choreography', v_choreography,
    'reservations', v_reservations
  );
end;
$function$;
