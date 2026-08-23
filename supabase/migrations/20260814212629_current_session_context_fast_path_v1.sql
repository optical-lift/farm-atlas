create or replace function atlas.current_session_context_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_email text;
  v_user_metadata jsonb := '{}'::jsonb;
  v_profile jsonb;
  v_memberships jsonb := '[]'::jsonb;
  v_organization_memberships jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  begin
    v_session_id := nullif(v_claims ->> 'session_id', '')::uuid;
  exception when others then
    return null;
  end;

  if v_session_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from auth.sessions session
    where session.id = v_session_id
      and session.user_id = v_uid
      and (session.not_after is null or session.not_after > now())
  ) then
    return null;
  end if;

  select user_row.email, coalesce(user_row.raw_user_meta_data, '{}'::jsonb)
  into v_email, v_user_metadata
  from auth.users user_row
  where user_row.id = v_uid
    and user_row.deleted_at is null
    and (user_row.banned_until is null or user_row.banned_until <= now());

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', profile.user_id,
    'display_name', profile.display_name,
    'default_farm_id', profile.default_farm_id,
    'active', profile.active
  )
  into v_profile
  from atlas.user_profiles profile
  where profile.user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', membership.id,
    'farm_id', membership.farm_id,
    'role', membership.role,
    'worker_key', membership.worker_key,
    'active', membership.active,
    'permissions', coalesce(membership.permissions, '{}'::jsonb),
    'farm', jsonb_build_object(
      'id', farm.id,
      'stable_key', farm.stable_key,
      'name', farm.name,
      'status', farm.status
    )
  ) order by membership.id), '[]'::jsonb)
  into v_memberships
  from atlas.farm_memberships membership
  join atlas.farms farm on farm.id = membership.farm_id
  where membership.user_id = v_uid
    and membership.active = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', membership.id,
    'organization_id', membership.organization_id,
    'role', membership.role,
    'active', membership.active,
    'permissions', coalesce(membership.permissions, '{}'::jsonb),
    'organization', jsonb_build_object(
      'id', organization.id,
      'stable_key', organization.stable_key,
      'name', organization.name,
      'status', organization.status
    )
  ) order by membership.id), '[]'::jsonb)
  into v_organization_memberships
  from atlas.organization_memberships membership
  join atlas.organizations organization on organization.id = membership.organization_id
  where membership.user_id = v_uid
    and membership.active = true;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_uid,
      'email', v_email,
      'user_metadata', v_user_metadata
    ),
    'profile', v_profile,
    'memberships', v_memberships,
    'organizationMemberships', v_organization_memberships
  );
end;
$function$;

revoke all on function atlas.current_session_context_api_v1() from public;
revoke all on function atlas.current_session_context_api_v1() from anon;
grant execute on function atlas.current_session_context_api_v1() to authenticated;
grant execute on function atlas.current_session_context_api_v1() to service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
) values (
  'atlas.current_session_context_api_v1()',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose', 'Return the current authenticated Atlas session identity, profile, farm memberships, and organization memberships in one database round trip',
    'boundary', 'no caller-supplied identity; auth.uid and JWT session_id must match a live auth.sessions row and a non-deleted, non-banned auth.users row',
    'architecture', 'read composition only; preserves canonical Atlas membership and profile truth while removing repeated session hydration reads'
  ),
  now()
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  reviewed_at = excluded.reviewed_at;