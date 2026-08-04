-- Keep the live task, its released occurrence, and its cached transition
-- metadata aligned with the worker-authored schedule already present in the
-- transition ledger. This does not add a synthetic move.

with elm as (
  select id
  from atlas.farms
  where stable_key = 'elm_farm'
), anna as (
  select membership.id, membership.worker_key
  from atlas.farm_memberships membership
  join elm on elm.id = membership.farm_id
  where membership.active
    and lower(coalesce(membership.worker_key, '')) = 'anna'
  order by membership.created_at
  limit 1
), candidates as (
  select task.id, task.metadata
  from atlas.tasks task
  join elm on elm.id = task.farm_id
  join anna on anna.id = task.assigned_membership_id
  where task.status in ('open', 'blocked')
    and task.parent_task_id is null
    and (
      task.metadata ->> 'task_key' in (
        'anna_20260728_put_away_cat_litter_food',
        'anna_20260726_set_up_fan_seedlings',
        'anna_20260713_mow_corral_weekly',
        'anna_20260716_divide_lilac_haven_irises_into_drifts'
      )
      or task.title = 'Restore mowing rhythm — Field Rows · Back Half'
    )
), worker_moves as (
  select distinct on (transition_row.task_id)
    transition_row.task_id,
    transition_row.target_date,
    jsonb_build_object(
      'note', transition_row.note,
      'reason', transition_row.reason,
      'action_key', transition_row.action_key,
      'transition', transition_row.transition,
      'work_class', transition_row.work_class,
      'recorded_at', transition_row.created_at,
      'target_date', transition_row.target_date,
      'idempotency_key', transition_row.idempotency_key
    ) as worker_schedule_transition
  from atlas.task_transitions transition_row
  join candidates on candidates.id = transition_row.task_id
  cross join anna
  where transition_row.transition = 'rescheduled'
    and transition_row.target_date is not null
    and (
      transition_row.actor_membership_id = anna.id
      or transition_row.payload ->> 'actor_membership_id' = anna.id::text
      or (
        transition_row.actor_membership_id is null
        and lower(coalesce(transition_row.reason, '')) like '%assigned task page%'
        and (
          lower(coalesce(transition_row.payload ->> 'assigneeKey', '')) = lower(coalesce(anna.worker_key, ''))
          or candidates.metadata ->> 'executor_membership_id' = anna.id::text
        )
      )
    )
  order by transition_row.task_id, transition_row.created_at desc
), latest_transitions as (
  select distinct on (transition_row.task_id)
    transition_row.task_id,
    jsonb_build_object(
      'note', transition_row.note,
      'reason', transition_row.reason,
      'action_key', transition_row.action_key,
      'transition', transition_row.transition,
      'work_class', transition_row.work_class,
      'recorded_at', transition_row.created_at,
      'target_date', transition_row.target_date,
      'idempotency_key', transition_row.idempotency_key
    ) as transition_snapshot
  from atlas.task_transitions transition_row
  join candidates on candidates.id = transition_row.task_id
  order by transition_row.task_id, transition_row.created_at desc
), repaired as (
  update atlas.tasks task
  set due_date = worker_moves.target_date,
      metadata = jsonb_set(
        (
          coalesce(task.metadata, '{}'::jsonb)
          - 'owner_rescheduled_at'
          - 'owner_rescheduled_from'
          - 'owner_rescheduled_to'
          - 'owner_rescheduled_reason'
          - 'owner_reschedule_reason'
          - 'sunday_guardrail_applied'
          - 'sunday_guardrail_original_due_date'
          - 'sunday_guardrail_shifted_to'
          - 'sunday_guardrail_applied_at'
          - 'sunday_guardrail_reason'
        ) || jsonb_build_object(
          'allow_sunday', case
            when extract(dow from worker_moves.target_date) = 0 then true
            else coalesce((task.metadata ->> 'allow_sunday')::boolean, false)
          end,
          'worker_schedule_restored_at', now(),
          'worker_schedule_restored_to', worker_moves.target_date::text,
          'worker_schedule_restored_reason', 'Restored from assigned-worker reschedule history',
          'worker_schedule_transition', worker_moves.worker_schedule_transition
        ),
        '{last_transition}', latest_transitions.transition_snapshot, true
      )
  from worker_moves
  join latest_transitions on latest_transitions.task_id = worker_moves.task_id
  where task.id = worker_moves.task_id
  returning task.id, task.due_date, task.metadata
)
update atlas.planned_work_occurrences occurrence
set planned_due_date = repaired.due_date,
    not_before_date = least(coalesce(occurrence.not_before_date, repaired.due_date), repaired.due_date),
    task_payload = jsonb_set(
      jsonb_set(coalesce(occurrence.task_payload, '{}'::jsonb), '{due_date}', to_jsonb(repaired.due_date::text), true),
      '{metadata}', repaired.metadata, true
    ),
    metadata = (
      coalesce(occurrence.metadata, '{}'::jsonb)
      - 'owner_rescheduled_at'
      - 'owner_rescheduled_from'
      - 'owner_rescheduled_to'
      - 'owner_rescheduled_reason'
      - 'owner_reschedule_reason'
    ) || jsonb_build_object(
      'worker_schedule_restored_at', now(),
      'worker_schedule_restored_to', repaired.due_date::text,
      'worker_schedule_restored_reason', 'Restored from assigned-worker reschedule history'
    ),
    updated_at = now()
from repaired
where occurrence.released_task_id = repaired.id;
