begin;

-- Preserve any checks already made on the original card before retiring its rows.
create temporary table thursday_morning_v1_check_state on commit drop as
select
  item.task_id,
  item.item_key,
  item.checked,
  item.checked_at,
  item.checked_by_membership_id
from atlas.task_execution_checklist_items item
join atlas.tasks task on task.id = item.task_id
where task.status in ('open','blocked')
  and task.metadata ->> 'execution_checklist_template_key' = 'community_thursday_morning_v1';

update atlas.task_execution_checklist_items item
set metadata = coalesce(item.metadata,'{}'::jsonb) || jsonb_build_object(
      'retired',true,
      'retiredAt',now(),
      'retiredReason','Replaced by four smaller Thursday morning task clusters.'
    ),
    updated_at = now()
from atlas.tasks task
where task.id = item.task_id
  and task.status in ('open','blocked')
  and task.metadata ->> 'execution_checklist_template_key' = 'community_thursday_morning_v1';

-- The former single occurrence becomes the room-check occurrence. The v2
-- occurrence trigger creates the outdoor, coffee/water, and trash siblings.
update atlas.planned_work_occurrences
set occurrence_key = 'community_thursday_wednesday_rooms:' || planned_due_date::text,
    updated_at = now()
where occurrence_key like 'community_thursday_wednesday_setup:%'
  and state in ('planned','eligible','failed','released');

-- Keep the already-released task as the room-check card so its identity and
-- trail remain intact.
update atlas.tasks task
set title = occurrence.task_payload ->> 'title',
    task_type = coalesce(nullif(occurrence.task_payload ->> 'task_type',''),'event_setup'),
    priority = coalesce(nullif(occurrence.task_payload ->> 'priority',''),'high'),
    action_key = coalesce(nullif(occurrence.task_payload ->> 'action_key',''),'prepare'),
    work_class = coalesce(nullif(occurrence.task_payload ->> 'work_class',''),'light'),
    task_series_key = occurrence.task_payload ->> 'task_series_key',
    engine_instance_key = occurrence.task_payload ->> 'engine_instance_key',
    release_policy_id = occurrence.release_policy_id,
    work_lane = occurrence.work_lane,
    commitment_kind = occurrence.commitment_kind,
    effort_units = occurrence.effort_units,
    note = 'Complete the room-check cluster before Thursday morning guests arrive.',
    metadata = (coalesce(task.metadata,'{}'::jsonb)
      - 'detail_lines'
      - 'execution_checklist_template_key'
      - 'execution_checklist_title'
      - 'execution_checklist_completion_label')
      || coalesce(occurrence.task_payload -> 'metadata','{}'::jsonb)
      || jsonb_build_object(
        'planned_occurrence_id',occurrence.id,
        'release_policy_id',occurrence.release_policy_id,
        'release_reason',coalesce(task.release_reason,'owner_cluster_split'),
        'cluster_split_at',now(),
        'cluster_split_source','owner_instruction_20260804'
      ),
    updated_at = now()
from atlas.planned_work_occurrences occurrence
where task.planned_occurrence_id = occurrence.id
  and occurrence.occurrence_key like 'community_thursday_wednesday_rooms:%'
  and task.status in ('open','blocked');

-- Release the other three clusters beside the room card for any current room
-- occurrence that is already released.
insert into atlas.tasks (
  id, farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id,
  completed_at, completed_by, note, metadata, action_key, work_class,
  parent_task_id, task_series_key, engine_instance_key, visibility_scope,
  assigned_membership_id, planned_occurrence_id, release_policy_id,
  released_at, release_reason, organization_id, task_scope,
  assigned_user_id, created_by_user_id, origin_kind,
  work_lane, commitment_kind, effort_units
)
select
  gen_random_uuid(),
  room_task.farm_id,
  room_task.zone_id,
  sibling.task_payload ->> 'title',
  coalesce(nullif(sibling.task_payload ->> 'task_type',''),'event_setup'),
  'open',
  coalesce(nullif(sibling.task_payload ->> 'priority',''),'high'),
  sibling.planned_due_date,
  nullif(sibling.task_payload ->> 'unlock_text',''),
  null,
  null,
  null,
  null,
  null,
  case sibling.metadata ->> 'thursdayMorningClusterKey'
    when 'outdoor' then 'Close this small farm-work cluster before Thursday morning.'
    when 'coffee_water' then 'Prepare the coffee bar and water for Thursday morning.'
    else 'Take out the kitchen trash before Thursday morning.'
  end,
  coalesce(sibling.task_payload -> 'metadata','{}'::jsonb) || jsonb_build_object(
    'planned_occurrence_id',sibling.id,
    'release_policy_id',sibling.release_policy_id,
    'released_at',now(),
    'release_reason','owner_cluster_split',
    'cluster_split_at',now(),
    'cluster_split_source','owner_instruction_20260804'
  ),
  coalesce(nullif(sibling.task_payload ->> 'action_key',''),'prepare'),
  coalesce(nullif(sibling.task_payload ->> 'work_class',''),'light'),
  null,
  sibling.task_payload ->> 'task_series_key',
  sibling.task_payload ->> 'engine_instance_key',
  coalesce(nullif(sibling.task_payload ->> 'visibility_scope',''),room_task.visibility_scope),
  room_task.assigned_membership_id,
  sibling.id,
  sibling.release_policy_id,
  now(),
  'owner_cluster_split',
  room_task.organization_id,
  room_task.task_scope,
  room_task.assigned_user_id,
  room_task.created_by_user_id,
  room_task.origin_kind,
  sibling.work_lane,
  sibling.commitment_kind,
  sibling.effort_units
