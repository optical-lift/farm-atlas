-- Remove task rows that are engine exhaust rather than farm work.
-- Preserve any archived task with outcome, transition, maintenance, production,
-- or observation history attached. Long-range chicken work remains represented by
-- its recurrence rule instead of one task row per future date.

with archived_candidates as (
  select t.id
  from atlas.tasks t
  where t.status = 'archived'
    and (
      t.generated_from is not null
      or coalesce(t.metadata ->> 'archived_reason', '') ~* '(replaced|duplicate|superseded|refresh|obsolete|retired)'
    )
), safe_archived as (
  select candidate.id
  from archived_candidates candidate
  where not exists (
      select 1 from atlas.task_outcome_events history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.task_transitions history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.maintenance_history history
      where history.source_task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_tray_batches history
      where history.source_task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.seed_allocation_consumptions history
      where history.source_task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_stage_observations history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_transplant_placements history
      where history.source_task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_readiness_observations history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_field_observations history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_harvest_lots history
      where history.source_task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.production_lot_events history
      where history.task_id = candidate.id
    )
    and not exists (
      select 1 from atlas.postharvest_container_events history
      where history.task_id = candidate.id
    )
)
delete from atlas.tasks task
using safe_archived garbage
where task.id = garbage.id;

-- July 22, 2026 + 60 days. These rows were pre-created daily chore instances,
-- not distinct long-range work decisions.
delete from atlas.tasks
where status in ('open', 'blocked')
  and title = 'Kids Chore — Feed Chickens'
  and due_date > date '2026-09-20';
