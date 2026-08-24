insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
)
values
(
  'atlas.farm_continuity_terminal_census_v1(uuid, date)',
  'service_internal','verified','active',
  false,true,true,1,1,
  jsonb_build_object(
    'purpose','Internal current-canonical population proof retained as lineage/base for terminal census v2.',
    'authority','farm_continuity_terminal_census_v2',
    'truthBoundary','Legacy findings do not create present-tense subjects; v1 is not a public authenticated endpoint.'
  ),now(),now(),false
),
(
  'atlas.farm_continuity_terminal_census_v2(uuid, date)',
  'service_internal','verified','active',
  false,true,true,1,1,
  jsonb_build_object(
    'purpose','Canonical service-internal terminal farm continuity census consumed by Atlas-wide continuity composition.',
    'populationAuthority','Current canonical atlas.crop_cycles with lifecycle_status=active.',
    'requirementSemantics','requirement_continuity_audit_v2',
    'operationResultSemantics','operation_result_continuity_audit_v1',
    'cutover','atlas_wide_continuity_summary_v1'
  ),now(),now(),false
),
(
  'atlas.requirement_continuity_audit_v2(uuid, date)',
  'service_internal','verified','active',
  false,true,true,1,1,
  jsonb_build_object(
    'purpose','Canonical service-internal Requirement continuity semantics for terminal census v2.',
    'truthBoundary','Legacy progression/model coverage remains diagnostic when a current requirement is already expressed.',
    'consumer','farm_continuity_terminal_census_v2'
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