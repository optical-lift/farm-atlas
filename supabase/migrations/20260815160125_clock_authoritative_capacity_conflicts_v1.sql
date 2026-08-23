-- Pass 2: expose authoritative Clock capacity conflicts without changing
-- Production, Obligation/Release, or placement ownership.
--
-- clock_day_capacity_state_v1 already distinguishes:
--   * target overflow: warning
--   * maximum planned overflow: conflict
-- This migration preserves the existing warning payload for compatibility and
-- adds an explicit server-derived conflict channel at the day-plan/commit seam.

create or replace function atlas.enrich_worker_day_plan_clock_capacity_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_item jsonb;
  v_real_work jsonb := '[]'::jsonb;
  v_task_id uuid;
  v_duration integer;
  v_committed integer := 0;
  v_automatic integer := greatest(coalesce(nullif(p_plan->>'automaticPaidMinutes','')::integer, 0), 0);
  v_planned integer;
  v_target integer;
  v_capacity jsonb;
  v_warnings jsonb;
  v_conflicts jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    return p_plan;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'realWork', '[]'::jsonb))
  loop
    v_task_id := null;
    begin
      if nullif(v_item->>'taskId','') is not null then
        v_task_id := (v_item->>'taskId')::uuid;
      end if;
    exception when others then
      v_task_id := null;
    end;

    v_duration := greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer, 0), 0);

    if v_task_id is not null then
      select p.planned_duration_minutes
      into v_duration
      from atlas.worker_day_task_placements p
      where p.farm_id = p_farm_id
        and p.membership_id = p_membership_id
        and p.task_id = v_task_id
        and p.service_date = p_day
        and p.state = 'placed'
        and p.planned_duration_minutes is not null
      limit 1;

      if not found then
        v_duration := greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer, 0), 0);
      end if;
    end if;

    v_item := jsonb_set(v_item, '{expectedActiveMinutes}', to_jsonb(v_duration), true);
    v_real_work := v_real_work || jsonb_build_array(v_item);
    v_committed := v_committed + v_duration;
  end loop;

  v_planned := v_committed + v_automatic;
  v_capacity := atlas.clock_day_capacity_state_v1(p_farm_id, p_membership_id, v_planned);
  v_target := coalesce(nullif(v_capacity->>'paidTargetMinutes','')::integer, 420);

  -- Keep the legacy warnings array intact for current clients. Capacity warnings
  -- remain warnings even when the helper also classifies the day as a conflict.
  select coalesce(jsonb_agg(to_jsonb(code) order by code), '[]'::jsonb)
  into v_warnings
  from (
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(p_plan->'warnings', '[]'::jsonb)) j
    union
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(v_capacity->'warningCodes', '[]'::jsonb)) j
  ) warnings;

  -- Conflict truth is server-derived from the authoritative capacity helper.
  -- Never copy p_plan warnings (or commit input warningCodes) into this array.
  select coalesce(jsonb_agg(to_jsonb(code) order by code), '[]'::jsonb)
  into v_conflicts
  from (
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(v_capacity->'warningCodes', '[]'::jsonb)) j
    where coalesce((v_capacity->>'hasConflict')::boolean, false)
      and j.value #>> '{}' = 'day_capacity_maximum_exceeded'
  ) conflicts;

  return p_plan || jsonb_build_object(
    'realWork', v_real_work,
    'paidTargetMinutes', v_target,
    'committedPaidMinutes', v_committed,
    'automaticPaidMinutes', v_automatic,
    'remainingPaidMinutes', greatest(v_target - v_planned, 0),
    'clockCapacity', v_capacity,
    'warnings', v_warnings,
    'conflicts', v_conflicts
  );
end;
$function$;

comment on function atlas.enrich_worker_day_plan_clock_capacity_v1(uuid, uuid, date, jsonb) is
  'Enriches the worker day plan with authoritative Clock capacity. Target overflow remains a warning; maximum planned overflow is also exposed in conflicts. Conflict truth is derived server-side.';

create or replace function atlas.owner_commit_worker_clock_plan_api_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_changes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_result jsonb;
  v_plan jsonb;
begin
  v_result := atlas.owner_commit_worker_clock_plan_api_v1(p_farm_id,p_membership_id,p_day,p_changes);
  v_plan := atlas.owner_worker_day_plan_choreographed_api_v1(p_farm_id,p_membership_id,p_day);

  return v_result || jsonb_build_object(
    'contractVersion', 'owner_worker_clock_plan_commit_v2',
    'clockCapacity', coalesce(v_plan->'clockCapacity', '{}'::jsonb),
    'warnings', coalesce(v_plan->'warnings', '[]'::jsonb),
    'conflicts', coalesce(v_plan->'conflicts', '[]'::jsonb)
  );
end;
$function$;

comment on function atlas.owner_commit_worker_clock_plan_api_v2(uuid, uuid, date, jsonb) is
  'Commits Owner Clock changes and returns authoritative post-commit capacity warnings and conflicts. Client warningCodes remain audit/override metadata and cannot create or suppress conflicts.';

-- Preserve the live API boundary explicitly. The enrichment helper remains
-- internal; the Owner commit API is callable only by authenticated/server roles.
revoke all on function atlas.enrich_worker_day_plan_clock_capacity_v1(uuid, uuid, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.owner_commit_worker_clock_plan_api_v2(uuid, uuid, date, jsonb) from public, anon;
grant execute on function atlas.owner_commit_worker_clock_plan_api_v2(uuid, uuid, date, jsonb) to authenticated, service_role;
