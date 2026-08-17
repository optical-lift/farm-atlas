create or replace function atlas.worker_day_shape_effective_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_timezone text:='America/Chicago';
  v_policy_count integer:=0;
  v_policy atlas.worker_day_shape_policies%rowtype;
  v_active_target integer:=0;
  v_configured_max integer:=0;
  v_expected_elapsed integer:=0;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_is_working_weekday boolean:=false;
begin
  if p_day is null then raise exception 'A service date is required.' using errcode='22023'; end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then raise exception 'Active worker membership required.' using errcode='P0002'; end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone from atlas.farms f where f.id=p_farm_id;

  select coalesce(mcs.regular_target_minutes,0),coalesce(mcs.maximum_planned_minutes,0),
         coalesce(nullif(mcs.metadata->>'elapsed_workday_minutes','')::integer,0)
  into v_active_target,v_configured_max,v_expected_elapsed
  from atlas.member_capacity_settings mcs
  where mcs.farm_id=p_farm_id and mcs.membership_id=p_membership_id and mcs.active=true
  order by mcs.updated_at desc nulls last,mcs.created_at desc nulls last limit 1;

  -- Policy existence is independent from whether the requested date is one
  -- of its working weekdays. A known off-day is not a missing anchor.
  select count(*)::integer into v_policy_count
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day);

  if v_policy_count=0 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','anchor_required','requiresOwnerDayShape',true,'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,'matchingPolicyCount',0
    );
  elsif v_policy_count>1 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','policy_conflict','requiresOwnerDayShape',true,'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,'matchingPolicyCount',v_policy_count
    );
  end if;

  select policy.* into v_policy
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day)
  order by policy.effective_from desc,policy.version desc,policy.created_at desc
  limit 1;

  v_is_working_weekday:=extract(dow from p_day)::smallint=any(v_policy.weekdays);

  if not v_is_working_weekday then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','non_working_day','requiresOwnerDayShape',false,'timezone',v_timezone,
      'matchingPolicyCount',1,'policyId',v_policy.id,'policyKey',v_policy.policy_key,
      'policyName',v_policy.policy_name,'policyVersion',v_policy.version,
      'weekdays',to_jsonb(v_policy.weekdays),'localStart',v_policy.local_start,'localEnd',v_policy.local_end,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,
      'effectiveFrom',v_policy.effective_from,'effectiveThrough',v_policy.effective_through,
      'metadata',v_policy.metadata
    );
  end if;

  v_starts_at:=(p_day::timestamp+v_policy.local_start) at time zone v_timezone;
  v_ends_at:=(p_day::timestamp+v_policy.local_end) at time zone v_timezone;

  return jsonb_build_object(
    'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
    'state','resolved','requiresOwnerDayShape',false,'timezone',v_timezone,'matchingPolicyCount',1,
    'policyId',v_policy.id,'policyKey',v_policy.policy_key,'policyName',v_policy.policy_name,
    'policyVersion',v_policy.version,'weekdays',to_jsonb(v_policy.weekdays),
    'localStart',v_policy.local_start,'localEnd',v_policy.local_end,
    'startsAt',v_starts_at,'endsAt',v_ends_at,
    'elapsedMinutes',(extract(epoch from (v_ends_at-v_starts_at))/60.0)::integer,
    'configuredActiveTargetMinutes',v_active_target,
    'configuredMaximumPlannedMinutes',v_configured_max,
    'expectedElapsedWorkdayMinutes',v_expected_elapsed,
    'effectiveFrom',v_policy.effective_from,'effectiveThrough',v_policy.effective_through,
    'metadata',v_policy.metadata
  );
end;
$$;