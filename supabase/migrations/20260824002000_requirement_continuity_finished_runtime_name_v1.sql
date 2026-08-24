-- Finished-software naming: one surviving Requirement Continuity authority gets one stable runtime identity.
do $migration$
declare
  v_def text;
begin
  if to_regprocedure('atlas.requirement_continuity_audit_v2(uuid,date)') is null then
    raise exception 'canonical requirement_continuity_audit_v2(uuid,date) not found';
  end if;
  if to_regprocedure('atlas.requirement_continuity_audit(uuid,date)') is not null then
    raise exception 'finished requirement_continuity_audit(uuid,date) already exists';
  end if;

  alter function atlas.requirement_continuity_audit_v2(uuid,date)
    rename to requirement_continuity_audit;

  -- Terminal continuity is the only current composition caller. Rebind it to the stable name.
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='farm_continuity_terminal_census_v2'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_as_of_date date';
  if v_def is null then
    raise exception 'farm_continuity_terminal_census_v2 caller not found';
  end if;
  if position('requirement_continuity_audit_v2' in v_def)=0 then
    raise exception 'terminal census does not reference expected Requirement Continuity authority';
  end if;
  execute replace(v_def,'requirement_continuity_audit_v2','requirement_continuity_audit');

  delete from atlas.authenticated_rpc_registry
  where signature='atlas.requirement_continuity_audit_v2(uuid, date)';

  insert into atlas.authenticated_rpc_registry(
    signature,classification,confidence,review_status,
    authenticated_execute_expected,security_definer_expected,service_execute_expected,
    caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
  ) values (
    'atlas.requirement_continuity_audit(uuid, date)',
    'service_internal','verified','active',
    false,true,true,1,1,
    jsonb_build_object(
      'authority','atlas.requirement_continuity_audit(uuid, date)',
      'status','finished_runtime_authority',
      'truthBoundary','One stable Requirement Continuity runtime identity; numbered predecessor names remain migration history only.'
    ),now(),now(),false
  )
  on conflict (signature) do update set
    classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at,
    anonymous_execute_expected=excluded.anonymous_execute_expected;

  revoke all on function atlas.requirement_continuity_audit(uuid,date) from public,anon,authenticated;
  grant execute on function atlas.requirement_continuity_audit(uuid,date) to service_role;
end
$migration$;

comment on function atlas.requirement_continuity_audit(uuid,date) is
'Canonical Requirement → Truth Acquisition → Execution continuity proof. Stable finished-runtime identity; numbered predecessors are deployment history only.';