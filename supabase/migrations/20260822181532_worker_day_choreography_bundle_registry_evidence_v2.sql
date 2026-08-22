DO $migration$
DECLARE
  v_rows integer;
BEGIN
  update atlas.authenticated_rpc_registry
  set evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
        'performance', 'Worker Day choreography and reservations are wired through one authenticated bundle RPC; the prior parallel server reads are retired from this path.',
        'deploymentCommit', '516fa7f8163a6adc119f8cc5aa346806a755f4f5'
      ),
      reviewed_at = now()
  where signature = 'atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date)';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Worker Day choreography bundle RPC registry row; updated %.', v_rows;
  END IF;
END
$migration$;