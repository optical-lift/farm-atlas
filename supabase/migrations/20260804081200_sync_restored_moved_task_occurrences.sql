-- A task and its released planned occurrence must agree on the restored date.
-- This aligns the complete 11-card moved-work set after the task ledger repair.

with elm as (
  select id
  from atlas.farms
  where stable_key = 'elm_farm'
), anna as (
  select membership.id
  from atlas.farm_memberships membership
  join elm on elm.id = membership.farm_id
  where membership.active
    and lower(coalesce(membership.worker_key, '')) = 'anna'
  order by membership.created_at
  limit 1
), affected as (
  select task.id, task.due_date, task.metadata
  from atlas.tasks task
  join elm on elm.id = task.farm_id
  join anna on anna.id = task.assigned_membership_id
  where task.status in ('open', 'blocked')
    and task.parent_task_id is null
    and task.due_date is not null
    and (
      task.metadata ->> 'task_key' in (
        'anna_20260728_clean_garage_refrigerator',
        'anna_20260728_clean_interior_windows_glass_doors',
        'lemon_basil_root_readiness_20260804',
        'anna_20260716_divide_lilac_haven_irises_into_drifts',
        'anna_20260713_mow_corral_weekly',
        'anna_20260730_source_free_farm_inputs',
        'anna_20260728_put_away_cat_litter_food',
        'anna_20260726_set_up_fan_seedlings',
        'anna_20260726_support_fishing_line_berry_walk_barn_beds'
      )
      or task.title in (
        'Restore mowing rhythm — Field Rows · Back Half',
        'Weed Entry Billboard Bed 7'
      )
    )
)
update atlas.planned_work_occurrences occurrence
set planned_due_date = affected.due_date,
    not_before_date = least(coalesce(occurrence.not_before_date, affected.due_date), affected.due_date),
    task_payload = jsonb_set(
      jsonb_set(coalesce(occurrence.task_payload, '{}'::jsonb), '{due_date}', to_jsonb(affected.due_date::text), true),
      '{metadata}', affected.metadata, true
    ),
    metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
      'restored_schedule_synced_at', now(),
      'restored_schedule_synced_to', affected.due_date::text,
      'restored_schedule_sync_reason', 'Keep released occurrence aligned with restored moved-task schedule'
    ),
    updated_at = now()
from affected
where occurrence.id = nullif(affected.metadata ->> 'planned_occurrence_id', '')::uuid;