from atlas.tasks room_task
join atlas.planned_work_occurrences room_occurrence
  on room_occurrence.id = room_task.planned_occurrence_id
join atlas.planned_work_occurrences sibling
  on sibling.farm_id = room_occurrence.farm_id
 and sibling.planned_due_date = room_occurrence.planned_due_date
 and sibling.source_event_key is not distinct from room_occurrence.source_event_key
 and sibling.occurrence_key in (
   'community_thursday_wednesday_outdoor:' || room_occurrence.planned_due_date::text,
   'community_thursday_wednesday_coffee_water:' || room_occurrence.planned_due_date::text,
   'community_thursday_wednesday_trash:' || room_occurrence.planned_due_date::text
 )
where room_task.status in ('open','blocked')
  and room_occurrence.state = 'released'
  and room_occurrence.occurrence_key like 'community_thursday_wednesday_rooms:%'
  and not exists (
    select 1
    from atlas.tasks existing
    where existing.planned_occurrence_id = sibling.id
      and existing.status in ('open','blocked')
  );

-- Carry forward exact checks for the outdoor, coffee/water, and trash lines.
update atlas.task_execution_checklist_items item
set checked = prior.checked,
    checked_at = prior.checked_at,
    checked_by_membership_id = prior.checked_by_membership_id,
    metadata = item.metadata || jsonb_build_object(
      'migratedFromTaskId',room_task.id,
      'migratedFromTemplate','community_thursday_morning_v1'
    ),
    updated_at = now()
from atlas.tasks cluster_task
join atlas.tasks room_task
  on room_task.farm_id = cluster_task.farm_id
 and room_task.due_date = cluster_task.due_date
 and room_task.task_series_key = 'community_thursday_wednesday_rooms'
join thursday_morning_v1_check_state prior
  on prior.task_id = room_task.id
where item.task_id = cluster_task.id
  and prior.item_key = item.item_key
  and cluster_task.task_series_key in (
    'community_thursday_wednesday_outdoor',
    'community_thursday_wednesday_coffee_water',
    'community_thursday_wednesday_trash'
  );

-- Collapse the former room micro-lines into one condition per room.
with room_state as (
  select
    prior.task_id,
    'bathroom_ready'::text as item_key,
    coalesce(bool_and(prior.checked),false) as checked,
    max(prior.checked_at) as checked_at
  from thursday_morning_v1_check_state prior
  where prior.item_key in ('bathroom_clean_ready','bathroom_supplies_stocked')
  group by prior.task_id
  union all
  select
    prior.task_id,
    'library_ready',
    coalesce(bool_and(prior.checked),false),
    max(prior.checked_at)
  from thursday_morning_v1_check_state prior
  where prior.item_key in ('library_surfaces_clear','library_furniture_reset','library_visibly_ready')
  group by prior.task_id
  union all
  select
    prior.task_id,
    'meeting_room_ready',
    coalesce(bool_and(prior.checked),false),
    max(prior.checked_at)
  from thursday_morning_v1_check_state prior
  where prior.item_key in ('meeting_surfaces_clear','meeting_furniture_reset','meeting_visibly_ready')
  group by prior.task_id
)
update atlas.task_execution_checklist_items item
set checked = room_state.checked,
    checked_at = room_state.checked_at,
    checked_by_membership_id = null,
    metadata = item.metadata || jsonb_build_object(
      'migratedFromTaskId',room_state.task_id,
      'migratedFromTemplate','community_thursday_morning_v1',
      'migrationRule','all former room conditions had to be checked'
    ),
    updated_at = now()
from room_state
where item.task_id = room_state.task_id
  and item.item_key = room_state.item_key;

-- Add a migration event only when a prior check produced a completed v2 line.
insert into atlas.task_execution_checklist_events (
  farm_id, task_id, item_id, item_key, event_kind,
  actor_user_id, actor_membership_id, effective_membership_id,
  occurred_at, idempotency_key, payload
)
select
  item.farm_id,
  item.task_id,
  item.id,
  item.item_key,
  'checked',
  null,
  item.checked_by_membership_id,
  item.checked_by_membership_id,
  coalesce(item.checked_at,now()),
  'migration:thursday-morning-clusters-v2:' || item.id::text,
  jsonb_build_object(
    'source','thursday_morning_clusters_v2',
    'preservedPriorCheck',true
  )
from atlas.task_execution_checklist_items item
join atlas.tasks task on task.id = item.task_id
where item.checked
  and task.metadata ->> 'execution_checklist_template_key' in (
    'community_thursday_morning_outdoor_v2',
    'community_thursday_morning_coffee_water_v2',
    'community_thursday_morning_rooms_v2',
    'community_thursday_morning_trash_v2'
  )
on conflict (farm_id, idempotency_key) do nothing;

-- The old one-card definition remains for audit history but can no longer
-- release another oversized task.
update atlas.work_release_policies policy
set active = false,
    metadata = coalesce(policy.metadata,'{}'::jsonb) || jsonb_build_object(
      'supersededBy','thursday_morning_clusters_v2',
      'supersededAt',now()
    ),
    updated_at = now()
from atlas.work_definitions definition
where definition.id = policy.work_definition_id
  and definition.metadata ->> 'series_key' = 'community_thursday_wednesday_setup';

update atlas.work_definitions
set active = false,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'supersededBy','thursday_morning_clusters_v2',
      'supersededAt',now()
    ),
    updated_at = now()
where metadata ->> 'series_key' = 'community_thursday_wednesday_setup';

commit;
