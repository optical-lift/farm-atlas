revoke all on function atlas.project_path_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.project_path_v1(uuid) to service_role;

revoke all on function atlas.task_move_context_batch_v1(uuid[]) from public,anon;
grant execute on function atlas.task_move_context_batch_v1(uuid[]) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.task_move_context_batch_v1(uuid[])',
  'app_endpoint','verified','active',true,true,true,1,2,
  jsonb_build_object(
    'purpose','Read WHY / UNLOCKS / ADVANCES / WAITING ON context for signed-in Day task cards.',
    'authorization','Each returned task must be assigned to the caller, share an active farm membership with the caller, or belong to a project the caller can read.',
    'privacyBoundary','project_path_v1 remains service-only; project hierarchy is exposed only through authorized composition functions.'
  ),now(),now()
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
