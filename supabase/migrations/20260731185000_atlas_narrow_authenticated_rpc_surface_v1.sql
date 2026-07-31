-- Phase 1 stabilization, slice 2: signed-in callers should reach supported
-- Atlas entrypoints, not trigger bodies or wrapper implementation helpers.
-- Service-role execution is preserved for migrations, dispatchers, and repair work.

alter function atlas.biological_clock_state_from_boundaries_v1(
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone
) set search_path = pg_catalog, atlas;

alter function atlas.set_germination_thinning_due_date()
  set search_path = pg_catalog, atlas;

alter function atlas.set_updated_at()
  set search_path = pg_catalog, atlas;

alter function atlas.strip_person_attribution_from_field_records()
  set search_path = pg_catalog, atlas;

alter function atlas.task_destination_object_ids_v1(atlas.tasks)
  set search_path = pg_catalog, atlas;

do $$
declare
  routine record;
begin
  for routine in
    select format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
      and (
        p.prorettype = 'pg_catalog.trigger'::regtype
        or p.proname in (
          'configure_project_review_core_v1',
          'configure_seed_inventory_freshness_core_v1',
          'record_project_review_result_core_v1',
          'record_seed_inventory_result_core_v1',
          'reopen_task_completion_v1_internal',
          'task_destination_object_ids_v1'
        )
      )
  loop
    execute format(
      'revoke execute on function %s from authenticated',
      routine.signature
    );
  end loop;
end
$$;

-- Release gates: trigger and implementation functions are no longer API
-- endpoints; every Atlas function has a fixed path; supported wrappers remain.
do $$
declare
  exposed_trigger_count integer;
  exposed_helper_count integer;
  mutable_path_count integer;
  supported_signature text;
begin
  select count(*)
  into exposed_trigger_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.prorettype = 'pg_catalog.trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if exposed_trigger_count <> 0 then
    raise exception 'Atlas still exposes % trigger function(s) to authenticated callers.', exposed_trigger_count;
  end if;

  select count(*)
  into exposed_helper_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.proname in (
      'configure_project_review_core_v1',
      'configure_seed_inventory_freshness_core_v1',
      'record_project_review_result_core_v1',
      'record_seed_inventory_result_core_v1',
      'reopen_task_completion_v1_internal',
      'task_destination_object_ids_v1'
    )
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if exposed_helper_count <> 0 then
    raise exception 'Atlas still exposes % implementation helper(s) to authenticated callers.', exposed_helper_count;
  end if;

  select count(*)
  into mutable_path_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
    );

  if mutable_path_count <> 0 then
    raise exception 'Atlas still has % function(s) without a fixed search_path.', mutable_path_count;
  end if;

  foreach supported_signature in array array[
    'atlas.universal_home_v1(uuid,uuid,date,date)',
    'atlas.owner_operator_universal_home_v1(uuid,uuid,uuid,date,date)',
    'atlas.worker_task_hand_v1(uuid,date,uuid)',
    'atlas.record_quick_log_v1(uuid,date,text[],text,text,uuid[],uuid[],text)',
    'atlas.configure_project_review_for_member_v1(uuid,integer,integer,integer,date,text)',
    'atlas.owner_operator_configure_project_review_v1(uuid,uuid,integer,integer,integer,date,text)',
    'atlas.configure_seed_inventory_freshness_for_member_v1(uuid,integer,integer,integer,date,numeric,text)',
    'atlas.owner_operator_configure_seed_inventory_freshness_v1(uuid,uuid,integer,integer,integer,date,numeric,text)',
    'atlas.record_project_review_result_for_member_v1(uuid,uuid,text,text,date,text,text)',
    'atlas.owner_operator_record_project_review_result_v1(uuid,uuid,text,text,date,text,text)',
    'atlas.record_seed_inventory_result_for_member_v1(uuid,uuid,text,numeric,numeric,text,text,date,text,text)',
    'atlas.owner_operator_record_seed_inventory_result_v1(uuid,uuid,text,numeric,numeric,text,text,date,text,text)',
    'atlas.owner_reopen_task_completion_v1(uuid,text,jsonb)',
    'atlas.worker_reopen_task_completion_v1(uuid,text,jsonb)',
    'atlas.owner_operator_reopen_task_completion_v1(uuid,uuid,text,jsonb)'
  ]
  loop
    if to_regprocedure(supported_signature) is null then
      raise exception 'Supported Atlas RPC % does not exist.', supported_signature;
    end if;

    if not has_function_privilege('authenticated', supported_signature, 'EXECUTE') then
      raise exception 'Supported Atlas RPC % lost authenticated execution.', supported_signature;
    end if;
  end loop;

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