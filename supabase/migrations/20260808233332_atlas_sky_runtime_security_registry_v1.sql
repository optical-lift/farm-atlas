revoke all on function atlas.sky_rule_state_complete_v1(jsonb,jsonb) from public,authenticated,anon;
revoke all on function atlas.next_sky_rule_match_v1(uuid,timestamptz,integer) from public,authenticated,anon;
grant execute on function atlas.sky_rule_state_complete_v1(jsonb,jsonb) to service_role;
grant execute on function atlas.next_sky_rule_match_v1(uuid,timestamptz,integer) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
('atlas.sky_state_at_v2(uuid, timestamp with time zone)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read interpretation-free sky state with explicit coverage/fail-open support'),now(),now()),
('atlas.task_sky_fitness_v2(uuid, timestamp with time zone)','app_endpoint','verified','active',true,true,true,2,0,jsonb_build_object('purpose','Resolve approved operation timing against measured sky state; fail open when coverage is incomplete'),now(),now()),
('atlas.task_sky_presentation_gate_v1(uuid, date)','policy_or_composition_helper','verified','active',true,true,true,2,0,jsonb_build_object('purpose','Hold only floating undated windowed work outside favored sky windows'),now(),now()),
('atlas.sky_ledger_status_v1(uuid)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Report cached sky-ledger coverage and freshness for authenticated maintenance'),now(),now())
on conflict (signature) do update
set classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,caller_count=excluded.caller_count,policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,reviewed_at=excluded.reviewed_at;
