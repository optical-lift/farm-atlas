revoke all on function atlas.record_harvest_watch_observation_for_member_v1(uuid,uuid,text,numeric,text,date,text,text) from public;
revoke execute on function atlas.record_harvest_watch_observation_for_member_v1(uuid,uuid,text,numeric,text,date,text,text) from anon, authenticated, service_role;

revoke all on function atlas.owner_operator_record_harvest_watch_observation_v1(uuid,uuid,text,numeric,text,date,text,text) from public;
revoke execute on function atlas.owner_operator_record_harvest_watch_observation_v1(uuid,uuid,text,numeric,text,date,text,text) from anon, authenticated, service_role;

update atlas.authenticated_rpc_registry
set review_status='revoked',
    authenticated_execute_expected=false,
    service_execute_expected=false,
    confidence='verified',
    evidence=evidence || jsonb_build_object(
      'retiredReason','Interactive harvest_watch tasks are canonically suppressed into archived system-internal harvest_horizon_marker tasks by suppress_harvest_watch_task_v1.',
      'replacementTruth','Current Harvest execution uses harvest horizon/readiness machinery and actual harvest-output commands; the legacy interactive watch writer must not remain callable.',
      'retiredAt',now()
    ),
    reviewed_at=now()
where signature in (
  'atlas.record_harvest_watch_observation_for_member_v1(uuid, uuid, text, numeric, text, date, text, text)',
  'atlas.owner_operator_record_harvest_watch_observation_v1(uuid, uuid, text, numeric, text, date, text, text)'
);