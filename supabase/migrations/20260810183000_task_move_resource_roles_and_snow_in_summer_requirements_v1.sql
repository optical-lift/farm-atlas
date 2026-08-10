begin;

alter table atlas.task_resource_requirements
  add column if not exists move_role text;

comment on column atlas.task_resource_requirements.move_role is
  'Semantic role the linked resource plays in the physical move, distinct from requirement_role obligation semantics.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'atlas.task_resource_requirements'::regclass
      and conname = 'task_resource_requirements_move_role_check'
  ) then
    alter table atlas.task_resource_requirements
      add constraint task_resource_requirements_move_role_check
      check (
        move_role is null
        or move_role in (
          'container',
          'growing_medium',
          'tool',
          'equipment',
          'material',
          'plant_material',
          'water',
          'transport',
          'protective_equipment',
          'infrastructure',
          'information',
          'other'
        )
      );
  end if;
end
$$;

insert into atlas.resources (
  farm_id,
  stable_key,
  label,
  resource_type,
  resource_category,
  status,
  quantity,
  unit,
  location_label,
  consumable,
  restock_needed,
  metadata
)
select
  f.id,
  v.stable_key,
  v.label,
  v.resource_type,
  v.resource_category,
  v.status,
  null::numeric,
  v.unit,
  null::text,
  v.consumable,
  false,
  jsonb_build_object(
    'created_source', 'task_move_requirements_pass_2',
    'availability_truth', 'not_yet_counted'
  )
from atlas.farms f
cross join (
  values
    ('pot_up_tray_200_cell', '200-Cell Pot-Up Tray', 'container', 'seed_starting', 'unknown', 'trays', false),
    ('pot_up_tray_120_cell', '120-Cell Pot-Up Tray', 'container', 'seed_starting', 'unknown', 'trays', false),
    ('potting_mix', 'Potting Mix', 'soil_amendment', 'growing_medium', 'unknown', null::text, true)
) as v(stable_key, label, resource_type, resource_category, status, unit, consumable)
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do update
set
  label = excluded.label,
  resource_type = excluded.resource_type,
  resource_category = excluded.resource_category,
  consumable = excluded.consumable,
  updated_at = now();

insert into atlas.action_requirement_templates (
  farm_id,
  stable_key,
  action_type,
  label,
  applies_to_task_type,
  required_resource_categories,
  optional_resource_categories,
  required_resource_keys,
  optional_resource_keys,
  creates_follow_up_task_types,
  hard_parts,
  unlocks,
  notes,
  metadata
)
select
  f.id,
  'pot_up',
  'pot_up',
  'Pot up',
  'pot_up',
  array['container', 'growing_medium']::text[],
  array['water', 'seed_starting']::text[],
  '{}'::text[],
  array['grow_light_sets']::text[],
  '{}'::text[],
  '[]'::jsonb,
  '[]'::jsonb,
  'Template expresses what a pot-up move normally needs. Task-specific requirements remain the execution truth.',
  jsonb_build_object(
    'created_source', 'task_move_requirements_pass_2',
    'card_language', 'Confirm containers and growing medium; destination capacity is resolved separately.'
  )
from atlas.farms f
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do update
set
  action_type = excluded.action_type,
  label = excluded.label,
  applies_to_task_type = excluded.applies_to_task_type,
  required_resource_categories = excluded.required_resource_categories,
  optional_resource_categories = excluded.optional_resource_categories,
  required_resource_keys = excluded.required_resource_keys,
  optional_resource_keys = excluded.optional_resource_keys,
  notes = excluded.notes,
  metadata = atlas.action_requirement_templates.metadata || excluded.metadata,
  updated_at = now();

with target_task as (
  select t.id as task_id, t.farm_id
  from atlas.tasks t
  where t.metadata ->> 'task_key' = 'anna_20260810_pot_up_200_cell_snow_in_summer_tray_1'
    and t.status in ('open', 'blocked')
  order by t.updated_at desc
  limit 1
), template as (
  select art.id as template_id, art.farm_id
  from atlas.action_requirement_templates art
  where art.stable_key = 'pot_up'
), requirement_rows as (
  select
    tt.task_id,
    r.id as resource_id,
    tpl.template_id,
    v.requirement_role,
    v.move_role,
    v.quantity_needed,
    v.unit,
    v.status,
    v.note
  from target_task tt
  join template tpl on tpl.farm_id = tt.farm_id
  join (
    values
      ('pot_up_tray_200_cell', 'required', 'container', 3::numeric, 'trays', 'needs_check', 'Three 200-cell trays are required for this consolidated pot-up move.'),
      ('pot_up_tray_120_cell', 'required', 'container', 1::numeric, 'tray', 'needs_check', 'One 120-cell tray is required for the final 120 plants.'),
      ('potting_mix', 'required', 'growing_medium', null::numeric, null::text, 'needs_check', 'Potting mix is required; quantity and on-hand amount have not yet been confirmed.')
  ) as v(resource_key, requirement_role, move_role, quantity_needed, unit, status, note)
    on true
  join atlas.resources r
    on r.farm_id = tt.farm_id
   and r.stable_key = v.resource_key
)
insert into atlas.task_resource_requirements (
  task_id,
  resource_id,
  template_id,
  requirement_role,
  move_role,
  requirement_source,
  quantity_needed,
  unit,
  status,
  note,
  metadata
)
select
  rr.task_id,
  rr.resource_id,
  rr.template_id,
  rr.requirement_role,
  rr.move_role,
  'manual',
  rr.quantity_needed,
  rr.unit,
  rr.status,
  rr.note,
  jsonb_build_object(
    'created_source', 'task_move_requirements_pass_2',
    'owner_confirmed_requirement', true
  )
from requirement_rows rr
where not exists (
  select 1
  from atlas.task_resource_requirements existing
  where existing.task_id = rr.task_id
    and existing.resource_id = rr.resource_id
);

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
