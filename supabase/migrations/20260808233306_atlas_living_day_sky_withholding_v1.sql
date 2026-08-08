create or replace function atlas.prepare_living_day_plan_v1(p_farm_id uuid, p_membership_id uuid, p_day date, p_candidate_task_ids uuid[] default '{}'::uuid[], p_flexible_task_ids uuid[] default '{}'::uuid[], p_carryover_task_ids uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_membership atlas.farm_memberships%rowtype;
  v_organization_id uuid;
  v_snapshot_id uuid;
  v_prepared_at timestamptz;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_planned_ids uuid[] := '{}'::uuid[];
  v_flexible_ids uuid[] := '{}'::uuid[];
  v_required_ids uuid[] := '{}'::uuid[];
  v_withheld_ids uuid[] := '{}'::uuid[];
  v_carryover_ids uuid[] := '{}'::uuid[];
  v_resolved_ids uuid[] := '{}'::uuid[];
  v_open_ids uuid[] := '{}'::uuid[];
  v_withheld_details jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to prepare a Living Day plan.' using errcode='42501';
  end if;

  select membership.* into v_membership
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active
  limit 1;

  if not found then
    raise exception 'The requested Living Day membership is not active for this farm.' using errcode='42501';
  end if;

  if v_membership.user_id<>auth.uid() and not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only the member or a farm owner may prepare this Living Day plan.' using errcode='42501';
  end if;

  select farm.organization_id into v_organization_id from atlas.farms farm where farm.id=p_farm_id;
  if v_organization_id is null then raise exception 'The requested farm does not exist.' using errcode='P0002'; end if;

  select coalesce(array_agg(row.task_id order by row.first_ordinal),'{}'::uuid[])
  into v_candidate_ids
  from (
    select input.task_id,min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_candidate_task_ids,'{}'::uuid[])) with ordinality as input(task_id,ordinality)
    join atlas.tasks task on task.id=input.task_id and task.farm_id=p_farm_id and task.parent_task_id is null and task.status in ('open','blocked','done')
    group by input.task_id
  ) row;

  select coalesce(array_agg(row.task_id order by row.first_ordinal),'{}'::uuid[])
  into v_flexible_ids
  from (
    select input.task_id,min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_flexible_task_ids,'{}'::uuid[])) with ordinality as input(task_id,ordinality)
    where input.task_id=any(v_candidate_ids)
    group by input.task_id
  ) row;

  select coalesce(array_agg(input.task_id order by input.ordinality),'{}'::uuid[]),
         coalesce(jsonb_object_agg(input.task_id::text,gate.gate),'{}'::jsonb)
  into v_withheld_ids,v_withheld_details
  from unnest(v_flexible_ids) with ordinality as input(task_id,ordinality)
  cross join lateral (select atlas.task_sky_presentation_gate_v1(input.task_id,v_day) as gate) gate
  where coalesce((gate.gate->>'withheldUnderSky')::boolean,false);

  select coalesce(array_agg(input.task_id order by input.ordinality),'{}'::uuid[])
  into v_planned_ids
  from unnest(v_candidate_ids) with ordinality as input(task_id,ordinality)
  where not (input.task_id=any(v_withheld_ids));

  select coalesce(array_agg(input.task_id order by input.ordinality),'{}'::uuid[])
  into v_required_ids
  from unnest(v_planned_ids) with ordinality as input(task_id,ordinality)
  where not (input.task_id=any(v_flexible_ids));

  select coalesce(array_agg(row.task_id order by row.first_ordinal),'{}'::uuid[])
  into v_carryover_ids
  from (
    select input.task_id,min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_carryover_task_ids,'{}'::uuid[])) with ordinality as input(task_id,ordinality)
    join atlas.tasks task on task.id=input.task_id and task.farm_id=p_farm_id and task.parent_task_id is null and task.status in ('open','blocked')
    where not (input.task_id=any(v_withheld_ids))
    group by input.task_id
  ) row;

  if v_day=v_today then
    insert into atlas.day_plan_snapshots(
      organization_id,farm_id,membership_id,service_date,candidate_task_ids,planned_task_ids,required_task_ids,flexible_task_ids,withheld_flexible_task_ids,carryover_count,flexible_reduction,metadata
    ) values (
      v_organization_id,p_farm_id,p_membership_id,v_day,v_candidate_ids,v_planned_ids,v_required_ids,v_flexible_ids,v_withheld_ids,cardinality(v_carryover_ids),cardinality(v_withheld_ids),
      jsonb_build_object(
        'contract_version','living_day_plan_v3',
        'denominator_rule','visible_eligible_work',
        'carryover_excluded',true,
        'due_dates_unchanged',true,
        'completed_work_always_counts',true,
        'later_visible_work_counts',true,
        'sky_withholding_enabled',true,
        'sky_withheld_details',v_withheld_details,
        'reconciled_at',now()
      )
    )
    on conflict (farm_id,membership_id,service_date) do update
    set candidate_task_ids=excluded.candidate_task_ids,
        planned_task_ids=excluded.planned_task_ids,
        required_task_ids=excluded.required_task_ids,
        flexible_task_ids=excluded.flexible_task_ids,
        withheld_flexible_task_ids=excluded.withheld_flexible_task_ids,
        carryover_count=excluded.carryover_count,
        flexible_reduction=excluded.flexible_reduction,
        metadata=coalesce(atlas.day_plan_snapshots.metadata,'{}'::jsonb)||excluded.metadata
    returning id,prepared_at into v_snapshot_id,v_prepared_at;
  else
    select snapshot.id,snapshot.prepared_at into v_snapshot_id,v_prepared_at
    from atlas.day_plan_snapshots snapshot
    where snapshot.farm_id=p_farm_id and snapshot.membership_id=p_membership_id and snapshot.service_date=v_day
    limit 1;
  end if;

  select coalesce(array_agg(task.id order by array_position(v_planned_ids,task.id)),'{}'::uuid[])
  into v_resolved_ids
  from atlas.tasks task
  where task.id=any(v_planned_ids)
    and (
      task.status='done'
      or exists(select 1 from atlas.task_outcome_events outcome where outcome.task_id=task.id and outcome.outcome in ('done','partial','blocked') and (outcome.created_at at time zone 'America/Chicago')::date=v_day)
      or exists(select 1 from atlas.task_transitions transition where transition.task_id=task.id and transition.transition in ('done','partial','blocked','rescheduled','changed_plan','problem_to_owner') and (transition.created_at at time zone 'America/Chicago')::date=v_day)
      or exists(select 1 from atlas.task_problem_handoffs handoff where handoff.task_id=task.id and (handoff.opened_at at time zone 'America/Chicago')::date=v_day)
    );

  select coalesce(array_agg(input.task_id order by input.ordinality),'{}'::uuid[])
  into v_open_ids
  from unnest(v_planned_ids) with ordinality as input(task_id,ordinality)
  where not (input.task_id=any(v_resolved_ids));

  return jsonb_build_object(
    'contractVersion','living_day_plan_v3','farmId',p_farm_id,'membershipId',p_membership_id,'date',v_day,
    'snapshotId',v_snapshot_id,'preparedAt',v_prepared_at,'frozen',false,
    'denominator',cardinality(v_planned_ids),'resolvedCount',cardinality(v_resolved_ids),'openCount',cardinality(v_open_ids),
    'candidateTaskIds',to_jsonb(v_candidate_ids),'plannedTaskIds',to_jsonb(v_planned_ids),'requiredTaskIds',to_jsonb(v_required_ids),
    'flexibleTaskIds',to_jsonb(v_flexible_ids),'withheldFlexibleTaskIds',to_jsonb(v_withheld_ids),'withheldDetails',v_withheld_details,
    'carriedTaskIds',to_jsonb(v_carryover_ids),'addedAfterPlanTaskIds','[]'::jsonb,'resolvedPlanTaskIds',to_jsonb(v_resolved_ids),'openPlanTaskIds',to_jsonb(v_open_ids),
    'carryoverCount',cardinality(v_carryover_ids),'carryoverCountAtPreparation',cardinality(v_carryover_ids),'flexibleReduction',cardinality(v_withheld_ids),
    'rules',jsonb_build_object(
      'denominator','visible_eligible_work','carriedExcluded',true,'ownerProblemsExcluded',true,'partialReturnsExcluded',false,
      'addedAfterPlanExcluded',false,'withheldFlexibleExcluded',true,'dueDatesChanged',false,'completedWorkAlwaysCounts',true,'laterVisibleWorkCounts',true,
      'skyWithholding','windowed_floating_undated_only'
    )
  );
end;
$$;
