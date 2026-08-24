-- Finished-software naming: the terminal farm continuity theorem gets one stable runtime identity.
do $migration$
declare
  v_def text;
begin
  if to_regprocedure('atlas.farm_continuity_terminal_census_v2(uuid,date)') is null then
    raise exception 'canonical farm_continuity_terminal_census_v2(uuid,date) not found';
  end if;
  if to_regprocedure('atlas.farm_continuity_terminal_census(uuid,date)') is not null then
    raise exception 'finished farm_continuity_terminal_census(uuid,date) already exists';
  end if;

  alter function atlas.farm_continuity_terminal_census_v2(uuid,date)
    rename to farm_continuity_terminal_census;

  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='atlas_wide_continuity_summary_v1'
    and pg_get_function_identity_arguments(p.oid)='p_principal_id uuid, p_day date';
  if v_def is null then
    raise exception 'atlas_wide_continuity_summary_v1 caller not found';
  end if;
  if position('farm_continuity_terminal_census_v2' in v_def)=0 then
    raise exception 'Atlas-wide continuity does not reference expected terminal census authority';
  end if;
  execute replace(v_def,'farm_continuity_terminal_census_v2','farm_continuity_terminal_census');

  delete from atlas.authenticated_rpc_registry
  where signature='atlas.farm_continuity_terminal_census_v2(uuid, date)';

  insert into atlas.authenticated_rpc_registry(
    signature,classification,confidence,review_status,
    authenticated_execute_expected,security_definer_expected,service_execute_expected,
    caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
  ) values (
    'atlas.farm_continuity_terminal_census(uuid, date)',
    'service_internal','verified','active',
    false,true,true,1,1,
    jsonb_build_object(
      'authority','atlas.farm_continuity_terminal_census(uuid, date)',
      'status','finished_runtime_authority',
      'truthBoundary','One stable current-state farm continuity theorem; numbered terminal census names remain migration history only.'
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

  revoke all on function atlas.farm_continuity_terminal_census(uuid,date) from public,anon,authenticated;
  grant execute on function atlas.farm_continuity_terminal_census(uuid,date) to service_role;
end
$migration$;

comment on function atlas.farm_continuity_terminal_census(uuid,date) is
'Canonical current-state farm continuity theorem. Stable finished-runtime identity; numbered terminal census predecessors are deployment history only.';

comment on function atlas.atlas_wide_continuity_summary_v1(uuid,date) is
'Canonical product-facing Atlas continuity API. Farm continuity is composed from atlas.farm_continuity_terminal_census; lower-level continuity proofs remain service-internal.';