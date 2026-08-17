revoke all on function atlas.refresh_production_postharvest_gate_v1(uuid) from public;
revoke execute on function atlas.refresh_production_postharvest_gate_v1(uuid) from anon, authenticated;
grant execute on function atlas.refresh_production_postharvest_gate_v1(uuid) to service_role;

update atlas.authenticated_rpc_registry
set classification='service_internal',
    confidence='verified',
    review_status='active',
    authenticated_execute_expected=false,
    security_definer_expected=true,
    service_execute_expected=true,
    caller_count=0,
    evidence=jsonb_build_object(
      'purpose','Internal recomputation of canonical production postharvest custody gate state',
      'boundary','No direct app execution: function mutates harvest state and may emit operational tasks from a harvest-lot id without an app-level membership parameter',
      'securityTruth','Authenticated execution revoked; service/internal execution only',
      'callerTruth','No database function or trigger callers were found at release audit; retained as explicit service maintenance primitive'
    ),
    reviewed_at=now()
where signature='atlas.refresh_production_postharvest_gate_v1(uuid)';