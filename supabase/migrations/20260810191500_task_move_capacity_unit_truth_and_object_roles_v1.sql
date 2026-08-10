begin;

-- A tray requirement cannot be converted into shelf positions without a measured
-- footprint/conversion. Keep the old shelf pool intact and add the allocatable
-- unit this task actually consumes.
alter table atlas.capacity_pools
  drop constraint if exists capacity_pools_capacity_kind_check;

alter table atlas.capacity_pools
  add constraint capacity_pools_capacity_kind_check
  check (capacity_kind in (
    'tray_inventory',
    'shelf_positions',
    'lit_shelf_positions',
    'lit_tray_positions',
    'bed_feet',
    'bucket_inventory',
    'other'
  ));

insert into atlas.capacity_pools (
  farm_id,
  stable_key,
  label,
  capacity_kind,
  total_capacity,
  unit,
  capacity_status,
  active,
  source,
  metadata
)
select
  f.id,
  'grow_room_lit_tray_positions',
  'Grow Room Lit Tray Positions',
  'lit_tray_positions',
  null::numeric,
  'tray_positions',
  'unconfirmed',
  true,
  'task_move_capacity_pass_3_truth_correction',
  jsonb_build_object(
    'reason', 'The task consumes tray footprints; no shelf-to-tray conversion has been measured.',
    'location_label', 'Grow Room'
  )
from atlas.farms f
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do update
set
  label = excluded.label,
  capacity_kind = excluded.capacity_kind,
  unit = excluded.unit,
  source = excluded.source,
  metadata = atlas.capacity_pools.metadata || excluded.metadata,
  updated_at = now();

insert into atlas.capacity_questions (
  farm_id,
  stable_key,
  question_kind,
  question_text,
  status,
  metadata
)
select
  f.id,
  'grow_room_lit_tray_positions_available',
  'inventory_count',
  'How many standard propagation-tray positions are currently usable under the Grow Room lights at the same time?',
  'open',
  jsonb_build_object(
    'source', 'task_move_capacity_pass_3_truth_correction',
    'capacity_pool_key', 'grow_room_lit_tray_positions',
    'unit', 'tray_positions'
  )
from atlas.farms f
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do update
set
  question_kind = excluded.question_kind,
  question_text = excluded.question_text,
  metadata = atlas.capacity_questions.metadata || excluded.metadata,
  updated_at = now();

with target_task as (
  select t.id as task_id, t.farm_id, t.due_date
  from atlas.tasks t
  where t.metadata ->> 'task_key' = 'anna_20260810_pot_up_200_cell_snow_in_summer_tray_1'
    and t.status in ('open', 'blocked')
  order by t.updated_at desc
  limit 1
), target_pool as (
  select cp.id as capacity_pool_id, cp.farm_id
  from atlas.capacity_pools cp
  where cp.stable_key = 'grow_room_lit_tray_positions'
    and cp.active = true
), upserted_requirement as (
  insert into atlas.task_capacity_requirements (
    farm_id,
    task_id,
    capacity_pool_id,
    capacity_role,
    quantity_needed,
    unit,
    window_start,
    requirement_status,
    source,
    note,
    metadata
  )
  select
    tt.farm_id,
    tt.task_id,
    tp.capacity_pool_id,
    'destination',
    4,
    'tray_positions',
    tt.due_date,
    'required',
    'task_move_capacity_pass_3_truth_correction',
    'The four physical pot-up trays require four lit tray positions; shelf-position conversion is intentionally not assumed.',
    jsonb_build_object(
      'task_move_branch', true,
      'destination_context', 'after_pot_up',
      'unit_truth', 'tray_footprints_not_shelf_positions'
    )
  from target_task tt
  join target_pool tp on tp.farm_id = tt.farm_id
  on conflict (task_id, capacity_pool_id, capacity_role) do update
  set
    quantity_needed = excluded.quantity_needed,
    unit = excluded.unit,
    window_start = excluded.window_start,
    requirement_status = excluded.requirement_status,
    source = excluded.source,
    note = excluded.note,
    metadata = atlas.task_capacity_requirements.metadata || excluded.metadata,
    updated_at = now()
  returning id, task_id
), target_question as (
  select cq.id as question_id, cq.farm_id
  from atlas.capacity_questions cq
  where cq.stable_key = 'grow_room_lit_tray_positions_available'
    and cq.status = 'open'
)
insert into atlas.task_capacity_requirement_questions (
  task_capacity_requirement_id,
  question_id,
  blocker_role
)
select ur.id, tq.question_id, 'availability_input'
from upserted_requirement ur
join atlas.task_capacity_requirements tcr on tcr.id = ur.id
join target_question tq on tq.farm_id = tcr.farm_id
on conflict (task_capacity_requirement_id, question_id) do update
set blocker_role = excluded.blocker_role;

-- Remove only the erroneous Snow in Summer task link to the older shelf-position
-- pool. The shelf pool remains canonical for planning that actually consumes shelves.
delete from atlas.task_capacity_requirements tcr
using atlas.tasks t, atlas.capacity_pools cp
where tcr.task_id = t.id
  and tcr.capacity_pool_id = cp.id
  and t.metadata ->> 'task_key' = 'anna_20260810_pot_up_200_cell_snow_in_summer_tray_1'
  and cp.stable_key = 'grow_room_lit_shelf_positions'
  and tcr.source = 'task_move_capacity_pass_3';

