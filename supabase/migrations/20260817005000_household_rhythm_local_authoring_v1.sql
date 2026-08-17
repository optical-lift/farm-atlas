begin;

create or replace function atlas.principal_upsert_household_rhythm_local_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_timezone text;
  v_start_local timestamp without time zone;
  v_end_local timestamp without time zone;
  v_input jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Household rhythm input must be an object.' using errcode = '22023';
  end if;

  select h.timezone
  into v_timezone
  from atlas.principals p
  join atlas.households h on h.id = p.active_household_id
  where p.user_id = auth.uid()
    and p.status = 'active'
    and h.status = 'active'
  limit 1;

  if v_timezone is null then
    raise exception 'Active Principal household required.' using errcode = '42501';
  end if;

  if nullif(trim(p_input ->> 'nextWindowStartLocal'), '') is null
     or nullif(trim(p_input ->> 'nextWindowEndLocal'), '') is null then
    raise exception 'Local household window start and end are required.' using errcode = '22023';
  end if;

  begin
    v_start_local := (p_input ->> 'nextWindowStartLocal')::timestamp;
    v_end_local := (p_input ->> 'nextWindowEndLocal')::timestamp;
  exception when others then
    raise exception 'Household window must use valid local date/time values.' using errcode = '22023';
  end;

  if v_end_local <= v_start_local then
    raise exception 'Household window end must be after its start.' using errcode = '22023';
  end if;

  v_input := (p_input - 'nextWindowStartLocal' - 'nextWindowEndLocal')
    || jsonb_build_object(
      'nextWindowStart', v_start_local at time zone v_timezone,
      'nextWindowEnd', v_end_local at time zone v_timezone,
      'metadata', coalesce(
        case when jsonb_typeof(p_input -> 'metadata') = 'object' then p_input -> 'metadata' end,
        '{}'::jsonb
      ) || jsonb_build_object(
        'authoringTimezone', v_timezone,
        'authoringContract', 'principal_upsert_household_rhythm_local_api_v1'
      )
    );

  v_result := atlas.principal_upsert_household_rhythm_api_v1(v_input);
  return v_result || jsonb_build_object('authoringTimezone', v_timezone);
end;
$$;

comment on function atlas.principal_upsert_household_rhythm_local_api_v1(jsonb) is
  'Principal household rhythm authoring wrapper. Interprets nextWindowStartLocal/nextWindowEndLocal in the active household timezone before storing timestamptz values.';

revoke all on function atlas.principal_upsert_household_rhythm_local_api_v1(jsonb) from public, anon;
grant execute on function atlas.principal_upsert_household_rhythm_local_api_v1(jsonb) to authenticated, service_role;

commit;
