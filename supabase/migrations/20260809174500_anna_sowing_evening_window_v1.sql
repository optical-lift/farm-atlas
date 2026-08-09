with target_tasks as (
  select t.id,t.planned_occurrence_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  join atlas.farm_memberships m on m.id=t.assigned_membership_id and m.farm_id=t.farm_id
  where f.stable_key='elm_farm'
    and m.worker_key='anna'
    and t.status in ('open','blocked')
    and lower(coalesce(t.action_key,'')) in ('sow','seed')
)
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'work_order_anchor','evening',
      'work_window_key','evening',
      'window_key','evening',
      'daypart','evening',
      'sowing_evening_policy',true,
      'sowing_evening_policy_updated_at',now()
    ),
    updated_at=now()
from target_tasks target
where t.id=target.id;

with target_occurrences as (
  select distinct t.planned_occurrence_id id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  join atlas.farm_memberships m on m.id=t.assigned_membership_id and m.farm_id=t.farm_id
  where f.stable_key='elm_farm'
    and m.worker_key='anna'
    and t.status in ('open','blocked')
    and lower(coalesce(t.action_key,'')) in ('sow','seed')
    and t.planned_occurrence_id is not null
)
update atlas.planned_work_occurrences o
set task_payload=jsonb_set(
      coalesce(o.task_payload,'{}'::jsonb),
      '{metadata}',
      coalesce(o.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'work_order_anchor','evening',
        'work_window_key','evening',
        'window_key','evening',
        'daypart','evening',
        'sowing_evening_policy',true
      ),
      true
    ),
    metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('sowing_evening_policy',true),
    updated_at=now()
from target_occurrences target
where o.id=target.id;