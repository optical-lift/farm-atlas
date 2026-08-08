begin;

-- authenticated_rpc_registry keys use PostgreSQL oidvectortypes formatting,
-- which includes spaces after commas. Normalize the two outreach entries so
-- drift inspection resolves them to the actual functions.
delete from atlas.authenticated_rpc_registry
where signature in (
  'atlas.record_network_outreach_result_v1(uuid,text,text,text,text,text,date,time without time zone,integer,boolean,text,uuid)',
  'atlas.release_network_outreach_batch_v1(uuid,text,uuid)'
);

insert into atlas.authenticated_rpc_registry(
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
  registered_at,
  reviewed_at
) values
(
  'atlas.record_network_outreach_result_v1(uuid, text, text, text, text, text, date, time without time zone, integer, boolean, text, uuid)',
  'app_endpoint','verified','active',true,true,true,1,3,
  jsonb_build_object(
    'source','network_outreach_rpc_registry_signature_fix',
    'call_site','Network outreach contact checklist',
    'authorization','assigned worker or owner/manager with active membership on task farm',
    'writes','structured outreach result plus Thursdays at Elm community event',
    'reviewed_date','2026-08-08'
  ),now(),now()
),
(
  'atlas.release_network_outreach_batch_v1(uuid, text, uuid)',
  'app_endpoint','verified','active',true,true,true,1,3,
  jsonb_build_object(
    'source','network_outreach_rpc_registry_signature_fix',
    'call_site','Network outreach batch completion',
    'authorization','assigned worker or owner/manager with active membership on task farm',
    'writes','releases the prebuilt next outreach batch after all child results are complete',
    'reviewed_date','2026-08-08'
  ),now(),now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb) || excluded.evidence,
    reviewed_at = excluded.reviewed_at;

commit;
