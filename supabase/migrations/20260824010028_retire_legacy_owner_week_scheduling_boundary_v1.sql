-- Atlas Principal Operating System architectural reduction.
-- Principal arbitration owns Principal-time scheduling. Worker Day/Farm Clock retain operator execution authority.
-- The legacy owner-week farm scheduling RPC has no database callers and is not an authenticated application RPC.

drop function if exists atlas.owner_weekly_farm_contract_api_v1(uuid, uuid, date);

create table if not exists atlas.architecture_authority_boundaries (
  boundary_key text primary key,
  authority_owner text not null,
  forbidden_pattern text not null,
  rationale text not null,
  established_at timestamptz not null default now(),
  check (authority_owner in ('principal_clock','farm_clock','worker_day','operational_truth','management_escalation'))
);

alter table atlas.architecture_authority_boundaries enable row level security;
revoke all on table atlas.architecture_authority_boundaries from public, anon, authenticated;
grant select on table atlas.architecture_authority_boundaries to service_role;

insert into atlas.architecture_authority_boundaries(boundary_key, authority_owner, forbidden_pattern, rationale)
values (
  'principal_time_not_owner_farm_week',
  'principal_clock',
  'owner_(week|clock).*schedule',
  'Principal Clock owns Principal-time arbitration. Farm Clock and Worker Day may schedule operator execution, but selected-farm Owner scheduling must not re-emerge as a competing authority.'
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
begin
  select coalesce(jsonb_agg(jsonb_build_object('function', p.proname, 'arguments', pg_get_function_identity_arguments(p.oid))), '[]'::jsonb)
    into v_violations
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.proname ~* '^owner_(week|clock).*schedule';

  if jsonb_array_length(v_violations) > 0 then
    raise exception using errcode='23514', message='legacy_owner_scheduling_authority_detected', detail=v_violations::text;
  end if;

  return jsonb_build_object(
    'boundary', 'principal_time_not_owner_farm_week',
    'authorityOwner', 'principal_clock',
    'legacyOwnerSchedulingViolations', 0,
    'status', 'sound'
  );
end;
$$;

revoke all on function atlas.assert_architecture_authority_boundaries_v1() from public, anon, authenticated;
grant execute on function atlas.assert_architecture_authority_boundaries_v1() to service_role;

select atlas.assert_architecture_authority_boundaries_v1();