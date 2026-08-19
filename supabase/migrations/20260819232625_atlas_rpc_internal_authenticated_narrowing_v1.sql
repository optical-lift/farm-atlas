-- P0 follow-through: retire direct authenticated execution for service-internal
-- routines when it is safe to do so, and explicitly classify the small set of
-- helpers that still participate in SECURITY INVOKER composition chains.

DO $reconcile_pending_internal$
DECLARE
  v record;
  v_has_trigger boolean;
  v_has_invoker_caller boolean;
  v_has_policy_reference boolean;
BEGIN
  FOR v IN
    SELECT
      r.signature,
      to_regprocedure(r.signature)::oid AS function_oid,
      p.proname
    FROM atlas.authenticated_rpc_registry r
    JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)::oid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='atlas'
      AND r.classification='service_internal'
      AND r.review_status='pending_revoke'
      AND r.authenticated_execute_expected
    ORDER BY r.signature
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM pg_trigger t
      WHERE t.tgfoid=v.function_oid AND NOT t.tgisinternal
    ) INTO v_has_trigger;

    SELECT EXISTS(
      SELECT 1
      FROM pg_proc caller
      JOIN pg_namespace caller_namespace ON caller_namespace.oid=caller.pronamespace
      WHERE caller_namespace.nspname='atlas'
        AND caller.oid<>v.function_oid
        AND caller.prokind='f'
        AND NOT caller.prosecdef
        AND (
          position(lower(v.proname)||'(' IN lower(pg_get_functiondef(caller.oid)))>0
          OR position(lower(v.proname)||' (' IN lower(pg_get_functiondef(caller.oid)))>0
        )
    ) INTO v_has_invoker_caller;

    SELECT EXISTS(
      SELECT 1
      FROM pg_policies policy
      WHERE position(lower(v.proname)||'(' IN lower(coalesce(policy.qual,'')||' '||coalesce(policy.with_check,'')))>0
         OR position(lower(v.proname)||' (' IN lower(coalesce(policy.qual,'')||' '||coalesce(policy.with_check,'')))>0
    ) INTO v_has_policy_reference;

    IF v_has_trigger OR (NOT v_has_invoker_caller AND NOT v_has_policy_reference) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated',v.signature);

      UPDATE atlas.authenticated_rpc_registry
      SET authenticated_execute_expected=false,
          review_status='revoked',
          confidence='verified',
          evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
            'authenticatedDirectExecuteRevokedBy','atlas_rpc_internal_authenticated_narrowing_v1',
            'triggerFunction',v_has_trigger,
            'securityInvokerCallerPresent',v_has_invoker_caller,
            'policyReferencePresent',v_has_policy_reference,
            'boundary','Direct browser execution is not required for this service-internal routine.'
          ),
          reviewed_at=now()
      WHERE signature=v.signature;
    ELSE
      UPDATE atlas.authenticated_rpc_registry
      SET classification='policy_or_composition_helper',
          review_status='active',
          confidence='verified',
          evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
            'authenticatedCompositionConfirmedBy','atlas_rpc_internal_authenticated_narrowing_v1',
            'securityInvokerCallerPresent',v_has_invoker_caller,
            'policyReferencePresent',v_has_policy_reference,
            'boundary','Authenticated EXECUTE remains explicit because a SECURITY INVOKER composition or policy path still requires the helper. It is not classified as a standalone app endpoint.'
          ),
          reviewed_at=now()
      WHERE signature=v.signature;
    END IF;
  END LOOP;
END
$reconcile_pending_internal$;

DO $verification$
DECLARE
  v_pending integer;
  v_internal_auth integer;
  v_drift integer;
  v_public integer;
BEGIN
  SELECT count(*) INTO v_pending
  FROM atlas.authenticated_rpc_registry
  WHERE classification='service_internal' AND review_status='pending_revoke';

  SELECT count(*) INTO v_internal_auth
  FROM atlas.authenticated_rpc_registry
  WHERE classification='service_internal' AND authenticated_execute_expected;

  SELECT count(*) INTO v_drift FROM atlas.authenticated_rpc_registry_drift_v1();

  SELECT count(DISTINCT p.oid) INTO v_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  WHERE n.nspname='atlas' AND p.prokind='f'
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE';

  IF v_pending<>0 THEN
    RAISE EXCEPTION 'Atlas RPC narrowing left % service-internal routines pending revoke.',v_pending;
  END IF;
  IF v_internal_auth<>0 THEN
    RAISE EXCEPTION 'Atlas RPC narrowing left % service-internal routines directly executable by authenticated.',v_internal_auth;
  END IF;
  IF v_public<>0 THEN
    RAISE EXCEPTION 'Atlas RPC narrowing found % functions still executable by PUBLIC.',v_public;
  END IF;
  IF v_drift<>0 THEN
    RAISE EXCEPTION 'Atlas RPC narrowing ended with % registry drift rows.',v_drift;
  END IF;
END
$verification$;