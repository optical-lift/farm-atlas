create or replace function atlas.repair_late_living_day_snapshot_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_snapshot atlas.day_plan_snapshots%rowtype;
  v_resolved_before uuid[] := '{}'::uuid[];
  v_reconciled uuid[] := '{}'::uuid[];
  v_target integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to reconcile a Living Day plan.' using errcode = '42501';
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
    raise exception 'Only the member or a farm owner may reconcile this Living Day plan.' using errcode = '42501';
  end if;

  select snapshot.*
  into v_snapshot
  from atlas.day_plan_snapshots snapshot
  where snapshot.farm_id = p_farm_id
    and snapshot.membership_id = p_membership_id
    and snapshot.service_date = p_day
  limit 1;

  if not found then
    return jsonb_build_object(
      'repaired', false,
      'reason', 'snapshot_missing',
      'resolvedBeforePreparation', '[]'::jsonb
    );
  end if;

  select coalesce(array_agg(resolved.task_id order by resolved.resolved_at, resolved.task_id), '{}'::uuid[])
  into v_resolved_before
  from (
    select event.task_id, min(event.resolved_at) as resolved_at
    from (
      select transition.task_id, transition.created_at as resolved_at
      from atlas.task_transitions transition
      where transition.farm_id = p_farm_id
        and transition.transition in ('done', 'partial', 'blocked', 'rescheduled', 'changed_plan', 'problem_to_owner')
        and (transition.created_at at time zone 'America/Chicago')::date = p_day
        and transition.created_at <= v_snapshot.prepared_at

      union all

      select outcome.task_id, outcome.created_at as resolved_at
      from atlas.task_outcome_events outcome
      where outcome.farm_id = p_farm_id
        and outcome.outcome in ('done', 'partial', 'blocked')
        and (outcome.created_at at time zone 'America/Chicago')::date = p_day
        and outcome.created_at <= v_snapshot.prepared_at
    ) event
    join atlas.tasks task on task.id = event.task_id
    where task.farm_id = p_farm_id
      and task.due_date = p_day
      and task.parent_task_id is null
      and nullif(task.metadata ->> 'parent_task_id', '') is null
      and nullif(task.metadata ->> 'parentTaskId', '') is null
      and lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      and lower(coalesce(task.metadata ->> 'day_denominator_excluded', 'false')) <> 'true'
      and lower(coalesce(task.metadata ->> 'unlocked_outside_day_plan', 'false')) <> 'true'
      and (
        task.assigned_membership_id = p_membership_id
        or task.assigned_user_id = v_membership.user_id
        or task.metadata ->> 'executor_membership_id' = p_membership_id::text
      )
      and not (task.id = any(coalesce(v_snapshot.planned_task_ids, '{}'::uuid[])))
    group by event.task_id
  ) resolved;

  if cardinality(v_resolved_before) = 0 then
    return jsonb_build_object(
      'repaired', false,
      'reason', 'no_late_resolutions',
      'resolvedBeforePreparation', '[]'::jsonb
    );
  end if;

  v_target := cardinality(coalesce(v_snapshot.planned_task_ids, '{}'::uuid[]));
  if v_target = 0 then
    v_target := cardinality(v_resolved_before);
  end if;

  select coalesce(array_agg(picked.task_id order by picked.sort_group, picked.sort_order), '{}'::uuid[])
  into v_reconciled
  from (
    select candidate.task_id, candidate.sort_group, candidate.sort_order
    from (
      select resolved.task_id, 0 as sort_group, resolved.ordinality::bigint as sort_order
      from unnest(v_resolved_before) with ordinality as resolved(task_id, ordinality)

      union all

      select planned.task_id, 1 as sort_group, planned.ordinality::bigint as sort_order
      from unnest(coalesce(v_snapshot.planned_task_ids, '{}'::uuid[])) with ordinality as planned(task_id, ordinality)
      where not (planned.task_id = any(v_resolved_before))
    ) candidate
    order by candidate.sort_group, candidate.sort_order
    limit v_target
  ) picked;

  update atlas.day_plan_snapshots snapshot
  set candidate_task_ids = v_reconciled,
      planned_task_ids = v_reconciled,
      required_task_ids = coalesce((
        select array_agg(item.task_id order by item.ordinality)
        from unnest(v_reconciled) with ordinality as item(task_id, ordinality)
        where item.task_id = any(coalesce(v_snapshot.required_task_ids, '{}'::uuid[]))
           or item.task_id = any(v_resolved_before)
      ), '{}'::uuid[]),
      flexible_task_ids = coalesce((
        select array_agg(item.task_id order by item.ordinality)
        from unnest(v_reconciled) with ordinality as item(task_id, ordinality)
        where item.task_id = any(coalesce(v_snapshot.flexible_task_ids, '{}'::uuid[]))
      ), '{}'::uuid[]),
      withheld_flexible_task_ids = coalesce((
        select array_agg(item.task_id order by item.ordinality)
        from unnest(coalesce(v_snapshot.withheld_flexible_task_ids, '{}'::uuid[])) with ordinality as item(task_id, ordinality)
        where item.task_id = any(v_reconciled)
      ), '{}'::uuid[]),
      metadata = coalesce(snapshot.metadata, '{}'::jsonb) || jsonb_build_object(
        'late_snapshot_reconciled', true,
        'late_snapshot_reconciled_at', now(),
        'resolved_before_preparation', to_jsonb(v_resolved_before),
        'denominator_preserved', v_target
      )
  where snapshot.id = v_snapshot.id;

  return jsonb_build_object(
    'repaired', true,
    'snapshotId', v_snapshot.id,
    'denominator', v_target,
    'resolvedBeforePreparation', to_jsonb(v_resolved_before),
    'plannedTaskIds', to_jsonb(v_reconciled)
  );
end;
$function$;

revoke all on function atlas.repair_late_living_day_snapshot_v1(uuid, uuid, date) from public;
revoke all on function atlas.repair_late_living_day_snapshot_v1(uuid, uuid, date) from anon;
grant execute on function atlas.repair_late_living_day_snapshot_v1(uuid, uuid, date) to authenticated;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.repair_late_living_day_snapshot_v1(uuid, uuid, date)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  false,
  1,
  0,
  jsonb_build_object(
    'source', 'living_day_progress_reconciliation',
    'catalog_date', '2026-08-03',
    'reason', 'preserve completed work when the finite day snapshot is created after a task transition'
  ),
  now(),
  now()
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  evidence = excluded.evidence,
  reviewed_at = excluded.reviewed_at;