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
    'owner_clock_plan_commit'::text
  ]));

create or replace function atlas.clock_day_capacity_state_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_planned_paid_minutes integer
)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_target integer := 420;
  v_maximum integer := 480;
  v_planned integer := greatest(coalesce(p_planned_paid_minutes, 0), 0);
  v_over_target integer;
  v_over_maximum integer;
  v_warning_codes jsonb := '[]'::jsonb;
begin
  select
    coalesce(mcs.regular_target_minutes, 420),
    coalesce(mcs.maximum_planned_minutes, 480)
  into v_target, v_maximum
  from atlas.member_capacity_settings mcs
  where mcs.farm_id = p_farm_id
    and mcs.membership_id = p_membership_id
    and mcs.active = true
  order by mcs.updated_at desc nulls last, mcs.created_at desc nulls last
  limit 1;

  v_target := coalesce(v_target, 420);
  v_maximum := greatest(coalesce(v_maximum, 480), v_target);
  v_over_target := greatest(v_planned - v_target, 0);
  v_over_maximum := greatest(v_planned - v_maximum, 0);

  if v_over_target > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_target_exceeded');
  end if;
  if v_over_maximum > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_maximum_exceeded');
  end if;

  return jsonb_build_object(
    'contractVersion', 'clock_day_capacity_v1',
    'plannedPaidMinutes', v_planned,
    'paidTargetMinutes', v_target,
    'maximumPlannedMinutes', v_maximum,
    'overTargetMinutes', v_over_target,
    'overMaximumMinutes', v_over_maximum,
    'status', case when v_over_maximum > 0 then 'conflict' when v_over_target > 0 then 'warning' else 'ok' end,
    'hasConflict', v_over_maximum > 0,
    'warningCodes', v_warning_codes
  );
end;
$function$;

revoke all on function atlas.clock_day_capacity_state_v1(uuid, uuid, integer) from public, anon, authenticated;

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

  select coalesce(jsonb_agg(to_jsonb(code) order by code), '[]'::jsonb)
  into v_warnings
  from (
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(p_plan->'warnings', '[]'::jsonb)) j
    union
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(v_capacity->'warningCodes', '[]'::jsonb)) j
  ) warnings;

  return p_plan || jsonb_build_object(
    'realWork', v_real_work,
    'paidTargetMinutes', v_target,
    'committedPaidMinutes', v_committed,
    'automaticPaidMinutes', v_automatic,
    'remainingPaidMinutes', greatest(v_target - v_planned, 0),
    'clockCapacity', v_capacity,
    'warnings', v_warnings
  );
end;
$function$;

revoke all on function atlas.enrich_worker_day_plan_clock_capacity_v1(uuid, uuid, date, jsonb) from public, anon, authenticated;

create or replace function atlas.owner_worker_day_plan_choreographed_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid()
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_plan := atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  return atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
end;
$function$;

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
    'warnings', coalesce(v_plan->'warnings', '[]'::jsonb)
  );
end;
$function$;

revoke all on function atlas.owner_commit_worker_clock_plan_api_v2(uuid, uuid, date, jsonb) from public, anon;
grant execute on function atlas.owner_commit_worker_clock_plan_api_v2(uuid, uuid, date, jsonb) to authenticated, service_role;
