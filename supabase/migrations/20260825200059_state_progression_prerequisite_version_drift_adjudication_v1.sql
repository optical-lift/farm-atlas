insert into atlas.source_custody_adjudications (custody_key,custody_class,disposition,evidence,rationale,adjudicated_by)
select
  'migration:20260825194758:state_progression_prerequisite_evaluation_effect_split_v1',
  'version_drift',
  'accepted',
  jsonb_build_object(
    'productionVersion','20260825194758',
    'productionName','state_progression_prerequisite_evaluation_effect_split_v1',
    'repositoryFile','20260825194200_state_progression_prerequisite_evaluation_effect_split_v1.sql',
    'productionSha','42abdf4955367c7235810fa26dc77394d526d7f1',
    'repositorySha','42abdf4955367c7235810fa26dc77394d526d7f1',
    'sourcePr',570,
    'exactBytes',true
  ),
  'Production recorded the merged Phase 6 prerequisite evaluation/effect split under deployment version 20260825194758 while repository source retains its authored version 20260825194200. The Git blob is byte-identical; this adjudication records timestamp drift only and waives no source mismatch.',
  'state_progression_prerequisite_version_drift_adjudication_v1'
where not exists (
  select 1 from atlas.source_custody_adjudications
  where custody_key='migration:20260825194758:state_progression_prerequisite_evaluation_effect_split_v1'
);