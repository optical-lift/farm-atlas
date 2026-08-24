-- Finished-software convergence for the product-facing continuity API.
-- Migration history keeps the v1 name; the finished runtime exposes one stable product contract.

do $migration$
begin
  if to_regprocedure('atlas.atlas_wide_continuity_summary_v1(uuid,date)') is null then
    raise exception 'atlas_wide_continuity_summary_v1 migration source not found';
  end if;
  if to_regprocedure('atlas.atlas_wide_continuity_summary(uuid,date)') is not null then
    raise exception 'atlas_wide_continuity_summary stable runtime name already exists';
  end if;

  alter function atlas.atlas_wide_continuity_summary_v1(uuid,date)
    rename to atlas_wide_continuity_summary;

  revoke all on function atlas.atlas_wide_continuity_summary(uuid,date) from public, anon;
  grant execute on function atlas.atlas_wide_continuity_summary(uuid,date) to authenticated, service_role;

  delete from atlas.authenticated_rpc_registry
  where signature='atlas.atlas_wide_continuity_summary_v1(uuid, date)';

  insert into atlas.authenticated_rpc_registry(
    signature,classification,confidence,review_status,
    authenticated_execute_expected,security_definer_expected,service_execute_expected,
    caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
  )
  values(
    'atlas.atlas_wide_continuity_summary(uuid, date)',
    'product_api','verified','active',
    true,true,true,1,1,
    jsonb_build_object(
      'authority','atlas.atlas_wide_continuity_summary(uuid, date)',
      'status','finished_product_authority',
      'truthBoundary','Atlas exposes one stable product-facing continuity contract. Versioned Atlas-wide continuity names remain migration history only.'
    ),now(),now(),false
  )
  on conflict (signature) do update set
    classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at,
    anonymous_execute_expected=excluded.anonymous_execute_expected;

  -- Clean stale product-authority metadata from the three surviving internal proofs.
  update atlas.authenticated_rpc_registry
  set evidence = coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
        'canonicalProductAuthority','atlas.atlas_wide_continuity_summary',
        'finishedSurface',true
      ),
      reviewed_at=now()
  where signature in (
    'atlas.farm_continuity_terminal_census(uuid, date)',
    'atlas.requirement_continuity_audit(uuid, date)',
    'atlas.operation_result_continuity_audit(uuid, date)'
  );
end
$migration$;

comment on function atlas.atlas_wide_continuity_summary(uuid,date) is
'Canonical product-facing Atlas continuity API. Composes the stable terminal farm census, Requirement Continuity, and Operation→Result continuity authorities.';
