-- Repair the live authenticated RPC registry for databases where the farm-day
-- reader migration was already applied before its registry UPSERT was added.

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
  evidence,
  reviewed_at
)
VALUES (
  'atlas.farm_day_task_cards_v1(uuid, date)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  0,
  0,
  jsonb_build_object(
    'source', 'manager_farm_day_registry_repair',
    'registered_by_migration', '20260804054500_atlas_manager_farm_day_rpc_registry_repair_v1.sql'
  ),
  now()
)
ON CONFLICT (signature) DO UPDATE
SET classification = EXCLUDED.classification,
    confidence = EXCLUDED.confidence,
    review_status = EXCLUDED.review_status,
    authenticated_execute_expected = EXCLUDED.authenticated_execute_expected,
    security_definer_expected = EXCLUDED.security_definer_expected,
    service_execute_expected = EXCLUDED.service_execute_expected,
    evidence = atlas.authenticated_rpc_registry.evidence || EXCLUDED.evidence,
    reviewed_at = now();

DO $verification$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atlas.authenticated_rpc_registry_drift_v1()
    WHERE signature = 'atlas.farm_day_task_cards_v1(uuid, date)'
  ) THEN
    RAISE EXCEPTION 'Farm-day reader still drifts from the authenticated RPC registry.';
  END IF;
END
$verification$;