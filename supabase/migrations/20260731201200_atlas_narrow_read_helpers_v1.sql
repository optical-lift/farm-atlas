-- Narrow direct signed-in execution for five read-only implementation helpers.
--
-- The reviewed helpers remain callable by their SECURITY DEFINER parent
-- endpoints and by service_role, but are no longer standalone authenticated
-- RPC endpoints. A rollback-only production rehearsal compared six exact
-- parent endpoint payloads across an Owner and farm hand before and after the
-- revocations and found no differences.

DO $preflight$
DECLARE
  expected RECORD;
  helper_oid OID;
  helper_security_definer BOOLEAN;
  actual_callers TEXT[];
  policy_reference_count INTEGER;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      (
        'bell_event_obligation_key_v2',
        'atlas.bell_event_obligation_key_v2(uuid)',
        ARRAY[
          'bell_badge_count_for_user_v1(p_farm_id uuid, p_user_id uuid)',
          'bell_history_v2(p_farm_id uuid, p_effective_membership_id uuid, p_limit integer, p_before timestamp with time zone)'
        ]::TEXT[]
      ),
      (
        'bell_event_why_v2',
        'atlas.bell_event_why_v2(uuid,uuid)',
        ARRAY[
          'bell_history_v2(p_farm_id uuid, p_effective_membership_id uuid, p_limit integer, p_before timestamp with time zone)'
        ]::TEXT[]
      ),
      (
        'goal_unlocked_today_v1',
        'atlas.goal_unlocked_today_v1(uuid,date)',
        ARRAY[
          'living_day_v1(p_farm_id uuid, p_day date)'
        ]::TEXT[]
      ),
      (
        'object_crop_occupancy_v1',
        'atlas.object_crop_occupancy_v1(uuid)',
        ARRAY[
          'weed_card_task_focus_v1(p_task_id uuid)'
        ]::TEXT[]
      ),
      (
        'resolve_goal_state_v1',
        'atlas.resolve_goal_state_v1(uuid,date)',
        ARRAY[
          'evaluate_goal_unlocks_v1(p_farm_id uuid, p_as_of_date date, p_release boolean)',
          'farm_goal_list_v1(p_farm_id uuid, p_as_of_date date)',
          'living_day_v1(p_farm_id uuid, p_day date)'
        ]::TEXT[]
      )
    ) AS reviewed(helper_name, signature, expected_callers)
  LOOP
    helper_oid := to_regprocedure(expected.signature)::OID;

    IF helper_oid IS NULL THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % does not exist.', expected.signature;
    END IF;

    SELECT p.prosecdef
    INTO helper_security_definer
    FROM pg_proc p
    WHERE p.oid = helper_oid;

    IF NOT helper_security_definer THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % is no longer SECURITY DEFINER.',
        expected.signature;
    END IF;

    IF NOT has_function_privilege('authenticated', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated no longer has the expected EXECUTE privilege on %.',
        expected.signature;
    END IF;

    IF NOT has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role does not have EXECUTE on reviewed helper %.',
        expected.signature;
    END IF;

    IF has_function_privilege('anon', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE on reviewed helper %.',
        expected.signature;
    END IF;

    SELECT COALESCE(array_agg(caller_signature ORDER BY caller_signature), ARRAY[]::TEXT[])
    INTO actual_callers
    FROM (
      SELECT DISTINCT format(
        '%I(%s)',
        caller.proname,
        pg_get_function_identity_arguments(caller.oid)
      ) AS caller_signature
      FROM pg_proc caller
      JOIN pg_namespace caller_namespace
        ON caller_namespace.oid = caller.pronamespace
       AND caller_namespace.nspname = 'atlas'
      WHERE caller.oid <> helper_oid
        AND (
          position(
            lower(expected.helper_name) || '('
            IN lower(pg_get_functiondef(caller.oid))
          ) > 0
          OR position(
            lower(expected.helper_name) || ' ('
            IN lower(pg_get_functiondef(caller.oid))
          ) > 0
        )
    ) callers;

    IF actual_callers IS DISTINCT FROM expected.expected_callers THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % caller set drifted. Expected %, found %.',
        expected.signature, expected.expected_callers, actual_callers;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc caller
      JOIN pg_namespace caller_namespace
        ON caller_namespace.oid = caller.pronamespace
       AND caller_namespace.nspname = 'atlas'
      WHERE caller.oid <> helper_oid
        AND NOT caller.prosecdef
        AND (
          position(
            lower(expected.helper_name) || '('
            IN lower(pg_get_functiondef(caller.oid))
          ) > 0
          OR position(
            lower(expected.helper_name) || ' ('
            IN lower(pg_get_functiondef(caller.oid))
          ) > 0
        )
    ) THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % has a non-SECURITY-DEFINER caller.',
        expected.signature;
    END IF;

    SELECT count(*)
    INTO policy_reference_count
    FROM pg_policies policy
    WHERE position(
      lower(expected.helper_name) || '('
      IN lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
    ) > 0
    OR position(
      lower(expected.helper_name) || ' ('
      IN lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
    ) > 0;

    IF policy_reference_count <> 0 THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % is referenced by % RLS policies.',
        expected.signature, policy_reference_count;
    END IF;
  END LOOP;
END
$preflight$;

REVOKE EXECUTE ON FUNCTION atlas.bell_event_obligation_key_v2(uuid)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.bell_event_why_v2(uuid, uuid)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.goal_unlocked_today_v1(uuid, date)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.object_crop_occupancy_v1(uuid)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.resolve_goal_state_v1(uuid, date)
  FROM authenticated;

DO $verification$
DECLARE
  signature TEXT;
  helper_oid OID;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'atlas.bell_event_obligation_key_v2(uuid)',
    'atlas.bell_event_why_v2(uuid,uuid)',
    'atlas.goal_unlocked_today_v1(uuid,date)',
    'atlas.object_crop_occupancy_v1(uuid)',
    'atlas.resolve_goal_state_v1(uuid,date)'
  ]::TEXT[]
  LOOP
    helper_oid := to_regprocedure(signature)::OID;

    IF helper_oid IS NULL THEN
      RAISE EXCEPTION 'Reviewed Atlas helper % disappeared during migration.', signature;
    END IF;

    IF has_function_privilege('authenticated', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated still has EXECUTE on reviewed helper %.', signature;
    END IF;

    IF has_function_privilege('anon', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE on reviewed helper %.', signature;
    END IF;

    IF NOT has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE on reviewed helper %.', signature;
    END IF;
  END LOOP;
END
$verification$;
