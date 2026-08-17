create or replace function atlas.principal_clock_api_v1(
  p_day date default current_date,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_capacity jsonb;
  v_candidates jsonb;
  v_floor jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A Principal Clock date is required.' using errcode='22023';
  end if;
  if p_as_of is null then
    raise exception 'A Principal Clock as-of time is required.' using errcode='22023';
  end if;

  v_principal_id := atlas.current_principal_id_v1();
  if v_principal_id is null then
    return jsonb_build_object(
      'contractVersion', 'principal_clock_api_v1',
      'state', 'principal_required',
      'serviceDate', p_day,
      'asOf', p_as_of,
      'allocationState', 'read_only_arbitration',
      'floor', null,
      'candidates', '[]'::jsonb
    );
  end if;

  v_capacity := atlas.principal_capacity_day_state_v1(v_principal_id, p_day);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.arbitration_rank), '[]'::jsonb)
  into v_candidates
  from atlas.principal_clock_arbitration_v1(v_principal_id, p_day, p_as_of) a;

  select to_jsonb(a)
  into v_floor
  from atlas.principal_clock_arbitration_v1(v_principal_id, p_day, p_as_of) a
  where a.right_to_floor_now
    and a.timing_state <> 'fixed_elapsed'
  order by a.arbitration_rank
  limit 1;

  return jsonb_build_object(
    'contractVersion', 'principal_clock_api_v1',
    'state', 'ready',
    'principalId', v_principal_id,
    'serviceDate', p_day,
    'asOf', p_as_of,
    'allocationState', 'read_only_arbitration',
    'capacity', v_capacity,
    'floor', v_floor,
    'candidates', v_candidates
  );
end;
$function$;

revoke all on function atlas.principal_clock_api_v1(date,timestamptz) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_clock_api_v1(date,timestamptz) to authenticated, service_role, postgres;