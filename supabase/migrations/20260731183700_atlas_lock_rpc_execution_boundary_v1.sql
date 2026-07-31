-- Phase 1 stabilization: remove PostgreSQL's implicit PUBLIC execution path
-- without changing the callable surface already available to authenticated
-- Atlas sessions or service-role infrastructure.
--
-- New Atlas routines are fail-closed: each migration must explicitly grant
-- EXECUTE to the role that owns the external contract.

do $$
declare
  routine record;
begin
  for routine in
    select
      p.oid,
      format(
        '%I.%I(%s)',
        n.nspname,
        p.proname,
        pg_get_function_identity_arguments(p.oid)
      ) as signature,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
  loop
    -- Materialize the two legitimate effective grants before removing PUBLIC.
    if routine.authenticated_can_execute then
      execute format(
        'grant execute on function %s to authenticated',
        routine.signature
      );
    end if;

    if routine.service_role_can_execute then
      execute format(
        'grant execute on function %s to service_role',
        routine.signature
      );
    end if;

    execute format(
      'revoke execute on function %s from public, anon',
      routine.signature
    );
  end loop;
end
$$;

alter default privileges for role postgres in schema atlas
  revoke execute on functions from public;

-- Release gates: no anonymous Atlas RPCs, no unfixed SECURITY DEFINER path,
-- the authenticated home remains callable, and push-dispatch secrets remain
-- service-role-only.
do $$
declare
  anonymous_routine_count integer;
  unsafe_definer_count integer;
begin
  select count(*)
  into anonymous_routine_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if anonymous_routine_count <> 0 then
    raise exception 'Atlas RPC boundary still exposes % routine(s) to anon.', anonymous_routine_count;
  end if;

  select count(*)
  into unsafe_definer_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
    );

  if unsafe_definer_count <> 0 then
    raise exception 'Atlas has % SECURITY DEFINER routine(s) without a fixed search_path.', unsafe_definer_count;
  end if;

  if not has_function_privilege(
    'authenticated',
    'atlas.universal_home_v1(uuid,uuid,date,date)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated Atlas home execution was not preserved.';
  end if;

  if has_function_privilege(
    'authenticated',
    'atlas.web_push_dispatch_config_v1(text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'atlas.web_push_dispatch_config_v1(text)',
    'EXECUTE'
  ) then
    raise exception 'Web-push dispatcher configuration escaped its service-role boundary.';
  end if;

  if not has_function_privilege(
    'service_role',
    'atlas.web_push_dispatch_config_v1(text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'atlas.claim_notification_delivery_batch_v1(integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'atlas.record_notification_delivery_result_v1(uuid,boolean,integer,text,boolean,boolean)',
    'EXECUTE'
  ) then
    raise exception 'Web-push service-role execution was not preserved.';
  end if;
end
$$;
