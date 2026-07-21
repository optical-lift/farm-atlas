with claim_targets as (
  select
    pc.id as planting_claim_id,
    pc.farm_id,
    pc.field_log_id,
    pc.crop_label,
    pc.variety,
    pc.planted_date,
    pc.planting_method,
    pc.amount,
    pc.unit,
    pc.note,
    go.id as object_id
  from atlas.planting_claims pc
  join atlas.farms f on f.id = pc.farm_id
  join atlas.growing_objects go
    on go.farm_id = pc.farm_id
   and go.stable_key = case
     when pc.crop_label = 'Dahlia' and pc.variety = 'Boom Boom White' and pc.planted_date = date '2026-07-07' then 'fr_7'
     when pc.crop_label in ('Lettuce', 'Onions', 'Spinach') and pc.planted_date = date '2026-07-13' and pc.metadata ->> 'zone_label' = 'Lilac Haven' then 'lilac_haven_fence_line'
     else null
   end
  where f.stable_key = 'elm_farm'
), content_rows as (
  select t.*, oc.id as object_content_id
  from claim_targets t
  join atlas.object_contents oc
    on oc.planting_claim_id = t.planting_claim_id
   and oc.object_id = t.object_id
)
insert into atlas.object_activity_events (
  farm_id,
  object_id,
  object_content_id,
  field_log_id,
  event_type,
  event_date,
  note,
  quantity,
  unit,
  created_by,
  source,
  idempotency_key,
  metadata
)
select
  farm_id,
  object_id,
  object_content_id,
  field_log_id,
  'planted',
  planted_date,
  note,
  amount,
  unit,
  'Atlas transition repair',
  'atlas_transition_repair',
  'transition-repair:planting-claim:' || planting_claim_id::text || ':' || object_id::text,
  jsonb_build_object(
    'planting_claim_id', planting_claim_id,
    'crop_label', crop_label,
    'variety', variety,
    'planting_method', planting_method
  )
from content_rows r
where not exists (
  select 1
  from atlas.object_activity_events e
  where e.farm_id = r.farm_id
    and e.idempotency_key =
      'transition-repair:planting-claim:' || r.planting_claim_id::text || ':' || r.object_id::text
);

with claim_targets as (
  select
    pc.id as planting_claim_id,
    pc.farm_id,
    pc.field_log_id,
    pc.crop_label,
    pc.variety,
    pc.planted_date,
    go.id as object_id
  from atlas.planting_claims pc
  join atlas.farms f on f.id = pc.farm_id
  join atlas.growing_objects go
    on go.farm_id = pc.farm_id
   and go.stable_key = case
     when pc.crop_label = 'Dahlia' and pc.variety = 'Boom Boom White' and pc.planted_date = date '2026-07-07' then 'fr_7'
     when pc.crop_label in ('Lettuce', 'Onions', 'Spinach') and pc.planted_date = date '2026-07-13' and pc.metadata ->> 'zone_label' = 'Lilac Haven' then 'lilac_haven_fence_line'
     else null
   end
  where f.stable_key = 'elm_farm'
), state_targets as (
  select
    object_id,
    farm_id,
    max(planted_date) as planted_date,
    jsonb_agg(distinct planting_claim_id) as planting_claim_ids,
    jsonb_agg(distinct crop_label) as crop_labels,
    jsonb_agg(distinct variety) filter (where variety is not null) as varieties,
    jsonb_agg(distinct field_log_id) filter (where field_log_id is not null) as field_log_ids
  from claim_targets
  group by object_id, farm_id
)
insert into atlas.object_state (
  object_id,
  farm_id,
  life_status,
  last_touched_at,
  last_checked_at,
  decision_required,
  metadata,
  updated_at
)
select
  object_id,
  farm_id,
  'planted',
  planted_date,
  planted_date,
  false,
  jsonb_build_object(
    'last_planting_claim_ids', planting_claim_ids,
    'last_crop_labels', crop_labels,
    'last_varieties', coalesce(varieties, '[]'::jsonb),
    'last_field_log_ids', coalesce(field_log_ids, '[]'::jsonb),
    'source', 'atlas_transition_repair'
  ),
  now()
from state_targets
on conflict (object_id) do update
set life_status = 'planted',
    last_touched_at = greatest(atlas.object_state.last_touched_at, excluded.last_touched_at),
    last_checked_at = greatest(atlas.object_state.last_checked_at, excluded.last_checked_at),
    decision_required = false,
    metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

do $atlas_sync_repaired_claims$
declare
  target record;
begin
  for target in
    select distinct pc.farm_id, go.id as object_id
    from atlas.planting_claims pc
    join atlas.farms f on f.id = pc.farm_id
    join atlas.growing_objects go
      on go.farm_id = pc.farm_id
     and go.stable_key = case
       when pc.crop_label = 'Dahlia' and pc.variety = 'Boom Boom White' and pc.planted_date = date '2026-07-07' then 'fr_7'
       when pc.crop_label in ('Lettuce', 'Onions', 'Spinach') and pc.planted_date = date '2026-07-13' and pc.metadata ->> 'zone_label' = 'Lilac Haven' then 'lilac_haven_fence_line'
       else null
     end
    where f.stable_key = 'elm_farm'
  loop
    perform atlas.sync_crop_cycle_registry_v1(target.farm_id, target.object_id);
  end loop;
end
$atlas_sync_repaired_claims$;

update atlas.object_activity_events e
set crop_cycle_id = cc.id,
    updated_at = now()
from atlas.object_contents oc
join atlas.crop_cycles cc on cc.object_content_id = oc.id
where e.object_content_id = oc.id
  and e.source = 'atlas_transition_repair'
  and e.crop_cycle_id is null;
