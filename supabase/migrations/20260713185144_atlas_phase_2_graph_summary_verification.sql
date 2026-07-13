-- Phase 2 verification refinement.
-- Count every non-canonical source row, including historical revisions, as a
-- mapped duplicate. The original immutable audit remains available as v1.

create or replace view atlas.v_phase_2_graph_summary
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  (select count(*) from atlas.object_contents oc where oc.farm_id = f.id) as legacy_content_rows,
  (select count(*) from atlas.object_content_resolutions r where r.farm_id = f.id) as resolved_content_rows,
  round(
    100.0 * (select count(*) from atlas.object_content_resolutions r where r.farm_id = f.id)
    / nullif((select count(*) from atlas.object_contents oc where oc.farm_id = f.id), 0),
    1
  ) as resolution_coverage_percent,
  (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active') as active_crop_cycles,
  (select count(*) from atlas.plant_instances pi where pi.farm_id = f.id and pi.status not in ('dead', 'removed', 'archived')) as current_plant_instances,
  (
    select count(*)
    from atlas.object_content_resolutions r
    where r.farm_id = f.id
      and r.object_content_id <> r.canonical_content_id
  ) as duplicate_rows_mapped,
  (select count(*) from atlas.identity_review_queue rq where rq.farm_id = f.id and rq.status = 'open') as open_reviews,
  (
    (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active' and cc.object_id is null)
    +
    (select count(*) from atlas.plant_instances pi where pi.farm_id = f.id and pi.status not in ('dead', 'removed', 'archived') and pi.object_id is null)
  ) as current_entities_without_object,
  (
    select count(*)
    from atlas.planting_claims pc
    where pc.farm_id = f.id
      and not exists (
        select 1 from atlas.planting_claim_objects pco where pco.planting_claim_id = pc.id
      )
  ) as unlinked_planting_claims,
  (select count(*) from atlas.crop_cycles cc where cc.farm_id = f.id and cc.lifecycle_status = 'active' and cc.crop_profile_id is null) as unprofiled_crop_cycles
from atlas.farms f;

revoke all on atlas.v_phase_2_graph_summary from public, anon, authenticated;
grant select on atlas.v_phase_2_graph_summary to service_role;

insert into atlas.integrity_audit_runs (
  farm_id,
  audit_version,
  metrics,
  source_id,
  created_by,
  note
)
select
  v.farm_id,
  'phase_2_canonical_graph_v2',
  to_jsonb(v) || jsonb_build_object(
    'logical_content_groups', (
      select count(distinct r.canonical_content_id)
      from atlas.object_content_resolutions r
      where r.farm_id = v.farm_id
    ),
    'duplicate_groups_consolidated', (
      select count(*)
      from (
        select r.canonical_content_id
        from atlas.object_content_resolutions r
        where r.farm_id = v.farm_id
        group by r.canonical_content_id
        having count(*) > 1
      ) groups_with_revisions
    )
  ),
  s.id,
  'codex',
  'Verified Phase 2 graph. Duplicate rows include historical revisions; distinct varieties remain separate entities.'
from atlas.v_phase_2_graph_summary v
join atlas.truth_sources s
  on s.farm_id = v.farm_id
 and s.stable_key = 'atlas_phase_2_canonical_graph_20260713'
on conflict (farm_id, audit_version) do nothing;
