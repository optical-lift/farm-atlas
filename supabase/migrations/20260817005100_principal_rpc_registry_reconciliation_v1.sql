begin;

-- Principal Operating System authenticated RPC registry reconciliation.
-- These functions were introduced by the Principal foundation/Clock/Office tranches before
-- their authenticated EXECUTE surface was reconciled into the fail-closed registry.

revoke all on function atlas.principal_capacity_day_state_v1(uuid,date) from public, anon;
revoke all on function atlas.principal_clock_api_v1(date,timestamptz) from public, anon;
revoke all on function atlas.principal_house_position_api_v1() from public, anon;
revoke all on function atlas.principal_office_context_api_v1() from public, anon;
revoke all on function atlas.principal_record_attention_event_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_record_great_game_score_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_record_house_position_snapshot_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_self_context_api_v1() from public, anon;
revoke all on function atlas.principal_set_capacity_policy_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_update_operational_escalation_api_v1(uuid,text,text) from public, anon;
revoke all on function atlas.principal_upsert_attention_policy_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_capital_request_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_great_game_scorecard_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_household_event_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_household_rhythm_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_household_rhythm_local_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_investment_opportunity_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_operating_function_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_owner_obligation_api_v1(jsonb) from public, anon;
revoke all on function atlas.principal_upsert_portfolio_thesis_api_v1(jsonb) from public, anon;

grant execute on function atlas.principal_capacity_day_state_v1(uuid,date) to authenticated, service_role;
grant execute on function atlas.principal_clock_api_v1(date,timestamptz) to authenticated, service_role;
grant execute on function atlas.principal_house_position_api_v1() to authenticated, service_role;
grant execute on function atlas.principal_office_context_api_v1() to authenticated, service_role;
grant execute on function atlas.principal_record_attention_event_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_record_great_game_score_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_record_house_position_snapshot_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_self_context_api_v1() to authenticated, service_role;
grant execute on function atlas.principal_set_capacity_policy_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_update_operational_escalation_api_v1(uuid,text,text) to authenticated, service_role;
grant execute on function atlas.principal_upsert_attention_policy_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_capital_request_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_great_game_scorecard_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_household_event_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_household_rhythm_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_household_rhythm_local_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_investment_opportunity_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_operating_function_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_owner_obligation_api_v1(jsonb) to authenticated, service_role;
grant execute on function atlas.principal_upsert_portfolio_thesis_api_v1(jsonb) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
('atlas.principal_capacity_day_state_v1(uuid, date)','policy_or_composition_helper','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Resolve Principal capacity for a local service date','boundary','active Principal capacity policy plus capacity-block truth'),now()),
('atlas.principal_clock_api_v1(date, timestamp with time zone)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Return arbitrated Principal Clock state','boundary','Principal identity and canonical Clock candidates'),now()),
('atlas.principal_house_position_api_v1()','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Return Principal House Position with source, coverage, freshness, capital requests, and opportunities','boundary','Principal-scoped financial stewardship truth'),now()),
('atlas.principal_office_context_api_v1()','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Compose Principal Office theses, attention, functions, scorecards, and House Position','boundary','Principal-scoped institutional memory'),now()),
('atlas.principal_record_attention_event_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record a Principal attention event','boundary','active Principal attention subject'),now()),
('atlas.principal_record_great_game_score_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record an observed Great Game score','boundary','active Principal scorecard'),now()),
('atlas.principal_record_house_position_snapshot_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record a sourced House Position snapshot','boundary','Principal treasury evidence with source and freshness'),now()),
('atlas.principal_self_context_api_v1()','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Return the authenticated Principal root context','boundary','auth.uid maps to one active Principal identity'),now()),
('atlas.principal_set_capacity_policy_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author Principal capacity policy','boundary','Principal-authored weekday and local-time capacity constraint'),now()),
('atlas.principal_update_operational_escalation_api_v1(uuid, text, text)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Update an operational exception that crossed the Principal escalation boundary','boundary','delegated work remains contained until explicit escalation'),now()),
('atlas.principal_upsert_attention_policy_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author protected attention cadence','boundary','Principal institutional memory; not task recurrence'),now()),
('atlas.principal_upsert_capital_request_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author a capital request','boundary','request is a stewardship claim, not approval or balance'),now()),
('atlas.principal_upsert_great_game_scorecard_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author a Great Game scorecard and Critical Number','boundary','higher-level operating signal, not task inventory'),now()),
('atlas.principal_upsert_household_event_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author a dated household event','boundary','Household is a protected Principal domain, not farm work'),now()),
('atlas.principal_upsert_household_rhythm_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author canonical household rhythm truth','boundary','household rhythm may block capacity without becoming farm work'),now()),
('atlas.principal_upsert_household_rhythm_local_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author household rhythm from household-local wall-clock values','boundary','active Principal household timezone governs canonical timestamps'),now()),
('atlas.principal_upsert_investment_opportunity_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author investment opportunity and readiness','boundary','readiness remains distinct from funding and approval'),now()),
('atlas.principal_upsert_operating_function_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author a durable operating function','boundary','function persists independently of current carrier'),now()),
('atlas.principal_upsert_owner_obligation_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author strategic work only ownership can carry','boundary','Owner Obligation is not an ordinary delegated task'),now()),
('atlas.principal_upsert_portfolio_thesis_api_v1(jsonb)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Author portfolio thesis and next value milestone','boundary','thesis is stated by Principal, never inferred from task volume'),now())
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

commit;
