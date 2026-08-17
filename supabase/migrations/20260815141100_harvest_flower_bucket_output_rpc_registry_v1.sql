-- Flower harvest physical-output authenticated RPC registry reconciliation v1.
-- Keeps the new bucket-scale write membrane explicit and reviewable.

revoke all on function atlas.record_flower_harvest_output_for_member_v1(uuid,uuid,text,boolean,text,text) from public, anon;
revoke all on function atlas.owner_operator_record_flower_harvest_output_v1(uuid,uuid,text,boolean,text,text) from public, anon;

grant execute on function atlas.record_flower_harvest_output_for_member_v1(uuid,uuid,text,boolean,text,text) to authenticated, service_role;
grant execute on function atlas.owner_operator_record_flower_harvest_output_v1(uuid,uuid,text,boolean,text,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
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
values
(
  'atlas.record_flower_harvest_output_for_member_v1(uuid, uuid, text, boolean, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record one canonical flower-harvest physical output at bucket-equivalent scale',
    'boundary','signed-in active farm membership; Farm Hand may record only an assigned harvest task',
    'physicalTruth','records harvested physical output without claiming finished saleable inventory or stem precision',
    'clockTruth','completes lawful harvest execution but does not own worker-time placement'
  ),now()
),
(
  'atlas.owner_operator_record_flower_harvest_output_v1(uuid, uuid, text, boolean, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record bucket-scale flower harvest while an Owner is operating as an effective farm membership',
    'boundary','Owner operator context must resolve the effective membership and role before the core write',
    'physicalTruth','records the same physical output contract as the Farm Hand path; no privileged inventory precision is invented',
    'clockTruth','operator mode does not convert Harvest into a Principal scheduling surface'
  ),now()
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
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;
