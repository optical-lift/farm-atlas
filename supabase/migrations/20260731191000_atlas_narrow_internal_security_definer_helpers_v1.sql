-- Phase 1 stabilization, slice 3: keep privileged implementation helpers
-- behind their governed SECURITY DEFINER callers instead of exposing them as
-- standalone signed-in RPC endpoints.
--
-- This migration intentionally excludes endpoint-like helpers such as
-- journal_day_v1, home_task_cards_v2, and tending/project read models until
-- repository usage can be proven conclusively.

do $$
declare
  helper_signature text;
  helper_oid oid;
  helper_name text;
  caller_count integer;
  unsafe_caller_count integer;
  policy_reference_count integer;
begin
  foreach helper_signature in array array[
    'atlas.assert_production_seed_ready_v1(uuid,numeric)',
    'atlas.bell_badge_count_for_user_v1(uuid,uuid)',
    'atlas.refresh_object_active_task_count_v1(uuid)',
    'atlas.resolve_effective_rhythm_rule_for_clock_v2(uuid,timestamp with time zone)',
    'atlas.sync_production_care_policies_v1(uuid)',
    'atlas.sync_seed_inventory_dependency_tasks_v1(uuid)'
  ]
  loop
    helper_oid := to_regprocedure(helper_signature);

    if helper_oid is null then
      raise exception 'Reviewed Atlas implementation helper % does not exist.', helper_signature;
    end if;

    select p.proname
    into helper_name
    from pg_proc p
    where p.oid = helper_oid;

    select count(*)::integer
    into policy_reference_count
    from pg_policies policy
    where concat_ws(' ', policy.qual, policy.with_check) ilike '%' || helper_name || '%';

    if policy_reference_count <> 0 then
      raise exception 'Atlas helper % is referenced by % RLS policy expression(s).', helper_signature, policy_reference_count;
    end if;

    select
      count(*)::integer,
      count(*) filter (where not caller.prosecdef)::integer
    into caller_count, unsafe_caller_count
    from pg_proc caller
    join pg_namespace caller_namespace on caller_namespace.oid = caller.pronamespace
    where caller_namespace.nspname = 'atlas'
      and caller.oid <> helper_oid
      and pg_get_functiondef(caller.oid) ilike '%' || helper_name || '(%';

    if caller_count = 0 then
      raise exception 'Atlas helper % no longer has a reviewed internal caller.', helper_signature;
    end if;

    if unsafe_caller_count <> 0 then
      raise exception 'Atlas helper % has % caller(s) that are not SECURITY DEFINER.', helper_signature, unsafe_caller_count;
    end if;

    if not has_function_privilege('service_role', helper_oid, 'EXECUTE') then
      raise exception 'Atlas helper % is missing its service-role execution contract.', helper_signature;
    end if;

    execute format('revoke execute on function %s from authenticated', helper_signature);

    if has_function_privilege('authenticated', helper_oid, 'EXECUTE') then
      raise exception 'Atlas helper % remains directly executable by authenticated callers.', helper_signature;
    end if;

    if has_function_privilege('anon', helper_oid, 'EXECUTE') then
      raise exception 'Atlas helper % remains directly executable by anonymous callers.', helper_signature;
    end if;

    if not has_function_privilege('service_role', helper_oid, 'EXECUTE') then
      raise exception 'Atlas helper % lost service-role execution during narrowing.', helper_signature;
    end if;
  end loop;
end
$$;
