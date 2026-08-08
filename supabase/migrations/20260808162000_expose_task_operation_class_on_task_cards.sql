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
      and (fl.metadata ->> 'task_id') = t.id::text
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

comment on column atlas.v_task_cards.operation_class is
  'Canonical operation-fitness class used by task result-mode routing and other task-card consumers.';

comment on column atlas.v_task_cards.operation_class_source is
  'Provenance for the canonical operation-fitness class.';
