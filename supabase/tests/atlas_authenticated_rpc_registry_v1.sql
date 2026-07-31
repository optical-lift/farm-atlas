-- Re-runnable live proof for the governed Atlas authenticated RPC surface.
-- The proof is read-only and always rolls back.

BEGIN;

DO $proof$
DECLARE
  registry_count INTEGER;
  expected_authenticated_count INTEGER;
  actual_authenticated_count INTEGER;
  anonymous_count INTEGER;
  pending_internal_count INTEGER;
  revoked_count INTEGER;
  drift_rows TEXT;
BEGIN
  IF to_regclass('atlas.authenticated_rpc_registry') IS NULL THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry is missing.';
  END IF;

  IF to_regprocedure('atlas.authenticated_rpc_registry_drift_v1()') IS NULL THEN
    RAISE EXCEPTION 'Atlas authenticated RPC drift proof is missing.';
  END IF;

  SELECT count(*)
  INTO registry_count
  FROM atlas.authenticated_rpc_registry;

  SELECT count(*)
  INTO expected_authenticated_count
  FROM atlas.authenticated_rpc_registry
  WHERE authenticated_execute_expected;

  SELECT
    count(*) FILTER (
      WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    count(*) FILTER (
      WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  INTO actual_authenticated_count, anonymous_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'atlas'
    AND p.prokind = 'f';

  SELECT count(*)
  INTO pending_internal_count
  FROM atlas.authenticated_rpc_registry
  WHERE classification = 'service_internal'
    AND review_status = 'pending_revoke';

  SELECT count(*)
  INTO revoked_count
  FROM atlas.authenticated_rpc_registry
  WHERE review_status = 'revoked'
    AND NOT authenticated_execute_expected;

  SELECT string_agg(
    issue || ': ' || signature || ' ' || detail::TEXT,
    E'\n' ORDER BY issue, signature
  )
  INTO drift_rows
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF registry_count <> 198 THEN
    RAISE EXCEPTION 'Expected 198 registered Atlas signatures, found %.', registry_count;
  END IF;

  IF expected_authenticated_count <> actual_authenticated_count THEN
    RAISE EXCEPTION
      'Registry expects % authenticated functions, catalog has %.',
      expected_authenticated_count,
      actual_authenticated_count;
  END IF;

  IF anonymous_count <> 0 THEN
    RAISE EXCEPTION 'Expected zero anonymous Atlas functions, found %.', anonymous_count;
  END IF;

  IF pending_internal_count <> 17 THEN
    RAISE EXCEPTION 'Expected 17 pending internal reviews, found %.', pending_internal_count;
  END IF;

  IF revoked_count <> 6 THEN
    RAISE EXCEPTION 'Expected six reviewed revocations, found %.', revoked_count;
  END IF;

  IF drift_rows IS NOT NULL THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry drift:%', E'\n' || drift_rows;
  END IF;

  IF has_table_privilege('authenticated', 'atlas.authenticated_rpc_registry', 'SELECT')
     OR has_table_privilege('anon', 'atlas.authenticated_rpc_registry', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'atlas.authenticated_rpc_registry_drift_v1()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'atlas.authenticated_rpc_registry_drift_v1()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Registry inspection leaked outside service_role.';
  END IF;
END
$proof$;

SELECT
  classification,
  confidence,
  review_status,
  count(*) AS signature_count
FROM atlas.authenticated_rpc_registry
GROUP BY classification, confidence, review_status
ORDER BY classification, confidence, review_status;

ROLLBACK;
