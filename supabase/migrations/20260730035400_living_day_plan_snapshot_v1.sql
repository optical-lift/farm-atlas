create table if not exists atlas.day_plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  service_date date not null,
  candidate_task_ids uuid[] not null default '{}'::uuid[],
  planned_task_ids uuid[] not null default '{}'::uuid[],
  required_task_ids uuid[] not null default '{}'::uuid[],
  flexible_task_ids uuid[] not null default '{}'::uuid[],
  withheld_flexible_task_ids uuid[] not null default '{}'::uuid[],
  carryover_count integer not null default 0 check (carryover_count >= 0),
  flexible_reduction integer not null default 0 check (flexible_reduction >= 0),
  prepared_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (farm_id, membership_id, service_date)
);

comment on table atlas.day_plan_snapshots is
  'Immutable same-day snapshots of the finite Living Day hand. Consequence work remains visible outside the denominator.';
comment on column atlas.day_plan_snapshots.candidate_task_ids is
  'Exact visible ordinary due-task candidates when the day was first opened.';
comment on column atlas.day_plan_snapshots.withheld_flexible_task_ids is
  'Flexible tasks kept outside the finite hand because carryover consumed available dealing capacity; due dates are not changed.';

create index if not exists idx_day_plan_snapshots_farm_day
  on atlas.day_plan_snapshots (farm_id, service_date desc);
create index if not exists idx_day_plan_snapshots_membership_day
  on atlas.day_plan_snapshots (membership_id, service_date desc);

alter table atlas.day_plan_snapshots enable row level security;

drop policy if exists day_plan_snapshots_read_v1 on atlas.day_plan_snapshots;
create policy day_plan_snapshots_read_v1
  on atlas.day_plan_snapshots
  for select
  to authenticated
  using (atlas.is_farm_member(farm_id));

revoke all on atlas.day_plan_snapshots from anon;
grant select on atlas.day_plan_snapshots to authenticated;

