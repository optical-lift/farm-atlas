-- Harvest commercial cancellation/disposition authenticated RPC reconciliation.
-- The four signed-in wrappers are explicit app/owner endpoints; helpers and cores remain service-only.

revoke all on function atlas.cancel_flower_sale_for_member_v1(uuid,uuid,text,text,text) from public,anon;
revoke all on function atlas.owner_operator_cancel_flower_sale_v1(uuid,uuid,text,text,text) from public,anon;
revoke all on function atlas.record_flower_ready_disposition_for_member_v1(uuid,uuid,text,numeric,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_ready_disposition_v1(uuid,uuid,text,numeric,text,text) from public,anon;

grant execute on function atlas.cancel_flower_sale_for_member_v1(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_cancel_flower_sale_v1(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function atlas.record_flower_ready_disposition_for_member_v1(uuid,uuid,text,numeric,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_ready_disposition_v1(uuid,uuid,text,numeric,text,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry (
  signature,classification,confidence,review_status,authenticated_execute_expected,
  security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,reviewed_at
)
values
(
  'atlas.cancel_flower_sale_for_member_v1(uuid, uuid, text, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Append one cancellation fact for an unfulfilled flower sale and release its Ready claims by projection',
    'boundary','active farm membership required; Farm Hand may cancel only sales they recorded',
    'historyTruth','original sale and Ready birth rows remain immutable',
    'fulfillmentTruth','fulfilled orders cannot use this cancellation path',
    'financialTruth','cancellation does not imply refund or payment reversal'
  ),now()
),
(
  'atlas.owner_operator_cancel_flower_sale_v1(uuid, uuid, text, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the same append-only flower sale cancellation while Owner operates as an effective farm membership',
    'boundary','owner_operator_context_v1 resolves the effective membership and farm scope',
    'inventoryTruth','claim release occurs only through cancellation projection; sale lines are not deleted'
  ),now()
),
(
  'atlas.record_flower_ready_disposition_for_member_v1(uuid, uuid, text, numeric, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Append explicit Ready inventory removal for spoilage, donation, or write-off',
    'boundary','Farm Hand may record physical spoilage only; management authority is required for donation/write-off',
    'inventoryTruth','cannot exceed current Available quantity and never mutates the Ready birth row'
  ),now()
),
(
  'atlas.owner_operator_record_flower_ready_disposition_v1(uuid, uuid, text, numeric, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the same Ready disposition while Owner operates as an effective farm membership',
    'boundary','owner_operator_context_v1 resolves effective membership before the service-only core mutation',
    'inventoryTruth','append-only disposition subtracts from Available by projection'
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
