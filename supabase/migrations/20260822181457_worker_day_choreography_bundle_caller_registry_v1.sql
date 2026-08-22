-- The combined choreography + reservations RPC is now the Worker Day server read
-- path. No privilege changes occur here; this migration updates registry evidence
-- so the governed RPC inventory matches the application caller surface.

DO $migration$
DECLARE
  v_rows integer;
BEGIN
  update atlas.authenticated_rpc_registry
  set caller_count = 1,
      evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
        'caller', 'lib/atlas/day-choreography-server.ts',
        'wired', true,
        'readShape', 'single choreography + reservations RPC',
        'replaces', jsonb_build_array(
          'worker_day_choreography_api_v1 direct server read',
          'parallel day_reservations_api_v2 server read'
        )
      ),
      reviewed_at = now()
  where signature = 'atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date)';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Worker Day choreography bundle RPC registry row; updated %.', v_rows;
  END IF;
END
$migration$;