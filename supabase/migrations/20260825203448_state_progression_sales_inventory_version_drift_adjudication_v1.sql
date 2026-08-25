insert into atlas.source_custody_adjudications (custody_key,custody_class,disposition,evidence,rationale,adjudicated_by)
select
  'migration:20260825202256:state_progression_sales_inventory_evaluation_effect_split_v1',
  'version_drift',
  'accepted',
  jsonb_build_object(
    'productionVersion','20260825202256',
    'productionName','state_progression_sales_inventory_evaluation_effect_split_v1',
    'repositoryFile','20260825201500_state_progression_sales_inventory_evaluation_effect_split_v1.sql',
    'productionSha','3c69db3c9ad9c8bd0ab1c5b070e21d86852a45c5',
    'repositorySha','3c69db3c9ad9c8bd0ab1c5b070e21d86852a45c5',
    'sourcePr',572,
    'exactBytes',true
  ),
  'Production recorded the merged Phase 6 sales inventory evaluation/effect split under deployment version 20260825202256 while repository source retains its authored version 20260825201500. The Git blob is byte-identical; this adjudication records timestamp drift only and waives no source mismatch.',
  'state_progression_sales_inventory_version_drift_adjudication_v1'
where not exists (
  select 1 from atlas.source_custody_adjudications
  where custody_key='migration:20260825202256:state_progression_sales_inventory_evaluation_effect_split_v1'
);