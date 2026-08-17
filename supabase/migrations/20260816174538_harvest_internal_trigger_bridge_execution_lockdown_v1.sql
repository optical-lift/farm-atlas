revoke all on function atlas.bridge_production_harvest_lot_to_event_v1() from public;
revoke execute on function atlas.bridge_production_harvest_lot_to_event_v1() from anon, authenticated;
grant execute on function atlas.bridge_production_harvest_lot_to_event_v1() to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.bridge_production_harvest_lot_to_event_v1()',
  'service_internal','verified','active',false,true,true,1,0,
  jsonb_build_object(
    'purpose','Trigger-only bridge from canonical production harvest lot truth into production lot actual-event history',
    'boundary','Not an app endpoint; invoked only by the production_harvest_lots AFTER INSERT trigger',
    'securityTruth','Authenticated execution revoked; service/internal execution retained',
    'harvestTruth','Bridge records actual harvest consequence and does not create commercial Ready/sale truth'
  ),now(),now()
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
  reviewed_at=now();