-- Preserve the canonical role already stored on task_objects inside the task-card
-- payload. This lets source/destination branches come from relationships rather
-- than duplicate execution metadata.
create or replace view atlas.v_task_cards as
select
  f.stable_key as farm_key,
  t.id as task_id,
  t.title,
  t.task_type,
  t.status,
  t.priority,
  t.due_date,
  t.unlock_text,
  t.blocker_text,
  t.note,
  t.generated_from,
  t.generated_from_id,
  t.created_at,
  t.updated_at,
  z.id as zone_id,
  z.stable_key as zone_key,
  z.label as zone_label,
  coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'object_id', go.id,
      'role', tro.role,
      'object_key', go.stable_key,
      'object_label', go.label,
      'object_type', go.object_type,
      'object_mode', go.object_mode,
      'life_status', os.life_status,
      'weed_pressure', os.weed_pressure,
      'water_status', os.water_status,
      'last_touched_at', os.last_touched_at,
      'last_weeded_at', os.last_weeded_at,
      'last_watered_at', os.last_watered_at,
      'last_checked_at', os.last_checked_at,
      'decision_required', os.decision_required,
      'presentability', os.presentability,
      'state_metadata', os.metadata
    )) filter (where go.id is not null),
    '[]'::jsonb
  ) as objects,
  coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'requirement_id', trr.id,
      'requirement_role', trr.requirement_role,
      'move_role', trr.move_role,
      'requirement_source', trr.requirement_source,
      'quantity_needed', trr.quantity_needed,
      'unit', trr.unit,
      'status', trr.status,
      'note', trr.note,
      'resource_key', r.stable_key,
      'resource_label', r.label,
      'resource_type', r.resource_type,
      'resource_category', r.resource_category,
      'resource_status', r.status,
      'resource_quantity', r.quantity,
      'resource_unit', r.unit,
      'condition_notes', r.condition_notes,
      'restock_needed', r.restock_needed
    )) filter (where trr.id is not null),
    '[]'::jsonb
  ) as resource_requirements,
  coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'template_id', art.id,
      'template_key', art.stable_key,
      'template_label', art.label,
      'action_type', art.action_type,
      'required_resource_categories', art.required_resource_categories,
      'optional_resource_categories', art.optional_resource_categories,
      'required_resource_keys', art.required_resource_keys,
      'optional_resource_keys', art.optional_resource_keys,
      'creates_follow_up_task_types', art.creates_follow_up_task_types,
      'hard_parts', art.hard_parts,
      'unlocks', art.unlocks,
      'card_language', art.metadata ->> 'card_language'
    )) filter (where art.id is not null),
    '[]'::jsonb
  ) as action_templates,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'field_log_id', fl.id,
      'log_date', fl.log_date,
      'action_types', fl.action_types,
      'summary_sentence', fl.summary_sentence,
      'note', fl.note,
      'created_at', fl.created_at
    ) order by fl.created_at desc)
    from atlas.field_logs fl
    where fl.farm_id = t.farm_id
      and fl.metadata ->> 'task_id' = t.id::text
  ), '[]'::jsonb) as task_logs,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', toe.id,
      'outcome', toe.outcome,
      'lane_key', toe.lane_key,
      'work_key', toe.work_key,
      'blocker_reason', toe.blocker_reason,
      'note', toe.note,
      'created_at', toe.created_at
    ) order by toe.created_at desc)
    from atlas.task_outcome_events toe
    where toe.task_id = t.id
  ), '[]'::jsonb) as task_outcomes,
  t.metadata
    - 'effort_units'
    - 'effort_band'
    - 'estimated_minutes'
    - 'duration_minutes'
    - 'timeboxed_minutes'
    - 'packet_target_hours'
    - 'packet_day_target_hours'
    - 'capacity_blocked'
    - 'capacity_blocker'
    - 'capacity_observed_date'
    - 'dependency_delay_minutes' as metadata,
  t.action_key,
  t.work_class,
  t.parent_task_id,
  t.task_series_key,
  t.engine_instance_key,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'transition_id', tt.id,
      'transition', tt.transition,
      'previous_status', tt.previous_status,
      'next_status', tt.next_status,
      'previous_due_date', tt.previous_due_date,
      'target_date', tt.target_date,
      'action_key', tt.action_key,
      'work_class', tt.work_class,
      'note', tt.note,
      'reason', tt.reason,
      'field_log_id', tt.field_log_id,
      'created_at', tt.created_at
    ) order by tt.created_at desc)
    from atlas.task_transitions tt
    where tt.task_id = t.id
  ), '[]'::jsonb) as task_transitions,
  t.operation_class,
  t.operation_class_source
from atlas.farms f
join atlas.tasks t on t.farm_id = f.id
left join atlas.zones z on z.id = t.zone_id
left join atlas.task_objects tro on tro.task_id = t.id
left join atlas.growing_objects go on go.id = tro.object_id
left join atlas.object_state os on os.object_id = go.id
left join atlas.task_resource_requirements trr on trr.task_id = t.id
left join atlas.resources r on r.id = trr.resource_id
left join atlas.action_requirement_templates art on art.id = trr.template_id
group by f.stable_key, t.id, z.id, z.stable_key, z.label;

commit;
