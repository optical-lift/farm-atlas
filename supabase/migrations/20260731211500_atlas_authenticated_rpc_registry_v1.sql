-- Govern the direct signed-in Atlas RPC surface with an explicit catalog registry.
--
-- This migration freezes the current 198-function authenticated surface without
-- changing any existing function grant. Later grant changes must update the
-- registry in the same migration, and the service-only drift function proves
-- that the live catalog still matches the recorded boundary.

DO $preflight$
DECLARE
  authenticated_count INTEGER;
  anonymous_count INTEGER;
BEGIN
  IF to_regclass('atlas.authenticated_rpc_registry') IS NOT NULL THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry already exists.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    count(*) FILTER (
      WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  INTO authenticated_count, anonymous_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'atlas'
    AND p.prokind = 'f';

  IF authenticated_count <> 198 THEN
    RAISE EXCEPTION
      'Expected 198 authenticated Atlas functions before registry bootstrap, found %.',
      authenticated_count;
  END IF;

  IF anonymous_count <> 0 THEN
    RAISE EXCEPTION
      'Expected zero anonymously executable Atlas functions before registry bootstrap, found %.',
      anonymous_count;
  END IF;
END
$preflight$;

CREATE TABLE atlas.authenticated_rpc_registry (
  signature TEXT PRIMARY KEY,
  classification TEXT NOT NULL CHECK (classification IN (
    'app_endpoint',
    'owner_admin_endpoint',
    'policy_or_composition_helper',
    'service_internal'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('verified', 'provisional')),
  review_status TEXT NOT NULL CHECK (review_status IN (
    'active',
    'pending_revoke',
    'revoked'
  )),
  authenticated_execute_expected BOOLEAN NOT NULL,
  security_definer_expected BOOLEAN NOT NULL,
  service_execute_expected BOOLEAN NOT NULL,
  caller_count INTEGER NOT NULL CHECK (caller_count >= 0),
  policy_reference_count INTEGER NOT NULL CHECK (policy_reference_count >= 0),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

COMMENT ON TABLE atlas.authenticated_rpc_registry IS
  'Repository-governed allowlist and classification registry for Atlas authenticated RPC execution.';
COMMENT ON COLUMN atlas.authenticated_rpc_registry.signature IS
  'Canonical schema-qualified function signature without argument names.';
COMMENT ON COLUMN atlas.authenticated_rpc_registry.authenticated_execute_expected IS
  'Whether authenticated is expected to have direct EXECUTE on this signature.';

ALTER TABLE atlas.authenticated_rpc_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE atlas.authenticated_rpc_registry
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE atlas.authenticated_rpc_registry
  TO service_role;

WITH functions AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      oidvectortypes(p.proargtypes)
    ) AS signature,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'atlas'
    AND p.prokind = 'f'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
), callers AS (
  SELECT
    fn.oid,
    count(*)::INTEGER AS caller_count
  FROM functions fn
  JOIN pg_proc caller
    ON caller.oid <> fn.oid
   AND caller.prokind = 'f'
  JOIN pg_namespace caller_namespace
    ON caller_namespace.oid = caller.pronamespace
   AND caller_namespace.nspname = 'atlas'
  WHERE position(
      lower(fn.proname) || '('
      IN lower(pg_get_functiondef(caller.oid))
    ) > 0
     OR position(
      lower(fn.proname) || ' ('
      IN lower(pg_get_functiondef(caller.oid))
    ) > 0
  GROUP BY fn.oid
), policy_references AS (
  SELECT
    fn.oid,
    count(*)::INTEGER AS policy_reference_count
  FROM functions fn
  JOIN pg_policies policy
    ON position(
      lower(fn.proname) || '('
      IN lower(
        COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, '')
      )
    ) > 0
    OR position(
      lower(fn.proname) || ' ('
      IN lower(
        COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, '')
      )
    ) > 0
  GROUP BY fn.oid
), classified AS (
  SELECT
    fn.signature,
    CASE
      WHEN left(fn.proname, 6) = 'owner_'
        THEN 'owner_admin_endpoint'
      WHEN NOT fn.prosecdef AND COALESCE(callers.caller_count, 0) > 0
        THEN 'service_internal'
      WHEN COALESCE(policy_references.policy_reference_count, 0) > 0
        OR COALESCE(callers.caller_count, 0) > 0
        THEN 'policy_or_composition_helper'
      ELSE 'app_endpoint'
    END AS classification,
    CASE
      WHEN left(fn.proname, 6) = 'owner_'
        THEN 'verified'
      WHEN NOT fn.prosecdef AND COALESCE(callers.caller_count, 0) > 0
        THEN 'verified'
      WHEN COALESCE(policy_references.policy_reference_count, 0) > 0
        THEN 'verified'
      ELSE 'provisional'
    END AS confidence,
    CASE
      WHEN NOT fn.prosecdef AND COALESCE(callers.caller_count, 0) > 0
        THEN 'pending_revoke'
      ELSE 'active'
    END AS review_status,
    fn.prosecdef AS security_definer_expected,
    fn.service_execute AS service_execute_expected,
    COALESCE(callers.caller_count, 0) AS caller_count,
    COALESCE(policy_references.policy_reference_count, 0)
      AS policy_reference_count
  FROM functions fn
  LEFT JOIN callers ON callers.oid = fn.oid
  LEFT JOIN policy_references ON policy_references.oid = fn.oid
)
INSERT INTO atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence
)
SELECT
  signature,
  classification,
  confidence,
  review_status,
  TRUE,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  jsonb_build_object(
    'source', 'production_catalog_bootstrap',
    'catalog_date', '2026-07-31',
    'classification_rule_version', 1
  )
