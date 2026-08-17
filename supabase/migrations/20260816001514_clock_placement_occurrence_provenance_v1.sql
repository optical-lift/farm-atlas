-- Pass 3A: preserve durable obligation provenance when executable tasks enter Farm Clock.
--
-- Governing chain:
-- Production/lifecycle source -> planned_work_occurrence -> released task -> Clock placement.
--
-- A task identity may legitimately be reused by a later occurrence. Clock therefore
-- snapshots the authoritative occurrence at placement time instead of resolving the
-- occurrence later through the task's mutable current link.

alter table atlas.worker_day_task_placements
  add column if not exists planned_occurrence_id uuid;

alter table atlas.worker_day_task_placement_events
  add column if not exists from_planned_occurrence_id uuid,
  add column if not exists to_planned_occurrence_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='worker_day_task_placements_planned_occurrence_id_fkey'
      and conrelid='atlas.worker_day_task_placements'::regclass
  ) then
    alter table atlas.worker_day_task_placements
      add constraint worker_day_task_placements_planned_occurrence_id_fkey
      foreign key (planned_occurrence_id)
      references atlas.planned_work_occurrences(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname='worker_day_task_placement_events_from_occurrence_fkey'
      and conrelid='atlas.worker_day_task_placement_events'::regclass
  ) then
    alter table atlas.worker_day_task_placement_events
      add constraint worker_day_task_placement_events_from_occurrence_fkey
      foreign key (from_planned_occurrence_id)
      references atlas.planned_work_occurrences(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname='worker_day_task_placement_events_to_occurrence_fkey'
      and conrelid='atlas.worker_day_task_placement_events'::regclass
  ) then
    alter table atlas.worker_day_task_placement_events
      add constraint worker_day_task_placement_events_to_occurrence_fkey
      foreign key (to_planned_occurrence_id)
      references atlas.planned_work_occurrences(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists worker_day_task_placements_occurrence_idx
  on atlas.worker_day_task_placements(planned_occurrence_id)
  where planned_occurrence_id is not null;

create index if not exists worker_day_task_placement_events_to_occurrence_idx
  on atlas.worker_day_task_placement_events(to_planned_occurrence_id)
  where to_planned_occurrence_id is not null;

create or replace function atlas.resolve_clock_placement_occurrence_v1(p_task_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_occurrence_id uuid;
  v_occurrence_released_task_id uuid;
  v_release_event_count integer := 0;
begin
  if p_task_id is null then
    return null;
  end if;

  select t.planned_occurrence_id
  into v_occurrence_id
  from atlas.tasks t
  where t.id=p_task_id;

  if not found then
    raise exception 'Clock placement task does not exist.' using errcode='P0002';
  end if;

  -- Ad-hoc/manual executable work is allowed to have no durable occurrence yet.
  if v_occurrence_id is null then
    return null;
  end if;

  select o.released_task_id
  into v_occurrence_released_task_id
  from atlas.planned_work_occurrences o
  where o.id=v_occurrence_id;

  if not found then
    raise exception 'Clock placement occurrence link is missing.' using errcode='55000';
  end if;

  select count(*)::integer
  into v_release_event_count
  from atlas.task_release_events e
  where e.task_id=p_task_id
    and e.occurrence_id=v_occurrence_id;

  -- Either the occurrence's current released-task pointer or immutable release
  -- evidence is sufficient to confirm this task/occurrence pair. This supports
  -- legacy migrated tasks without guessing across unrelated occurrences.
  if v_occurrence_released_task_id=p_task_id or v_release_event_count>0 then
    return v_occurrence_id;
  end if;

  raise exception 'Task occurrence provenance is not confirmed; Clock placement refused.'
    using errcode='55000';
end;
$$;

comment on function atlas.resolve_clock_placement_occurrence_v1(uuid) is
  'Returns the deterministically confirmed current planned_work_occurrence for a task, or NULL for genuinely occurrence-less work. Refuses ambiguous task/occurrence links so Clock never invents provenance.';

create or replace function atlas.capture_clock_placement_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  -- Snapshot provenance when a placement is created, reactivated, or moved to a
  -- different worker day. Time/duration-only edits preserve the existing snapshot.
  if tg_op='INSERT'
     or old.task_id is distinct from new.task_id
     or old.service_date is distinct from new.service_date
     or old.state is distinct from new.state
     or new.planned_occurrence_id is null
  then
    new.planned_occurrence_id:=atlas.resolve_clock_placement_occurrence_v1(new.task_id);
  end if;

  return new;
end;
$$;

drop trigger if exists capture_clock_placement_occurrence_v1 on atlas.worker_day_task_placements;
create trigger capture_clock_placement_occurrence_v1
before insert or update of task_id,service_date,state,planned_occurrence_id
on atlas.worker_day_task_placements
for each row execute function atlas.capture_clock_placement_occurrence_v1();

-- Backfill only provenance that is deterministically provable under the same rule
-- used for all future placements. The resolver raises rather than guessing.
update atlas.worker_day_task_placements p
set planned_occurrence_id=atlas.resolve_clock_placement_occurrence_v1(p.task_id)
where p.planned_occurrence_id is null;

-- The event ledger already records from/to placement state. Extend that same ledger
-- to preserve from/to occurrence identity; do not create a parallel history table.
alter table atlas.worker_day_task_placement_events
  drop constraint if exists worker_day_task_placement_events_event_kind_check;

alter table atlas.worker_day_task_placement_events
  add constraint worker_day_task_placement_events_event_kind_check
  check (event_kind = any (array[
    'atlas_placed'::text,
    'owner_added'::text,
    'owner_rewindowed'::text,
    'owner_rescheduled'::text,
    'owner_reordered'::text,
    'owner_returned_to_atlas'::text,
    'owner_timed'::text,
    'owner_time_removed'::text,
    'owner_clock_plan_commit'::text,
    'occurrence_rebased'::text,
    'provenance_backfilled'::text
  ]));

create or replace function atlas.capture_clock_placement_event_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_current_occurrence_id uuid;
  v_prior_occurrence_id uuid;
begin
  if new.placement_id is not null then
    select p.planned_occurrence_id
    into v_current_occurrence_id
    from atlas.worker_day_task_placements p
    where p.id=new.placement_id;
  end if;

  if new.to_planned_occurrence_id is null then
    new.to_planned_occurrence_id:=v_current_occurrence_id;
  end if;

  -- For ordinary placement edits, the preceding event provides the immutable
  -- from-occurrence snapshot. Explicit occurrence_rebased events supply both ends.
  if new.from_planned_occurrence_id is null and new.from_service_date is not null then
    select e.to_planned_occurrence_id
    into v_prior_occurrence_id
    from atlas.worker_day_task_placement_events e
    where e.placement_id=new.placement_id
    order by e.created_at desc,e.id desc
    limit 1;

    new.from_planned_occurrence_id:=v_prior_occurrence_id;
  end if;

  return new;
end;
$$;

drop trigger if exists capture_clock_placement_event_occurrence_v1 on atlas.worker_day_task_placement_events;
create trigger capture_clock_placement_event_occurrence_v1
before insert on atlas.worker_day_task_placement_events
for each row execute function atlas.capture_clock_placement_event_occurrence_v1();

create or replace function atlas.log_clock_placement_occurrence_rebase_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if old.planned_occurrence_id is distinct from new.planned_occurrence_id then
    insert into atlas.worker_day_task_placement_events(
      organization_id,
      farm_id,
      membership_id,
      task_id,
      placement_id,
      event_kind,
      from_service_date,
      to_service_date,
      from_day_window,
      to_day_window,
      from_sort_order,
      to_sort_order,
      actor_user_id,
      from_planned_occurrence_id,
      to_planned_occurrence_id,
      metadata
    ) values (
      new.organization_id,
      new.farm_id,
      new.membership_id,
      new.task_id,
      new.id,
      'occurrence_rebased',
      old.service_date,
      new.service_date,
      old.day_window,
      new.day_window,
      old.sort_order,
      new.sort_order,
      new.owner_actor_user_id,
      old.planned_occurrence_id,
      new.planned_occurrence_id,
      jsonb_build_object(
        'source','clock_placement_occurrence_trigger_v1',
        'reason','Task current obligation changed while the durable Clock placement row was reused.'
      )
    );
  end if;

  return null;
end;
$$;

drop trigger if exists log_clock_placement_occurrence_rebase_v1 on atlas.worker_day_task_placements;
create trigger log_clock_placement_occurrence_rebase_v1
after update of task_id,service_date,state,planned_occurrence_id
on atlas.worker_day_task_placements
for each row execute function atlas.log_clock_placement_occurrence_rebase_v1();

-- Establish immutable provenance evidence for pre-migration placements only when
-- the resolver proved a current occurrence. At audit time this is one clean row.
insert into atlas.worker_day_task_placement_events(
  organization_id,
  farm_id,
  membership_id,
  task_id,
  placement_id,
  event_kind,
  from_service_date,
  to_service_date,
  from_day_window,
  to_day_window,
  from_sort_order,
  to_sort_order,
  actor_user_id,
  from_planned_occurrence_id,
  to_planned_occurrence_id,
  metadata
)
select
  p.organization_id,
  p.farm_id,
  p.membership_id,
  p.task_id,
  p.id,
  'provenance_backfilled',
  null,
  p.service_date,
  null,
  p.day_window,
  null,
  p.sort_order,
  null,
  null,
  p.planned_occurrence_id,
  jsonb_build_object(
    'source','clock_placement_occurrence_provenance_v1',
    'reason','Pre-migration Clock placement had deterministic task/occurrence evidence.'
  )
from atlas.worker_day_task_placements p
where p.planned_occurrence_id is not null
  and not exists (
    select 1
    from atlas.worker_day_task_placement_events e
    where e.placement_id=p.id
      and e.event_kind='provenance_backfilled'
  );

comment on column atlas.worker_day_task_placements.planned_occurrence_id is
  'Immutable-at-placement snapshot of the durable work obligation currently authorizing this Clock placement. Refreshed only when the durable placement is created, reactivated, or moved to a different worker day.';

comment on column atlas.worker_day_task_placement_events.from_planned_occurrence_id is
  'Durable work obligation provenance before this placement event when known.';

comment on column atlas.worker_day_task_placement_events.to_planned_occurrence_id is
  'Durable work obligation provenance after this placement event when known.';

revoke all on function atlas.resolve_clock_placement_occurrence_v1(uuid) from public, anon;
grant execute on function atlas.resolve_clock_placement_occurrence_v1(uuid) to authenticated, service_role;