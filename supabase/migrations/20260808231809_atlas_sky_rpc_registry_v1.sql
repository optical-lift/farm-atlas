insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
(
  'atlas.sky_state_at_v1(uuid,timestamp with time zone)','app_endpoint','verified','active',
  true,true,true,0,0,
  jsonb_build_object('purpose','Farm-member read of interpretation-free sky state','boundary','facts only; no operation decision'),now(),now()
),
(
  'atlas.task_sky_fitness_v1(uuid,timestamp with time zone)','app_endpoint','verified','active',
  true,true,true,0,0,
  jsonb_build_object('purpose','Farm-member read of versioned operation/sky fitness result','guardrail','Unruled operations remain eligible and informative only'),now(),now()
),
(
  'atlas.ingest_sky_ledger_v1(uuid,timestamp with time zone,timestamp with time zone,text,jsonb,jsonb)','owner_admin_endpoint','verified','active',
  true,true,true,0,0,
  jsonb_build_object('purpose','Owner/manager ingestion of calculated factual sky samples and windows','authorization','function verifies active owner or manager membership'),now(),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    evidence=excluded.evidence,
    reviewed_at=now();