create or replace function atlas.prepare_living_day_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_candidate_task_ids uuid[] default '{}'::uuid[],
  p_flexible_task_ids uuid[] default '{}'::uuid[],
  p_carryover_task_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Chicago')::date);
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_membership atlas.farm_memberships%rowtype;
  v_organization_id uuid;
  v_snapshot atlas.day_plan_snapshots%rowtype;
  v_snapshot_id uuid;
  v_prepared_at timestamptz;
  v_frozen boolean := false;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_current_candidate_ids uuid[] := '{}'::uuid[];
  v_flexible_candidates uuid[] := '{}'::uuid[];
  v_planned_ids uuid[] := '{}'::uuid[];
  v_required_ids uuid[] := '{}'::uuid[];
  v_flexible_ids uuid[] := '{}'::uuid[];
  v_withheld_ids uuid[] := '{}'::uuid[];
  v_carryover_ids uuid[] := '{}'::uuid[];
  v_resolved_ids uuid[] := '{}'::uuid[];
  v_open_ids uuid[] := '{}'::uuid[];
  v_added_ids uuid[] := '{}'::uuid[];
  v_carryover_count integer := 0;
  v_reduction integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to prepare a Living Day plan.' using errcode = '42501';
  end if;

  select membership.*
  into v_membership
  from atlas.farm_memberships membership
  where membership.id = p_membership_id
    and membership.farm_id = p_farm_id
    and membership.active
  limit 1;

  if not found then
    raise exception 'The requested Living Day membership is not active for this farm.' using errcode = '42501';
  end if;

  if v_membership.user_id <> auth.uid() and not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only the member or a farm owner may prepare this Living Day plan.' using errcode = '42501';
  end if;

  select farm.organization_id
  into v_organization_id
  from atlas.farms farm
  where farm.id = p_farm_id;

  if v_organization_id is null then
    raise exception 'The requested farm does not exist.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(row.task_id order by row.first_ordinal), '{}'::uuid[])
  into v_current_candidate_ids
  from (
    select input.task_id, min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_candidate_task_ids, '{}'::uuid[])) with ordinality as input(task_id, ordinality)
    join atlas.tasks task
      on task.id = input.task_id
     and task.farm_id = p_farm_id
     and task.parent_task_id is null
     and task.status <> 'archived'
    group by input.task_id
  ) row;

  select coalesce(array_agg(row.task_id order by row.first_ordinal), '{}'::uuid[])
  into v_flexible_candidates
  from (
    select input.task_id, min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_flexible_task_ids, '{}'::uuid[])) with ordinality as input(task_id, ordinality)
    where input.task_id = any(v_current_candidate_ids)
    group by input.task_id
  ) row;

  select coalesce(array_agg(row.task_id order by row.first_ordinal), '{}'::uuid[])
  into v_carryover_ids
  from (
    select input.task_id, min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_carryover_task_ids, '{}'::uuid[])) with ordinality as input(task_id, ordinality)
    join atlas.tasks task
      on task.id = input.task_id
     and task.farm_id = p_farm_id
     and task.parent_task_id is null
     and task.status in ('open', 'blocked')
    group by input.task_id
  ) row;

  select snapshot.*
  into v_snapshot
  from atlas.day_plan_snapshots snapshot
  where snapshot.farm_id = p_farm_id
    and snapshot.membership_id = p_membership_id
    and snapshot.service_date = v_day
  limit 1;

  if found then
    v_snapshot_id := v_snapshot.id;
    v_prepared_at := v_snapshot.prepared_at;
    v_frozen := true;
    v_candidate_ids := v_snapshot.candidate_task_ids;
    v_planned_ids := v_snapshot.planned_task_ids;
    v_required_ids := v_snapshot.required_task_ids;
    v_flexible_ids := v_snapshot.flexible_task_ids;
    v_withheld_ids := v_snapshot.withheld_flexible_task_ids;
    v_carryover_count := v_snapshot.carryover_count;
    v_reduction := v_snapshot.flexible_reduction;
  else
    v_candidate_ids := v_current_candidate_ids;
    v_carryover_count := cardinality(v_carryover_ids);
    v_reduction := least(v_carryover_count, cardinality(v_flexible_candidates));

    if v_reduction > 0 then
      select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
      into v_withheld_ids
      from unnest(v_flexible_candidates) with ordinality as input(task_id, ordinality)
      where input.ordinality > cardinality(v_flexible_candidates) - v_reduction;
    end if;

    select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
    into v_planned_ids
    from unnest(v_candidate_ids) with ordinality as input(task_id, ordinality)
    where not (input.task_id = any(v_withheld_ids));

    select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
    into v_required_ids
    from unnest(v_planned_ids) with ordinality as input(task_id, ordinality)
    where not (input.task_id = any(v_flexible_candidates));

    select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
    into v_flexible_ids
    from unnest(v_planned_ids) with ordinality as input(task_id, ordinality)
    where input.task_id = any(v_flexible_candidates);

    if v_day = v_today then
      insert into atlas.day_plan_snapshots (
        organization_id,
        farm_id,
        membership_id,
        service_date,
        candidate_task_ids,
        planned_task_ids,
        required_task_ids,
        flexible_task_ids,
        withheld_flexible_task_ids,
        carryover_count,
        flexible_reduction,
        metadata
      ) values (
        v_organization_id,
        p_farm_id,
        p_membership_id,
        v_day,
        v_candidate_ids,
        v_planned_ids,
        v_required_ids,
        v_flexible_ids,
        v_withheld_ids,
        v_carryover_count,
        v_reduction,
        jsonb_build_object(
          'contract_version', 'living_day_plan_v1',
          'denominator_rule', 'morning_hand_only',
          'carryover_excluded', true,
          'due_dates_unchanged', true
        )
      )
      on conflict (farm_id, membership_id, service_date) do nothing
      returning id, prepared_at into v_snapshot_id, v_prepared_at;

      if v_snapshot_id is null then
        select snapshot.*
        into v_snapshot
        from atlas.day_plan_snapshots snapshot
        where snapshot.farm_id = p_farm_id
          and snapshot.membership_id = p_membership_id
          and snapshot.service_date = v_day
        limit 1;

        v_snapshot_id := v_snapshot.id;
        v_prepared_at := v_snapshot.prepared_at;
        v_candidate_ids := v_snapshot.candidate_task_ids;
        v_planned_ids := v_snapshot.planned_task_ids;
        v_required_ids := v_snapshot.required_task_ids;
        v_flexible_ids := v_snapshot.flexible_task_ids;
        v_withheld_ids := v_snapshot.withheld_flexible_task_ids;
        v_carryover_count := v_snapshot.carryover_count;
        v_reduction := v_snapshot.flexible_reduction;
      end if;

      v_frozen := true;
    end if;
  end if;

  select coalesce(array_agg(task.id order by array_position(v_planned_ids, task.id)), '{}'::uuid[])
  into v_resolved_ids
  from atlas.tasks task
  where task.id = any(v_planned_ids)
    and (
      task.status = 'done'
      or exists (
        select 1
        from atlas.task_outcome_events outcome
        where outcome.task_id = task.id
          and outcome.outcome in ('done', 'partial', 'blocked')
          and (outcome.created_at at time zone 'America/Chicago')::date = v_day
      )
      or exists (
        select 1
        from atlas.task_transitions transition
        where transition.task_id = task.id
          and transition.transition in ('done', 'partial', 'blocked', 'rescheduled', 'changed_plan', 'problem_to_owner')
          and (transition.created_at at time zone 'America/Chicago')::date = v_day
      )
      or exists (
        select 1
        from atlas.task_problem_handoffs handoff
        where handoff.task_id = task.id
          and (handoff.opened_at at time zone 'America/Chicago')::date = v_day
      )
    );

  select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
  into v_open_ids
  from unnest(v_planned_ids) with ordinality as input(task_id, ordinality)
  where not (input.task_id = any(v_resolved_ids));

  select coalesce(array_agg(input.task_id order by input.ordinality), '{}'::uuid[])
  into v_added_ids
  from unnest(v_current_candidate_ids) with ordinality as input(task_id, ordinality)
  where not (input.task_id = any(v_candidate_ids));

  return jsonb_build_object(
    'contractVersion', 'living_day_plan_v1',
    'farmId', p_farm_id,
    'membershipId', p_membership_id,
    'date', v_day,
    'snapshotId', v_snapshot_id,
    'preparedAt', v_prepared_at,
    'frozen', v_frozen,
    'denominator', cardinality(v_planned_ids),
    'resolvedCount', cardinality(v_resolved_ids),
    'openCount', cardinality(v_open_ids),
    'plannedTaskIds', to_jsonb(v_planned_ids),
    'requiredTaskIds', to_jsonb(v_required_ids),
    'flexibleTaskIds', to_jsonb(v_flexible_ids),
    'withheldFlexibleTaskIds', to_jsonb(v_withheld_ids),
    'carriedTaskIds', to_jsonb(v_carryover_ids),
    'addedAfterPlanTaskIds', to_jsonb(v_added_ids),
    'resolvedPlanTaskIds', to_jsonb(v_resolved_ids),
    'openPlanTaskIds', to_jsonb(v_open_ids),
    'carryoverCount', cardinality(v_carryover_ids),
    'carryoverCountAtPreparation', v_carryover_count,
    'flexibleReduction', v_reduction,
    'rules', jsonb_build_object(
      'denominator', 'morning_hand_only',
      'carriedExcluded', true,
      'ownerProblemsExcluded', true,
      'partialReturnsExcluded', true,
      'addedAfterPlanExcluded', true,
      'withheldFlexibleExcluded', true,
      'dueDatesChanged', false
    )
  );
end;
$$;

revoke all on function atlas.prepare_living_day_plan_v1(uuid, uuid, date, uuid[], uuid[], uuid[]) from public;
grant execute on function atlas.prepare_living_day_plan_v1(uuid, uuid, date, uuid[], uuid[], uuid[]) to authenticated;
