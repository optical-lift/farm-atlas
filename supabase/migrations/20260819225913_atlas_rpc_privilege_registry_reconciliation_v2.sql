-- P0 build-integrity reconciliation: make Atlas RPC execution explicit, preserve the
-- current authenticated/service behavior, remove accidental PUBLIC execution, and
-- make registry drift compare function identity by OID instead of whitespace-sensitive
-- handwritten signatures.

CREATE TEMP TABLE atlas_rpc_privilege_snapshot_v2 ON COMMIT DROP AS
SELECT
  p.oid,
  format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) AS signature,
  p.proname,
  p.prosecdef,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute_before,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute_before,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anonymous_execute_before,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname='anon')
      AND acl.privilege_type='EXECUTE'
  ) AS explicit_anonymous_execute_before
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='atlas'
  AND p.prokind='f';

-- Future migration-created Atlas functions must not inherit PUBLIC EXECUTE.
ALTER DEFAULT PRIVILEGES IN SCHEMA atlas
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Replace inherited PUBLIC execution with explicit authenticated/service grants only
-- where those roles already had effective execution before this migration. Anonymous
-- access is intentionally preserved only when it was explicitly granted to anon.
DO $privilege_reconciliation$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT * FROM atlas_rpc_privilege_snapshot_v2 ORDER BY signature
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v.signature);

    IF v.authenticated_execute_before THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v.signature);
    END IF;

    IF v.service_execute_before THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v.signature);
    END IF;
  END LOOP;
END
$privilege_reconciliation$;

ALTER TABLE atlas.authenticated_rpc_registry
  ADD COLUMN IF NOT EXISTS anonymous_execute_expected boolean NOT NULL DEFAULT false;

ALTER TABLE atlas.authenticated_rpc_registry
  DROP CONSTRAINT IF EXISTS authenticated_rpc_registry_classification_check;
ALTER TABLE atlas.authenticated_rpc_registry
  ADD CONSTRAINT authenticated_rpc_registry_classification_check
  CHECK (classification IN (
    'public_endpoint',
    'app_endpoint',
    'owner_admin_endpoint',
    'policy_or_composition_helper',
    'service_internal'
  ));

COMMENT ON COLUMN atlas.authenticated_rpc_registry.anonymous_execute_expected IS
  'Whether anon is intentionally expected to have direct EXECUTE on this signature. PUBLIC inheritance is never an acceptable substitute.';

-- Canonicalize every resolvable historical signature from the live function OID.
-- This fixes false drift caused only by spaces after commas or other textual formatting.
DO $canonicalize_registry$
DECLARE
  v record;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT to_regprocedure(signature)::oid AS function_oid, count(*)
      FROM atlas.authenticated_rpc_registry
      WHERE to_regprocedure(signature) IS NOT NULL
      GROUP BY to_regprocedure(signature)::oid
      HAVING count(*) > 1
    ) duplicate_oid
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize Atlas RPC registry: multiple rows resolve to the same function OID.';
  END IF;

  FOR v IN
    SELECT
      registry.signature AS old_signature,
      format('%I.%I(%s)', namespace.nspname, proc.proname, oidvectortypes(proc.proargtypes)) AS canonical_signature
    FROM atlas.authenticated_rpc_registry registry
    JOIN pg_proc proc ON proc.oid=to_regprocedure(registry.signature)::oid
    JOIN pg_namespace namespace ON namespace.oid=proc.pronamespace
    WHERE registry.signature IS DISTINCT FROM
      format('%I.%I(%s)', namespace.nspname, proc.proname, oidvectortypes(proc.proargtypes))
    ORDER BY registry.signature
  LOOP
    UPDATE atlas.authenticated_rpc_registry
    SET signature=v.canonical_signature,
        reviewed_at=now(),
        evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
          'signatureCanonicalizedBy','atlas_rpc_privilege_registry_reconciliation_v2'
        )
    WHERE signature=v.old_signature;
  END LOOP;
END
$canonicalize_registry$;

-- Existing registry rows keep their curated classification, but their expected
-- privilege/security facts are refreshed from the explicit post-reconciliation catalog.
WITH actual AS (
  SELECT
    p.oid,
    p.prosecdef,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='atlas' AND p.prokind='f'
)
UPDATE atlas.authenticated_rpc_registry registry
SET authenticated_execute_expected=actual.authenticated_execute,
    anonymous_execute_expected=actual.anonymous_execute,
    security_definer_expected=actual.prosecdef,
    service_execute_expected=actual.service_execute,
    classification=CASE WHEN actual.anonymous_execute THEN 'public_endpoint' ELSE registry.classification END,
    confidence=CASE WHEN actual.anonymous_execute THEN 'verified' ELSE registry.confidence END,
    review_status=CASE WHEN actual.anonymous_execute THEN 'active' ELSE registry.review_status END,
    evidence=coalesce(registry.evidence,'{}'::jsonb)||jsonb_build_object(
      'privilegeReconciledBy','atlas_rpc_privilege_registry_reconciliation_v2',
      'publicInheritanceRemoved',true
    ),
    reviewed_at=now()
