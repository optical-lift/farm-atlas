create or replace function atlas.get_public_registration_offering_v1(p_stable_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_offering atlas.community_registration_offerings%rowtype;
  v_program atlas.community_programs%rowtype;
  v_farm atlas.farms%rowtype;
  v_events jsonb;
begin
  select * into v_offering
  from atlas.community_registration_offerings o
  where o.stable_key = trim(p_stable_key)
    and o.status = 'open'
    and (o.opens_at is null or o.opens_at <= now())
    and (o.closes_at is null or o.closes_at >= now())
  limit 1;

  if not found then return null; end if;

  if v_offering.program_id is not null then
    select * into v_program from atlas.community_programs where id = v_offering.program_id;
  end if;
  select * into v_farm from atlas.farms where id = v_offering.farm_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', e.event_date,
    'start_time', to_char(e.start_local_time, 'HH24:MI'),
    'end_time', to_char(e.end_local_time, 'HH24:MI'),
    'title', e.title
  ) order by e.event_date, e.start_local_time), '[]'::jsonb)
  into v_events
  from atlas.community_events e
  where e.program_id = v_offering.program_id
    and e.status in ('planned','scheduled');

  return jsonb_build_object(
    'stable_key', v_offering.stable_key,
    'title', v_offering.title,
    'registration_type', v_offering.registration_type,
    'fee_amount', v_offering.fee_amount,
    'fee_currency', v_offering.fee_currency,
    'fee_basis', v_offering.fee_basis,
    'registration_scope', v_offering.registration_scope,
    'public_description', v_offering.public_description,
    'terms_version', v_offering.terms_version,
    'program_title', v_program.title,
    'farm_name', v_farm.name,
    'timezone_name', coalesce(v_program.timezone_name, 'America/Chicago'),
    'events', v_events,
    'public', coalesce(v_offering.metadata->'public', '{}'::jsonb)
  );
end;
$$;

revoke all on function atlas.get_public_registration_offering_v1(text) from public;
grant execute on function atlas.get_public_registration_offering_v1(text) to anon, authenticated, service_role;
