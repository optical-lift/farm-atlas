insert into atlas.source_custody_adjudications (custody_key,custody_class,disposition,evidence,rationale,adjudicated_by)
select
  'migration:20260825191357:state_progression_anna_weeding_completion_gate_effect_v1',
  'version_drift',
  'accepted',
  jsonb_build_object(
    'productionVersion','20260825191357',
    'productionName','state_progression_anna_weeding_completion_gate_effect_v1',
    'repositoryFile','20260825134000_state_progression_anna_weeding_completion_gate_effect_v1.sql',
    'productionSha','5ac534dcaa6fb6814fdc139a811d7e04873bfc19',
    'repositorySha','5ac534dcaa6fb6814fdc139a811d7e04873bfc19',
    'sourcePr',568,
    'exactBytes',true
  ),
  'Production recorded the merged Step 5 migration under deployment version 20260825191357 while repository source retains its authored version 20260825134000. The Git blob is byte-identical; this adjudication records timestamp drift only and waives no source mismatch.',
  'state_progression_anna_weeding_version_drift_adjudication_v1'
where not exists (
  select 1 from atlas.source_custody_adjudications
  where custody_key='migration:20260825191357:state_progression_anna_weeding_completion_gate_effect_v1'
);