FROM actual
WHERE actual.oid=to_regprocedure(registry.signature)::oid;

-- Register every currently direct authenticated/anonymous Atlas function that was
-- missing from the historical allowlist. Preserve uncertain classification as
-- provisional instead of pretending it is an app endpoint with verified intent.
WITH functions AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) AS signature,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='atlas' AND p.prokind='f'
), callers AS (
  SELECT fn.oid,count(*)::integer AS caller_count
  FROM functions fn
  JOIN pg_proc caller ON caller.oid<>fn.oid AND caller.prokind='f'
  JOIN pg_namespace caller_namespace
    ON caller_namespace.oid=caller.pronamespace AND caller_namespace.nspname='atlas'
  WHERE position(lower(fn.proname)||'(' IN lower(pg_get_functiondef(caller.oid)))>0
     OR position(lower(fn.proname)||' (' IN lower(pg_get_functiondef(caller.oid)))>0
  GROUP BY fn.oid
), policy_references AS (
  SELECT fn.oid,count(*)::integer AS policy_reference_count
  FROM functions fn
  JOIN pg_policies policy
    ON position(lower(fn.proname)||'(' IN lower(coalesce(policy.qual,'')||' '||coalesce(policy.with_check,'')))>0
    OR position(lower(fn.proname)||' (' IN lower(coalesce(policy.qual,'')||' '||coalesce(policy.with_check,'')))>0
  GROUP BY fn.oid
), trigger_references AS (
  SELECT fn.oid,count(*)::integer AS trigger_count
  FROM functions fn
  JOIN pg_trigger trigger ON trigger.tgfoid=fn.oid AND NOT trigger.tgisinternal
  GROUP BY fn.oid
), missing AS (
  SELECT
    fn.*,
    coalesce(callers.caller_count,0) AS caller_count,
    coalesce(policy_references.policy_reference_count,0) AS policy_reference_count,
    coalesce(trigger_references.trigger_count,0) AS trigger_count
  FROM functions fn
  LEFT JOIN callers ON callers.oid=fn.oid
  LEFT JOIN policy_references ON policy_references.oid=fn.oid
  LEFT JOIN trigger_references ON trigger_references.oid=fn.oid
  WHERE (fn.authenticated_execute OR fn.anonymous_execute)
    AND NOT EXISTS (
      SELECT 1
      FROM atlas.authenticated_rpc_registry registry
      WHERE to_regprocedure(registry.signature)::oid=fn.oid
    )
)
INSERT INTO atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,anonymous_execute_expected,
  security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
)
SELECT
  signature,
  CASE
    WHEN anonymous_execute THEN 'public_endpoint'
    WHEN proname ~ '^(owner_|principal_).+_api_v[0-9]+$' THEN 'owner_admin_endpoint'
    WHEN proname ~ '(_for_member_v[0-9]+|_api_v[0-9]+)$' THEN 'app_endpoint'
    WHEN trigger_count>0 OR (NOT prosecdef AND caller_count>0) THEN 'service_internal'
    WHEN policy_reference_count>0 OR caller_count>0 THEN 'policy_or_composition_helper'
    ELSE 'app_endpoint'
  END,
  CASE
    WHEN anonymous_execute THEN 'verified'
    WHEN proname ~ '^(owner_|principal_).+_api_v[0-9]+$' THEN 'verified'
    WHEN proname ~ '(_for_member_v[0-9]+|_api_v[0-9]+)$' THEN 'verified'
    WHEN policy_reference_count>0 OR trigger_count>0 THEN 'verified'
    ELSE 'provisional'
  END,
  CASE
    WHEN trigger_count>0 OR (NOT prosecdef AND caller_count>0) THEN 'pending_revoke'
    ELSE 'active'
  END,
  authenticated_execute,anonymous_execute,prosecdef,service_execute,
  caller_count,policy_reference_count,
  jsonb_build_object(
    'source','production_catalog_reconciliation_20260819',
    'reconciliation','atlas_rpc_privilege_registry_reconciliation_v2',
    'publicInheritanceRemoved',true,
    'triggerReferenceCount',trigger_count,
    'classificationRuleVersion',2,
    'truthBoundary','Current signed-in/service behavior was preserved while implicit PUBLIC/anonymous execution was removed. Provisional rows require later narrowing evidence, not guessed revocation.'
  ),
  now(),now()
FROM missing
ORDER BY signature;

