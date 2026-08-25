do $block$
declare
  v_registry atlas.authenticated_rpc_registry%rowtype;
  v_function regprocedure;
begin
  v_function := to_regprocedure('atlas.advance_anna_weeding_serial_queue_v1()');
  if v_function is null then
    raise exception 'Anna weeding serial trigger function is missing; custody repair cannot proceed.' using errcode='55000';
  end if;

  select * into v_registry
  from atlas.authenticated_rpc_registry
  where signature='atlas.advance_anna_weeding_serial_queue_v1()'
  for update;

  if v_registry.signature is null then
    raise exception 'Anna weeding serial trigger registry row is missing; custody repair cannot proceed.' using errcode='55000';
  end if;

  if has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('service_role',v_function,'EXECUTE')
     or has_function_privilege('anon',v_function,'EXECUTE') then
    raise exception 'Anna weeding serial trigger unexpectedly remains directly executable; this is not a metadata-only custody repair.' using errcode='23514';
  end if;

  update atlas.authenticated_rpc_registry
  set service_execute_expected=false,
      reviewed_at=now(),
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'serviceExecuteExpectationReconciledBy','state_progression_anna_weeding_rpc_custody_repair_v1',
        'serviceExecuteRevokedBy','state_progression_anna_weeding_completion_gate_effect_v1',
        'triggerInvocationDoesNotRequireDirectServiceExecute',true,
        'custodyOnly',true
      )
  where signature='atlas.advance_anna_weeding_serial_queue_v1()';
end;
$block$;