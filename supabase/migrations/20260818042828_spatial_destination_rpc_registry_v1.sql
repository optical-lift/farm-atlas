insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values
(
  'atlas.crop_spatial_destination_reality_expression_v1(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object('purpose','Phase 10 crop-domain spatial destination Reality Expression packet.','boundary','Read-only service composition. Current placement is not future destination; complete spatial claims still do not satisfy weather/timing/biology/capacity gates.'),now()
),
(
  'atlas.crop_destination_claim_coverage_v1(uuid)',
  'service_internal','verified','active',false,false,true,2,0,
  jsonb_build_object('purpose','Quantifies whether active crop destination claims cover the known moving cohort.','boundary','Read-only service composition; unknown cohort size remains unknown rather than inferred.'),now()
),
(
  'atlas.record_crop_destination_claim_v1(uuid, uuid, numeric, text, date, text, text, text, uuid, text, jsonb, text)',
  'service_internal','verified','active',false,true,true,0,0,
  jsonb_build_object('purpose','Idempotent service writer for crop-domain pre-placement destination claims.','boundary','No direct authenticated execution; writes only canonical future destination claims, never current occupancy.'),now()
),
(
  'atlas.ensure_crop_destination_resolution_v1(uuid)',
  'service_internal','verified','active',false,true,true,1,0,
  jsonb_build_object('purpose','Ensures a move-ready crop body has a lawful Farm Operations destination-resolution or source-reconciliation occurrence when no claim exists.','boundary','Generated work flows through planned_work_occurrences; principal escalation is not created.'),now()
),
(
  'atlas.ensure_task_destination_resolution_v1(uuid)',
  'service_internal','verified','active',false,true,true,1,0,
  jsonb_build_object('purpose','Ensures an unresolved transplant task has a lawful Farm Operations destination-resolution occurrence.','boundary','Resolution path does not make the transplant executable and does not create Principal work.'),now()
),
(
  'atlas.farm_continuity_audit_v4(uuid, date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Phase 10-aware Farm Continuity audit that distinguishes spatial silence from governed claim/wait/resolution continuation.','boundary','Does not suppress unrelated continuity debt; destination resolution occurrences are continuation, not execution release.'),now()
)
on conflict(signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;