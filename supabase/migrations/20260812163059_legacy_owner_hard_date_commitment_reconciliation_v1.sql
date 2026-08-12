begin;

update atlas.tasks task
set work_lane = 'required',
    commitment_kind = 'hard_date',
    metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'date_behavior', 'hard_date',
      'date_commitment', 'hard_date',
      'commitment_kind', 'hard_date',
      'legacy_owner_hard_date_reconciled', true
    ),
    updated_at = now()
where task.due_date is not null
  and task.metadata ->> 'calendar_commitment_kind' = 'owner_hard_date'
  and (
    task.work_lane is distinct from 'required'
    or task.commitment_kind is distinct from 'hard_date'
    or task.metadata ->> 'date_commitment' is distinct from 'hard_date'
  );

update atlas.planned_work_occurrences occurrence
set work_lane = 'required',
    commitment_kind = 'hard_date',
    task_payload = coalesce(occurrence.task_payload, '{}'::jsonb) || jsonb_build_object(
      'work_lane', 'required',
      'commitment_kind', 'hard_date',
      'metadata', coalesce(occurrence.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'date_behavior', 'hard_date',
        'date_commitment', 'hard_date',
        'commitment_kind', 'hard_date',
        'legacy_owner_hard_date_reconciled', true
      )
    ),
    metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
      'dateBehavior', 'hard_date',
      'legacyOwnerHardDateReconciled', true
    ),
    updated_at = now()
where occurrence.id in (
  select task.planned_occurrence_id
  from atlas.tasks task
  where task.planned_occurrence_id is not null
    and task.metadata ->> 'calendar_commitment_kind' = 'owner_hard_date'
);

commit;
