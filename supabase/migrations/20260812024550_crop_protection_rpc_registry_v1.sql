begin;

-- Keep the authenticated Owner endpoint available to service execution as well,
-- matching the rest of the reviewed Atlas app-endpoint contract.
grant execute on function atlas.owner_configure_crop_protection_policy_v1(uuid,text,text[],integer)
  to service_role;

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
) values (
  'atlas.owner_configure_crop_protection_policy_v1(uuid,text,text[],integer)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  2,
  jsonb_build_object(
    'source','crop_protection_rpc_registry_v1',
    'call_site','Owner crop-protection method configuration',
    'authorization','function verifies atlas.is_farm_owner(policy.farm_id) before changing method truth',
    'reviewed_date','2026-08-12'
  ),
  now(),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb)||excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;
