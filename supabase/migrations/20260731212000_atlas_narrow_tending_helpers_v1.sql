-- Remove direct signed-in execution from six Tending rendering helpers.
--
-- These security-invoker helpers form one closed implementation layer beneath
-- SECURITY DEFINER Tending endpoints. Exact Owner and farm-hand board, bed, and
-- task-context payloads were compared before and after revocation in a rolled-
-- back production rehearsal and were byte-for-byte identical.

DO $preflight$
DECLARE
  expected RECORD;
  helper_oid OID;
  actual_callers TEXT[];
  policy_reference_count INTEGER;
  registry_row atlas.authenticated_rpc_registry%ROWTYPE;
  profile_helper_oid OID;
  profile_callers TEXT[];
BEGIN
  IF to_regclass('atlas.authenticated_rpc_registry') IS NULL THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry is required.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.authenticated_rpc_registry_drift_v1()
  ) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has drift before Tending review.';
  END IF;

  FOR expected IN
    SELECT *
    FROM (VALUES
      (
        'tending_action_key_v1',
        'atlas.tending_action_key_v1(text,text,text,text,jsonb)',
        ARRAY[
          'atlas.tending_gates_v1(uuid, uuid, uuid, date)'
        ]::TEXT[]
      ),
      (
        'tending_action_label_v1',
        'atlas.tending_action_label_v1(text)',
        ARRAY[
          'atlas.tending_gates_v1(uuid, uuid, uuid, date)',
          'atlas.tending_profile_gates_v1(uuid, date)'
        ]::TEXT[]
      ),
      (
        'tending_card_json_v1',
        'atlas.tending_card_json_v1(uuid,jsonb,boolean)',
        ARRAY[
          'atlas.tending_task_context_v1(uuid, uuid, text)'
        ]::TEXT[]
      ),
      (
        'tending_card_json_v2',
        'atlas.tending_card_json_v2(uuid,uuid,jsonb,boolean)',
        ARRAY[
          'atlas.tending_bed_v1(uuid, text, text)',
          'atlas.tending_board_v1(uuid, text, date)',
          'atlas.tending_task_context_v2(uuid, uuid, text, text)'
        ]::TEXT[]
      ),
      (
        'tending_gates_v1',
        'atlas.tending_gates_v1(uuid,uuid,uuid,date)',
        ARRAY[
          'atlas.tending_bed_v1(uuid, text, text)',
          'atlas.tending_board_v1(uuid, text, date)',
          'atlas.tending_task_context_v1(uuid, uuid, text)',
          'atlas.tending_task_context_v2(uuid, uuid, text, text)'
        ]::TEXT[]
      ),
      (
        'tending_unlock_label_v1',
        'atlas.tending_unlock_label_v1(text,jsonb,text)',
        ARRAY[
          'atlas.tending_bed_v1(uuid, text, text)',
          'atlas.tending_board_v1(uuid, text, date)',
          'atlas.tending_task_context_v2(uuid, uuid, text, text)'
        ]::TEXT[]
      )
    ) AS reviewed(helper_name, signature, expected_callers)
  LOOP
    helper_oid := to_regprocedure(expected.signature)::OID;

    IF helper_oid IS NULL THEN
      RAISE EXCEPTION 'Reviewed Tending helper % does not exist.', expected.signature;
    END IF;

    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = helper_oid) THEN
      RAISE EXCEPTION 'Reviewed Tending helper % is no longer SECURITY INVOKER.',
        expected.signature;
    END IF;

    IF NOT has_function_privilege('authenticated', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated no longer has expected EXECUTE on %.',
        expected.signature;
    END IF;

    IF NOT has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lacks expected EXECUTE on %.',
        expected.signature;
    END IF;

    IF has_function_privilege('anon', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE on %.', expected.signature;
    END IF;

    SELECT COALESCE(
      array_agg(caller_signature ORDER BY caller_signature),
      ARRAY[]::TEXT[]
    )
    INTO actual_callers
    FROM (
      SELECT DISTINCT format(
        '%I.%I(%s)',
        caller_namespace.nspname,
        caller.proname,
        oidvectortypes(caller.proargtypes)
      ) AS caller_signature
      FROM pg_proc caller
      JOIN pg_namespace caller_namespace
        ON caller_namespace.oid = caller.pronamespace
       AND caller_namespace.nspname = 'atlas'
      WHERE caller.oid <> helper_oid
        AND caller.prokind = 'f'
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
      RAISE EXCEPTION
        'Reviewed Tending helper % caller set drifted. Expected %, found %.',
        expected.signature,
        expected.expected_callers,
        actual_callers;
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
      RAISE EXCEPTION 'Reviewed Tending helper % is referenced by % RLS policies.',
        expected.signature,
        policy_reference_count;
    END IF;

    SELECT *
    INTO registry_row
    FROM atlas.authenticated_rpc_registry registry
    WHERE registry.signature = format(
      '%I.%I(%s)',
      'atlas',
      expected.helper_name,
      oidvectortypes((SELECT p.proargtypes FROM pg_proc p WHERE p.oid = helper_oid))
    );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reviewed Tending helper % is not registered.', expected.signature;
    END IF;

    IF registry_row.classification <> 'service_internal'
       OR registry_row.confidence <> 'verified'
       OR registry_row.review_status <> 'pending_revoke'
       OR NOT registry_row.authenticated_execute_expected
       OR registry_row.security_definer_expected
       OR NOT registry_row.service_execute_expected THEN
      RAISE EXCEPTION 'Reviewed Tending helper % registry state drifted.',
        expected.signature;
    END IF;
  END LOOP;

  profile_helper_oid := to_regprocedure(
    'atlas.tending_profile_gates_v1(uuid,date)'
  )::OID;

  IF profile_helper_oid IS NULL THEN
    RAISE EXCEPTION 'Tending profile-gate closure helper is missing.';
  END IF;

  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = profile_helper_oid)
     OR has_function_privilege('authenticated', profile_helper_oid, 'EXECUTE')
     OR has_function_privilege('service_role', profile_helper_oid, 'EXECUTE')
     OR has_function_privilege('anon', profile_helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Tending profile-gate closure privilege state drifted.';
  END IF;

  SELECT COALESCE(
    array_agg(caller_signature ORDER BY caller_signature),
    ARRAY[]::TEXT[]
  )
  INTO profile_callers
  FROM (
    SELECT DISTINCT format(
      '%I.%I(%s)',
      caller_namespace.nspname,
      caller.proname,
      oidvectortypes(caller.proargtypes)
    ) AS caller_signature
    FROM pg_proc caller
    JOIN pg_namespace caller_namespace
      ON caller_namespace.oid = caller.pronamespace
     AND caller_namespace.nspname = 'atlas'
    WHERE caller.oid <> profile_helper_oid
      AND caller.prokind = 'f'
      AND (
        position(
          'tending_profile_gates_v1('
          IN lower(pg_get_functiondef(caller.oid))
        ) > 0
        OR position(
          'tending_profile_gates_v1 ('
          IN lower(pg_get_functiondef(caller.oid))
        ) > 0
      )
  ) callers;

  IF profile_callers IS DISTINCT FROM ARRAY[
    'atlas.tending_gates_v1(uuid, uuid, uuid, date)'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Tending profile-gate caller closure drifted: %.', profile_callers;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc caller
    JOIN pg_namespace caller_namespace
      ON caller_namespace.oid = caller.pronamespace
     AND caller_namespace.nspname = 'atlas'
    WHERE caller.prokind = 'f'
      AND caller.proname NOT IN (
        'tending_action_key_v1',
        'tending_action_label_v1',
        'tending_card_json_v1',
        'tending_card_json_v2',
        'tending_gates_v1',
        'tending_profile_gates_v1',
        'tending_unlock_label_v1'
      )
      AND NOT caller.prosecdef
      AND EXISTS (
        SELECT 1
        FROM (VALUES
          ('tending_action_key_v1'),
          ('tending_action_label_v1'),
          ('tending_card_json_v1'),
          ('tending_card_json_v2'),
          ('tending_gates_v1'),
          ('tending_unlock_label_v1')
        ) reviewed(helper_name)
        WHERE position(
          lower(reviewed.helper_name) || '('
          IN lower(pg_get_functiondef(caller.oid))
        ) > 0
        OR position(
          lower(reviewed.helper_name) || ' ('
          IN lower(pg_get_functiondef(caller.oid))
        ) > 0
      )
  ) THEN
    RAISE EXCEPTION 'Reviewed Tending closure acquired a non-definer external caller.';
  END IF;
END
$preflight$;

REVOKE EXECUTE ON FUNCTION atlas.tending_action_key_v1(
  TEXT, TEXT, TEXT, TEXT, JSONB
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.tending_action_label_v1(TEXT)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.tending_card_json_v1(UUID, JSONB, BOOLEAN)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.tending_card_json_v2(
  UUID, UUID, JSONB, BOOLEAN
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.tending_gates_v1(UUID, UUID, UUID, DATE)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION atlas.tending_unlock_label_v1(TEXT, JSONB, TEXT)
  FROM authenticated;

UPDATE atlas.authenticated_rpc_registry
SET
  authenticated_execute_expected = FALSE,
  review_status = 'revoked',
  reviewed_at = now(),
  evidence = evidence || jsonb_build_object(
    'reviewed_batch', 'tending_helpers_v1',
    'exact_parent_payload_proof', TRUE,
    'proof_roles', jsonb_build_array('owner', 'farm_hand'),
    'proof_surfaces', jsonb_build_array(
      'tending_board_v1',
      'tending_bed_v1',
      'tending_task_context_v1',
      'tending_task_context_v2'
    )
  )
WHERE signature IN (
  'atlas.tending_action_key_v1(text, text, text, text, jsonb)',
  'atlas.tending_action_label_v1(text)',
  'atlas.tending_card_json_v1(uuid, jsonb, boolean)',
  'atlas.tending_card_json_v2(uuid, uuid, jsonb, boolean)',
  'atlas.tending_gates_v1(uuid, uuid, uuid, date)',
  'atlas.tending_unlock_label_v1(text, jsonb, text)'
);

DO $verification$
DECLARE
  signature TEXT;
  helper_oid OID;
  updated_count INTEGER;
  pending_internal_count INTEGER;
  drift_count INTEGER;
BEGIN
  SELECT count(*)
  INTO updated_count
  FROM atlas.authenticated_rpc_registry
  WHERE review_status = 'revoked'
    AND NOT authenticated_execute_expected
    AND evidence->>'reviewed_batch' = 'tending_helpers_v1';

  IF updated_count <> 6 THEN
    RAISE EXCEPTION 'Expected six Tending registry updates, found %.', updated_count;
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'atlas.tending_action_key_v1(text,text,text,text,jsonb)',
    'atlas.tending_action_label_v1(text)',
    'atlas.tending_card_json_v1(uuid,jsonb,boolean)',
    'atlas.tending_card_json_v2(uuid,uuid,jsonb,boolean)',
    'atlas.tending_gates_v1(uuid,uuid,uuid,date)',
    'atlas.tending_unlock_label_v1(text,jsonb,text)'
  ]::TEXT[]
  LOOP
    helper_oid := to_regprocedure(signature)::OID;

    IF helper_oid IS NULL THEN
      RAISE EXCEPTION 'Reviewed Tending helper % disappeared.', signature;
    END IF;

    IF has_function_privilege('authenticated', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated still executes reviewed helper %.', signature;
    END IF;

    IF has_function_privilege('anon', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly executes reviewed helper %.', signature;
    END IF;

    IF NOT has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost reviewed helper %.', signature;
    END IF;
  END LOOP;

  SELECT count(*)
  INTO pending_internal_count
  FROM atlas.authenticated_rpc_registry
  WHERE classification = 'service_internal'
    AND review_status = 'pending_revoke';

  SELECT count(*)
  INTO drift_count
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF pending_internal_count <> 17 THEN
    RAISE EXCEPTION 'Expected 17 remaining internal candidates, found %.',
      pending_internal_count;
  END IF;

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has % drift rows after Tending review.',
      drift_count;
  END IF;
END
$verification$;
