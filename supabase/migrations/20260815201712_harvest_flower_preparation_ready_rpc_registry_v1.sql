revoke all on function atlas.record_flower_preparation_for_member_v1(uuid,uuid,jsonb,boolean,text,text) from public, anon;
revoke all on function atlas.owner_operator_record_flower_preparation_v1(uuid,uuid,jsonb,boolean,text,text) from public, anon;

grant execute on function atlas.record_flower_preparation_for_member_v1(uuid,uuid,jsonb,boolean,text,text) to authenticated, service_role;
grant execute on function atlas.owner_operator_record_flower_preparation_v1(uuid,uuid,jsonb,boolean,text,text) to authenticated, service_role;

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
  'atlas.record_flower_preparation_for_member_v1(uuid, uuid, jsonb, boolean, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record one completed flower-preparation result and explicit Ready inventory outputs',
    'boundary','signed-in active farm membership; Farm Hand may record only the assigned preparation task',
    'inputTruth','consumes canonical flower_harvest_bucket_observations exactly once through immutable lineage',
    'inventoryTruth','Ready lots exist only after explicit completed preparation; forecast and raw harvest are never promoted by inference',
    'clockTruth','records execution result and may preserve a remaining preparation obligation; Worker Day/Clock owns placement'
  ),now()
),
(
  'atlas.owner_operator_record_flower_preparation_v1(uuid, uuid, jsonb, boolean, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the same completed flower-preparation truth while an Owner is operating as an effective farm membership',
    'boundary','Owner operator context must resolve the effective membership and role before the core write',
    'inventoryTruth','operator mode cannot bypass harvested-input lineage or create Ready inventory without preparation',
    'clockTruth','operator mode does not convert preparation into Principal prioritization'
  ),now()
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
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;