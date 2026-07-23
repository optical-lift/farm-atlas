create or replace view atlas.tending_task_track_v1
with (security_invoker=true)
as
select
  t.farm_id,
  t.id as task_id,
  t.title as task_title,
  t.status as task_status,
  t.priority,
  t.due_date,
  t.unlock_text,
  t.action_key,
  t.work_class,
  t.visibility_scope,
  t.assigned_membership_id,
  t.planned_occurrence_id,
  t.released_at,
  t.metadata as task_metadata,
  t.created_at as task_created_at,
  go.id as object_id,
  go.stable_key as object_key,
  go.label as object_label,
  go.object_type,
  go.object_mode,
  go.sort_order as object_sort_order,
  z.stable_key as zone_key,
  z.label as zone_label,
  z.sort_order as zone_sort_order,
  cc.id as crop_cycle_id,
  cc.crop_label,
  cc.variety,
  cc.cycle_state,
  cc.lifecycle_status,
  cc.sown_date,
  cc.planted_date,
  cc.expected_harvest_watch_start,
  cc.expected_harvest_watch_end,
  atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata) as gate_key,
  atlas.tending_action_label_v1(atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata)) as gate_label,
  case
    when atlas.tending_unlock_label_v1(t.unlock_text,t.metadata,null) is not null
      and atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata) in ('weed','clear')
      then 'unlock_next'
    else atlas.tending_section_v1(atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata),cc.lifecycle_status)
  end as section_key,
  coalesce(
    case when jsonb_typeof(t.metadata->'estimated_minutes')='number' then (t.metadata->>'estimated_minutes')::integer end,
    case when t.metadata->>'effort_band'='light' then 15 when t.metadata->>'effort_band'='moderate' then 30 when t.metadata->>'effort_band'='heavy' then 60 end
  ) as estimated_minutes,
  atlas.tending_unlock_label_v1(t.unlock_text,t.metadata,coalesce(nullif(cc.variety,''),cc.crop_label)) as crop_display_label,
  coalesce(cp.harvest_pattern,cc.metadata->>'harvest_pattern') as harvest_pattern,
  case when jsonb_typeof(cc.metadata->'harvest_ceiling')='number' then (cc.metadata->>'harvest_ceiling')::numeric end as harvest_ceiling,
  case when jsonb_typeof(cc.metadata->'harvest_forecast')='number' then (cc.metadata->>'harvest_forecast')::numeric end as harvest_forecast,
  case when jsonb_typeof(cc.metadata->'forecast_loss')='number' then (cc.metadata->>'forecast_loss')::numeric end as forecast_loss,
  case when coalesce(cc.metadata->>'next_loss_on','') ~ '^\d{4}-\d{2}-\d{2}$' then (cc.metadata->>'next_loss_on')::date end as next_loss_on,
  coalesce(h.actual_harvest_count,0) as actual_harvest_count,
  coalesce(h.marketable_stems,0) as actual_marketable_stems,
  cs.care_state,
  cs.ordinary_weeding_allowed
from atlas.tasks t
join atlas.tending_task_object_v1 link on link.task_id=t.id
join atlas.growing_objects go on go.id=link.object_id and go.farm_id=t.farm_id
left join atlas.zones z on z.id=go.zone_id
left join atlas.farm_care_object_state_v1 cs on cs.object_id=go.id
join lateral (
  select candidate.*
  from atlas.crop_cycles candidate
  where candidate.farm_id=t.farm_id
    and candidate.object_id=go.id
    and candidate.lifecycle_status in ('active','planned')
  order by
    case
      when exists (select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id and tc.crop_cycle_id=candidate.id) then 0
      when candidate.source_task_id=t.id then 1
      when candidate.lifecycle_status='planned' and atlas.tending_action_key_v1(t.action_key,t.work_class,t.task_type,t.title,t.metadata) in ('weed','clear','sow','plant','transplant') then 2
      when candidate.lifecycle_status='active' then 3
      else 4
    end,
    candidate.expected_harvest_watch_start nulls last,
    candidate.created_at desc
  limit 1
) cc on true
left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
left join lateral (
  select count(distinct e.harvest_lot_id)::integer as actual_harvest_count,
         coalesce(sum(e.marketable_stems),0)::numeric as marketable_stems
  from atlas.production_harvest_stand_entries e
  where e.object_id=go.id and e.crop_cycle_id=cc.id
) h on true;
