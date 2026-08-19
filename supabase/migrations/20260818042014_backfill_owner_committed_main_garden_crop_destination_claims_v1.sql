insert into atlas.crop_destination_claims(
  farm_id,crop_cycle_id,destination_object_id,recorded_by_membership_id,
  claim_source,claimed_quantity,unit,required_by,claim_strength,displacement_authority,
  protection_reason,source_evidence,idempotency_key,metadata
)
select
  cc.farm_id,
  cc.id,
  go.id,
  owner_membership.id,
  cc.metadata->>'owner_plan_source',
  (cc.metadata->>'plants_per_destination')::numeric,
  'plants',
  (cc.metadata->>'planned_transplant_date')::date,
  'committed',
  'management',
  'Owner committed this crop cohort to the named Main Garden destination set for the planned transplant move.',
  jsonb_build_object(
    'ownerPlanSource',cc.metadata->>'owner_plan_source',
    'ownerCommitmentSource',cc.metadata->>'owner_commitment_source',
    'destinationZone',cc.metadata->>'destination_zone',
    'plannedTransplantDate',cc.metadata->>'planned_transplant_date',
    'plantsPerDestination',cc.metadata->>'plants_per_destination',
    'ownerAssumedTransplantCount',cc.metadata->>'owner_assumed_transplant_count',
    'sourceMetadataSnapshot',jsonb_strip_nulls(jsonb_build_object(
      'destination_plan',cc.metadata->>'destination_plan',
      'weather_release_required',cc.metadata->'weather_release_required',
      'weather_release_status',cc.metadata->>'weather_release_status'
    ))
  ),
  'crop-destination:'||cc.id::text||':'||go.id::text,
  jsonb_build_object('truth_boundary','owner_committed_crop_destination_backfill','backfilled_at',now())
from atlas.crop_cycles cc
cross join lateral jsonb_array_elements_text(cc.metadata->'destination_object_ids') x(raw)
join atlas.growing_objects go
  on go.id::text=x.raw
 and go.farm_id=cc.farm_id
left join lateral (
  select fm.id
  from atlas.farm_memberships fm
  where fm.farm_id=cc.farm_id and fm.active=true and fm.role='owner'
  order by fm.created_at
  limit 1
) owner_membership on true
where cc.lifecycle_status='active'
  and cc.metadata->>'owner_plan_source'='owner_instruction_20260814'
  and cc.metadata->>'owner_commitment_source'='atlas_audit_20260814'
  and cc.metadata->>'destination_zone'='Main Garden'
  and jsonb_typeof(cc.metadata->'destination_object_ids')='array'
  and coalesce(cc.metadata->>'plants_per_destination','') ~ '^[0-9]+(\.[0-9]+)?$'
  and coalesce(cc.metadata->>'planned_transplant_date','') ~ '^\d{4}-\d{2}-\d{2}$'
on conflict(farm_id,idempotency_key) do nothing;