FROM classified
ORDER BY signature;

CREATE OR REPLACE FUNCTION atlas.authenticated_rpc_registry_drift_v1()
RETURNS TABLE (
  issue TEXT,
  signature TEXT,
  detail JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
  WITH actual AS (
    SELECT
      format(
        '%I.%I(%s)',
        n.nspname,
        p.proname,
        oidvectortypes(p.proargtypes)
      ) AS signature,
      p.prosecdef AS security_definer,
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AS authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE')
        AS service_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE')
        AS anon_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'atlas'
      AND p.prokind = 'f'
  )
  SELECT
    'unregistered_authenticated'::TEXT,
    actual.signature,
    jsonb_build_object('authenticated_execute', TRUE)
  FROM actual
  LEFT JOIN atlas.authenticated_rpc_registry registry
    ON registry.signature = actual.signature
  WHERE actual.authenticated_execute
    AND registry.signature IS NULL

  UNION ALL

  SELECT
    'missing_expected_authenticated',
    registry.signature,
    jsonb_build_object(
      'function_exists', actual.signature IS NOT NULL,
      'authenticated_execute', COALESCE(actual.authenticated_execute, FALSE)
    )
  FROM atlas.authenticated_rpc_registry registry
  LEFT JOIN actual ON actual.signature = registry.signature
  WHERE registry.authenticated_execute_expected
    AND (actual.signature IS NULL OR NOT actual.authenticated_execute)

  UNION ALL

  SELECT
    'unexpected_authenticated',
    registry.signature,
    jsonb_build_object(
      'authenticated_execute', actual.authenticated_execute
    )
  FROM atlas.authenticated_rpc_registry registry
  JOIN actual ON actual.signature = registry.signature
  WHERE NOT registry.authenticated_execute_expected
    AND actual.authenticated_execute

  UNION ALL

  SELECT
    'security_mode_mismatch',
    registry.signature,
    jsonb_build_object(
      'expected_security_definer', registry.security_definer_expected,
      'actual_security_definer', actual.security_definer
    )
  FROM atlas.authenticated_rpc_registry registry
  JOIN actual ON actual.signature = registry.signature
  WHERE registry.security_definer_expected IS DISTINCT FROM actual.security_definer

  UNION ALL

  SELECT
    'service_execute_mismatch',
    registry.signature,
    jsonb_build_object(
      'expected_service_execute', registry.service_execute_expected,
      'actual_service_execute', actual.service_execute
    )
  FROM atlas.authenticated_rpc_registry registry
  JOIN actual ON actual.signature = registry.signature
  WHERE registry.service_execute_expected IS DISTINCT FROM actual.service_execute

  UNION ALL

  SELECT
    'anonymous_execute',
    actual.signature,
    jsonb_build_object('anon_execute', TRUE)
  FROM actual
  WHERE actual.anon_execute
$function$;

REVOKE ALL ON FUNCTION atlas.authenticated_rpc_registry_drift_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.authenticated_rpc_registry_drift_v1()
  TO service_role;

COMMENT ON FUNCTION atlas.authenticated_rpc_registry_drift_v1() IS
  'Service-only proof that the live Atlas function privilege surface matches the governed registry.';

DO $verification$
DECLARE
  registry_count INTEGER;
  pending_internal_count INTEGER;
  drift_count INTEGER;
BEGIN
  SELECT count(*)
  INTO registry_count
  FROM atlas.authenticated_rpc_registry;

  SELECT count(*)
  INTO pending_internal_count
  FROM atlas.authenticated_rpc_registry
  WHERE classification = 'service_internal'
    AND review_status = 'pending_revoke';

  SELECT count(*)
  INTO drift_count
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF registry_count <> 198 THEN
    RAISE EXCEPTION
      'Expected 198 Atlas RPC registry rows, found %.',
      registry_count;
  END IF;

  IF pending_internal_count <> 23 THEN
    RAISE EXCEPTION
      'Expected 23 verified service/internal candidates, found %.',
      pending_internal_count;
  END IF;

  IF drift_count <> 0 THEN
    RAISE EXCEPTION
      'Atlas authenticated RPC registry bootstrapped with % drift rows.',
      drift_count;
  END IF;
END
$verification$;