CREATE OR REPLACE FUNCTION atlas.authenticated_rpc_registry_drift_v1()
RETURNS TABLE(issue text,signature text,detail jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,atlas
AS $function$
  WITH actual AS (
    SELECT
      p.oid,
      format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) AS signature,
      p.prosecdef AS security_definer,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='atlas' AND p.prokind='f'
  ), registry AS (
    SELECT r.*,to_regprocedure(r.signature)::oid AS function_oid
    FROM atlas.authenticated_rpc_registry r
  )
  SELECT 'unregistered_authenticated'::text,a.signature,
         jsonb_build_object('authenticated_execute',true)
  FROM actual a
  WHERE a.authenticated_execute
    AND NOT EXISTS(SELECT 1 FROM registry r WHERE r.function_oid=a.oid)

  UNION ALL
  SELECT 'missing_expected_authenticated',r.signature,
         jsonb_build_object('function_exists',a.oid IS NOT NULL,'authenticated_execute',coalesce(a.authenticated_execute,false))
  FROM registry r
  LEFT JOIN actual a ON a.oid=r.function_oid
  WHERE r.authenticated_execute_expected
    AND (a.oid IS NULL OR NOT a.authenticated_execute)

  UNION ALL
  SELECT 'unexpected_authenticated',r.signature,
         jsonb_build_object('authenticated_execute',a.authenticated_execute)
  FROM registry r
  JOIN actual a ON a.oid=r.function_oid
  WHERE NOT r.authenticated_execute_expected AND a.authenticated_execute

  UNION ALL
  SELECT 'security_mode_mismatch',r.signature,
         jsonb_build_object('expected_security_definer',r.security_definer_expected,'actual_security_definer',a.security_definer)
  FROM registry r
  JOIN actual a ON a.oid=r.function_oid
  WHERE r.security_definer_expected IS DISTINCT FROM a.security_definer

  UNION ALL
  SELECT 'service_execute_mismatch',r.signature,
         jsonb_build_object('expected_service_execute',r.service_execute_expected,'actual_service_execute',a.service_execute)
  FROM registry r
  JOIN actual a ON a.oid=r.function_oid
  WHERE r.service_execute_expected IS DISTINCT FROM a.service_execute

  UNION ALL
  SELECT 'anonymous_execute',a.signature,
         jsonb_build_object('anonymous_execute',true,'expected',coalesce(r.anonymous_execute_expected,false))
  FROM actual a
  LEFT JOIN registry r ON r.function_oid=a.oid
  WHERE a.anonymous_execute AND coalesce(r.anonymous_execute_expected,false)=false

  UNION ALL
  SELECT 'missing_expected_anonymous',r.signature,
         jsonb_build_object('function_exists',a.oid IS NOT NULL,'anonymous_execute',coalesce(a.anonymous_execute,false))
  FROM registry r
  LEFT JOIN actual a ON a.oid=r.function_oid
  WHERE r.anonymous_execute_expected
    AND (a.oid IS NULL OR NOT a.anonymous_execute)
$function$;

REVOKE ALL ON FUNCTION atlas.authenticated_rpc_registry_drift_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION atlas.authenticated_rpc_registry_drift_v1()
  TO service_role;

COMMENT ON FUNCTION atlas.authenticated_rpc_registry_drift_v1() IS
  'Service-only Atlas RPC privilege proof. Registry identity resolves through function OIDs, expected public endpoints may explicitly grant anon, and PUBLIC execution is never accepted as an implicit boundary.';

DO $verification$
DECLARE
  v_public_execute integer;
  v_drift integer;
  v_auth_before integer;
  v_auth_after integer;
  v_service_before integer;
  v_service_after integer;
  v_explicit_anon_before integer;
  v_anon_after integer;
  v_expected_anon integer;
BEGIN
  SELECT count(*) FILTER (WHERE authenticated_execute_before),
         count(*) FILTER (WHERE service_execute_before),
         count(*) FILTER (WHERE explicit_anonymous_execute_before)
  INTO v_auth_before,v_service_before,v_explicit_anon_before
  FROM atlas_rpc_privilege_snapshot_v2;

  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated',p.oid,'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('service_role',p.oid,'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon',p.oid,'EXECUTE'))
  INTO v_auth_after,v_service_after,v_anon_after
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='atlas' AND p.prokind='f';

  SELECT count(DISTINCT p.oid)
  INTO v_public_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  WHERE n.nspname='atlas' AND p.prokind='f'
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE';

  SELECT count(*) INTO v_expected_anon
  FROM atlas.authenticated_rpc_registry
  WHERE anonymous_execute_expected;

  SELECT count(*) INTO v_drift
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF v_public_execute<>0 THEN
    RAISE EXCEPTION 'Atlas RPC reconciliation left % functions executable by PUBLIC.',v_public_execute;
  END IF;
  IF v_auth_after<>v_auth_before THEN
    RAISE EXCEPTION 'Authenticated Atlas behavior changed during privilege reconciliation: before %, after %.',v_auth_before,v_auth_after;
  END IF;
  IF v_service_after<>v_service_before THEN
    RAISE EXCEPTION 'Service Atlas behavior changed during privilege reconciliation: before %, after %.',v_service_before,v_service_after;
  END IF;
  IF v_anon_after<>v_explicit_anon_before OR v_anon_after<>v_expected_anon THEN
    RAISE EXCEPTION 'Anonymous Atlas execution is not exactly the explicitly governed public endpoint set: explicit before %, after %, expected %.',v_explicit_anon_before,v_anon_after,v_expected_anon;
  END IF;
  IF v_drift<>0 THEN
    RAISE EXCEPTION 'Atlas RPC privilege registry reconciliation ended with % drift rows.',v_drift;
  END IF;
END
$verification$;
