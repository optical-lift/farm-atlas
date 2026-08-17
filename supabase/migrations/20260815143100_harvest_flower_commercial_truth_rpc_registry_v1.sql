-- Harvest Pass 5 authenticated RPC registry reconciliation.
-- Commercial commitment and fulfillment writes stay explicit; internal validation/planning
-- and core mutation functions remain outside the signed-in execution surface. Buyer selection
-- uses a minimal scoped reader instead of weakening the relationship table's direct RLS.

revoke all on function atlas.flower_sale_buyer_options_v1(uuid) from public,anon;
revoke all on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) from public,anon;
revoke all on function atlas.record_flower_fulfillment_for_member_v1(uuid,uuid,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_flower_fulfillment_v1(uuid,uuid,text,text) from public,anon;

grant execute on function atlas.flower_sale_buyer_options_v1(uuid) to authenticated,service_role;
grant execute on function atlas.record_flower_sale_for_member_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_sale_v1(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,date,time,uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.record_flower_fulfillment_for_member_v1(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_operator_record_flower_fulfillment_v1(uuid,uuid,text,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry (
  signature,classification,confidence,review_status,authenticated_execute_expected,
  security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,reviewed_at
)
values
(
  'atlas.flower_sale_buyer_options_v1(uuid)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Return minimal buyer identity/status fields needed to attach an explicit flower sale',
    'boundary','active farm membership required; direct buyer_relationship_reconstruction RLS remains sealed',
    'dataMinimization','returns id, business name, buyer type, relationship status, and priority only',
    'relationshipTruth','reader does not create outreach, sale, or fulfillment truth'
  ),now()
),
(
  'atlas.record_flower_sale_for_member_v1(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, date, time without time zone, uuid, uuid, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record one explicit flower commercial commitment from specific Ready inventory lots',
    'boundary','signed-in active farm membership; Ready birth truth is never mutated',
    'relationshipTruth','buyer relationship and outreach remain upstream; contact quantity or price does not imply sale',
    'inventoryTruth','sale lines claim specific Ready lots and cannot exceed remaining unclaimed Ready quantity',
    'fulfillmentTruth','sale does not imply handoff; future pickup or delivery releases normal Worker Day work'
  ),now()
),
(
  'atlas.owner_operator_record_flower_sale_v1(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, date, time without time zone, uuid, uuid, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the same flower sale truth while an Owner operates as an effective farm membership',
    'boundary','owner_operator_context_v1 must resolve the effective membership and root farm scope',
    'inventoryTruth','operator mode cannot bypass Ready-lot lineage or overclaim inventory',
    'clockTruth','future fulfillment is farm operational work; operator mode does not convert it into Principal work'
  ),now()
),
(
  'atlas.record_flower_fulfillment_for_member_v1(uuid, uuid, text, text)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record actual handoff for an assigned future flower fulfillment task',
    'boundary','signed-in active farm membership; Farm Hand may complete only assigned fulfillment work',
    'fulfillmentTruth','task existence, due date, or sale commitment never imply fulfillment; this RPC creates the handoff fact',
    'transitionTruth','completion writes through canonical task transition only after the fulfillment event exists'
  ),now()
),
(
  'atlas.owner_operator_record_flower_fulfillment_v1(uuid, uuid, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the same actual flower handoff while an Owner operates as an effective farm membership',
    'boundary','owner operator context resolves the effective membership before the core write',
    'fulfillmentTruth','operator mode cannot manufacture fulfillment without a committed sale order and lawful fulfillment task',
    'principalTruth','this remains farm execution truth and does not itself become Principal Clock work'
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
