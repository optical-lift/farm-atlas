create or replace function atlas.day_reservations_api_v2(
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
  v_reservations jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if not exists(
    select 1
    from atlas.farm_memberships membership
    where membership.id = p_membership_id
      and membership.farm_id = p_farm_id
      and membership.active
      and (
        membership.user_id = auth.uid()
        or exists(
          select 1
          from atlas.farm_memberships owner_membership
          where owner_membership.farm_id = p_farm_id
            and owner_membership.active
            and owner_membership.role = 'owner'
            and owner_membership.user_id = auth.uid()
        )
      )
  ) then
    raise exception 'Worker Day access required.' using errcode='42501';
  end if;

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

  return v_reservations;
end;
$function$;
