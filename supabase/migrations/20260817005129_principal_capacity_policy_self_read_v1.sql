create or replace function atlas.principal_capacity_policies_self_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_policies jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  v_principal_id := atlas.current_principal_id_v1();
  if v_principal_id is null then
    raise exception 'Active Principal context required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'stableKey', p.stable_key,
    'name', p.name,
    'weekdays', to_jsonb(p.weekdays),
    'localStart', to_char(p.local_start, 'HH24:MI'),
    'localEnd', to_char(p.local_end, 'HH24:MI'),
    'defaultDiscretionaryMinutes', p.default_discretionary_minutes,
    'maximumPlannedMinutes', p.maximum_planned_minutes,
    'effectiveFrom', p.effective_from,
    'effectiveThrough', p.effective_through,
    'active', p.active,
    'metadata', p.metadata,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  ) order by p.effective_from desc, p.created_at desc), '[]'::jsonb)
  into v_policies
  from atlas.principal_capacity_policies p
  where p.principal_id = v_principal_id
    and p.active;

  return jsonb_build_object(
    'contractVersion', 'principal_capacity_policies_self_v1',
    'principalId', v_principal_id,
    'policies', v_policies,
    'capacityToday', atlas.principal_capacity_day_state_v1(v_principal_id, current_date)
  );
end;
$function$;

revoke all on function atlas.principal_capacity_policies_self_api_v1() from public, anon;
grant execute on function atlas.principal_capacity_policies_self_api_v1() to authenticated, service_role;

comment on function atlas.principal_capacity_policies_self_api_v1() is
'Authenticated Principal read contract for explicitly authored active Principal Capacity policies. Returns policy definitions plus today resolved capacity; does not infer or seed a schedule.';
