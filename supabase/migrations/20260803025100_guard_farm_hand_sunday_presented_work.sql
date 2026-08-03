do $$
begin
  if to_regprocedure('atlas.presented_work_rows_unfiltered_v1(uuid,uuid,date)') is null then
    alter function atlas.presented_work_rows_v1(uuid, uuid, date)
      rename to presented_work_rows_unfiltered_v1;
  end if;
end
$$;

revoke all on function atlas.presented_work_rows_unfiltered_v1(uuid, uuid, date) from public;
revoke execute on function atlas.presented_work_rows_unfiltered_v1(uuid, uuid, date) from anon, authenticated;
grant execute on function atlas.presented_work_rows_unfiltered_v1(uuid, uuid, date) to service_role;

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
)
returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_role text;
begin
  select fm.role
  into v_target_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode = '42501';
  end if;

  if extract(dow from v_work_date) = 0 and v_target_role = 'farm_hand' then
    return query
    with allowed as (
      select row.*
      from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row
      join atlas.tasks t on t.id = row.task_id
      where t.due_date = v_work_date
        and t.assigned_membership_id = p_membership_id
        and coalesce((t.metadata ->> 'allow_sunday')::boolean, false) is true
        and coalesce((t.metadata ->> 'owner_schedule_override')::boolean, false) is true
    )
    select
      allowed.task_id,
      'presented'::text,
      'owner_sunday_override'::text,
      allowed.lane_order,
      row_number() over (
        order by allowed.lane_order, allowed.selection_rank, allowed.task_id
      )::bigint,
      allowed.work_lane,
      allowed.commitment_kind,
      allowed.effort_units,
      allowed.budget_units,
      allowed.notification_planned,
      false,
      allowed.task_card
    from allowed
    order by 4, 5;

    return;
  end if;

  return query
  select row.*
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row;
end;
$function$;

revoke all on function atlas.presented_work_rows_v1(uuid, uuid, date) from public;
revoke execute on function atlas.presented_work_rows_v1(uuid, uuid, date) from anon;
grant execute on function atlas.presented_work_rows_v1(uuid, uuid, date) to authenticated, service_role;

with actual as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
    p.prosecdef as security_definer,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.proname = 'presented_work_rows_v1'
    and oidvectortypes(p.proargtypes) = 'uuid, uuid, date'
)
insert into atlas.authenticated_rpc_registry(
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
)
select
  actual.signature,
  'policy_or_composition_helper',
  'verified',
  'active',
  actual.authenticated_execute,
  actual.security_definer,
  actual.service_execute,
  0,
  0,
  jsonb_build_object(
    'source', 'farm_hand_sunday_presented_work_guard',
    'call_site', 'Presented Work readers',
    'authorization', 'self or farm management',
    'reviewed_date', '2026-08-02'
  ),
  now(),
  now()
from actual
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    evidence = atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at = excluded.reviewed_at;
