-- Barn Bed 6 is a production bed. It was accidentally enrolled with hospitality
-- priority context, which leaked a Hospitality tag into the generated Weed Card.

update atlas.rhythm_rules
set player_routing = jsonb_set(
      coalesce(player_routing, '{}'::jsonb),
      '{priorityContext}',
      '["production","weed_stewardship"]'::jsonb,
      true
    ),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'classification_corrected_at', now(),
        'classification_correction_reason', 'Barn Bed 6 is production bed maintenance, not hospitality presentability'
      ),
    updated_at = now()
where rule_key = 'elm_weed_card_bb_6';

with current_bb6 as (
  select t.id, t.planned_occurrence_id
  from atlas.tasks t
  join atlas.growing_objects go on go.id = nullif(t.metadata->>'target_object_id','')::uuid
  where go.stable_key = 'bb_6'
    and t.action_key = 'weed'
    and t.status in ('open','blocked')
  order by t.created_at desc
  limit 1
), updated_task as (
  update atlas.tasks t
  set due_date = date '2026-08-10',
      work_class = 'standard',
      metadata = coalesce(t.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'execution_date', '2026-08-10',
          'owner_rescheduled_to', '2026-08-10',
          'owner_reschedule_reason', 'Moved to next week by owner',
          'work_class_correction', 'standard',
          'work_class_correction_reason', 'Barn Bed 6 is production bed maintenance, not hospitality'
        ),
      updated_at = now()
  from current_bb6 c
  where t.id = c.id
  returning t.planned_occurrence_id
)
update atlas.planned_work_occurrences pwo
set planned_due_date = date '2026-08-10',
    not_before_date = date '2026-08-10',
    task_payload = jsonb_set(
      jsonb_set(coalesce(pwo.task_payload, '{}'::jsonb), '{work_class}', '"standard"'::jsonb, true),
      '{due_date}',
      '"2026-08-10"'::jsonb,
      true
    ),
    metadata = coalesce(pwo.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'owner_rescheduled_to', '2026-08-10',
        'owner_reschedule_reason', 'Moved to next week by owner',
        'releasedExecutionDate', '2026-08-10',
        'work_class_correction', 'standard'
      ),
    updated_at = now()
from updated_task u
where pwo.id = u.planned_occurrence_id;
