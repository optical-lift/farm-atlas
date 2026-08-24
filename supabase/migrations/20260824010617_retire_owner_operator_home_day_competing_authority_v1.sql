-- Retire farm-root Owner self-day authority now superseded by Principal Clock.

drop function if exists atlas.owner_operator_home_day_v1(uuid, date);

insert into atlas.architecture_authority_boundaries(boundary_key, authority_owner, forbidden_pattern, rationale)
values (
  'principal_self_day_not_owner_operator_home_day',
  'principal_clock',
  '^owner_operator_home_day(_v[0-9]+)?$',
  'The Principal root owns the Principal''s day across portfolio, household, obligations, escalations, and capacity. A farm-membership Owner home-day function must not independently answer the Principal self-day question.'
)
on conflict (boundary_key) do update set
  authority_owner = excluded.authority_owner,
  forbidden_pattern = excluded.forbidden_pattern,
  rationale = excluded.rationale;

create or replace function atlas.assert_architecture_authority_boundaries_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_violations jsonb;
  v_boundaries jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'boundary', b.boundary_key,
        'authorityOwner', b.authority_owner,
        'function', p.proname,
        'arguments', pg_get_function_identity_arguments(p.oid)
      )
      order by b.boundary_key, p.proname, pg_get_function_identity_arguments(p.oid)
    ),
    '[]'::jsonb
  )
  into v_violations
  from atlas.architecture_authority_boundaries b
  join pg_proc p on p.proname ~* b.forbidden_pattern
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'atlas';

  if jsonb_array_length(v_violations) > 0 then
    raise exception using
      errcode='23514',
      message='architecture_authority_boundary_violation',
      detail=v_violations::text;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'boundary', boundary_key,
        'authorityOwner', authority_owner,
        'forbiddenPattern', forbidden_pattern
      )
      order by boundary_key
    ),
    '[]'::jsonb
  )
  into v_boundaries
  from atlas.architecture_authority_boundaries;

  return jsonb_build_object(
    'status', 'sound',
    'boundaryCount', jsonb_array_length(v_boundaries),
    'violationCount', 0,
    'boundaries', v_boundaries
  );
end;
$$;

revoke all on function atlas.assert_architecture_authority_boundaries_v1() from public, anon, authenticated;
grant execute on function atlas.assert_architecture_authority_boundaries_v1() to service_role;

select atlas.assert_architecture_authority_boundaries_v1();
