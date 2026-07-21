insert into atlas.object_content_resolutions (
  object_content_id,
  farm_id,
  object_id,
  canonical_content_id,
  identity_kind,
  resolution_status,
  resolution_method,
  confidence,
  review_id,
  metadata,
  resolved_at
)
select
  oc.id,
  oc.farm_id,
  oc.object_id,
  oc.id,
  'historical',
  'historical',
  'transition_aggregate_preserved',
  'confirmed',
  rq.id,
  jsonb_build_object(
    'source_preserved', true,
    'transition_resolution', true,
    'resolution_note', case
      when oc.id = 'fe4b7564-2b3a-4bef-8b44-bc9dd1b25dd6'::uuid
        then 'Owner-confirmed MG10 aggregate retained; component records carry current crop detail.'
      else 'Legacy aggregate or planning record retained as historical context; canonical component or transactional records carry current detail.'
    end
  ),
  now()
from atlas.identity_review_queue rq
join atlas.object_contents oc on oc.id = rq.source_id
where rq.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and rq.status = 'open'
  and rq.entity_type = 'object_content'
on conflict (object_content_id) do update
set canonical_content_id = excluded.canonical_content_id,
    identity_kind = excluded.identity_kind,
    resolution_status = excluded.resolution_status,
    resolution_method = excluded.resolution_method,
    confidence = excluded.confidence,
    review_id = excluded.review_id,
    metadata = coalesce(atlas.object_content_resolutions.metadata, '{}'::jsonb) || excluded.metadata,
    resolved_at = now();

update atlas.identity_review_queue rq
set status = 'resolved',
    resolution_note = case
      when rq.source_id = 'fe4b7564-2b3a-4bef-8b44-bc9dd1b25dd6'::uuid
        then 'Resolved to owner-confirmed MG10 aggregate; component records provide current crop identity.'
      else 'Resolved as preserved aggregate or planning history; current relational records provide operational identity.'
    end,
    resolved_at = now(),
    updated_at = now(),
    metadata = coalesce(rq.metadata, '{}'::jsonb) || jsonb_build_object(
      'resolved_by', 'atlas_transition_repair'
    )
where rq.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and rq.status = 'open'
  and rq.entity_type = 'object_content'
  and exists (
    select 1
    from atlas.object_contents oc
    where oc.id = rq.source_id
  );

update atlas.identity_review_queue rq
set status = 'dismissed',
    resolution_note = 'Dismissed because the legacy source content was already removed before transition closure.',
    resolved_at = now(),
    updated_at = now(),
    metadata = coalesce(rq.metadata, '{}'::jsonb) || jsonb_build_object(
      'resolved_by', 'atlas_transition_repair',
      'stale_source', true
    )
where rq.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and rq.status = 'open'
  and rq.entity_type = 'object_content'
  and not exists (
    select 1
    from atlas.object_contents oc
    where oc.id = rq.source_id
  );

update atlas.identity_review_queue rq
set object_id = go.id,
    status = 'resolved',
    resolution_note = 'Linked Boom Boom White planting claim to Field Row 7 and rebuilt its content, activity, state, and crop-cycle records.',
    resolved_at = now(),
    updated_at = now(),
    metadata = coalesce(rq.metadata, '{}'::jsonb) || jsonb_build_object(
      'resolved_by', 'atlas_transition_repair',
      'resolved_object_key', go.stable_key
    )
from atlas.planting_claims pc
join atlas.growing_objects go
  on go.farm_id = pc.farm_id
 and go.stable_key = 'fr_7'
where rq.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and rq.status = 'open'
  and rq.entity_type = 'planting_claim'
  and rq.source_id = pc.id
  and pc.crop_label = 'Dahlia'
  and pc.variety = 'Boom Boom White'
  and pc.planted_date = date '2026-07-07';
