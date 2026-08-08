begin;

do $proof$
declare
  v_task_id uuid;
  v_farm_id uuid;
  v_anna_membership_id uuid;
  v_owner_user_id uuid;
  v_today date;
  v_timezone text;
  v_rule_id uuid;
  v_state text;
  v_reason text;
  v_sky_withheld boolean;
  v_plan jsonb;
begin
  select task.id, task.farm_id, task.assigned_membership_id
  into v_task_id, v_farm_id, v_anna_membership_id
  from atlas.tasks task
  where task.status = 'open'
    and task.operation_class = 'divide_reestablish_belowground'
    and task.title ilike '%iris%'
  order by task.created_at
  limit 1;

  if v_task_id is null or v_farm_id is null or v_anna_membership_id is null then
    raise exception 'Pass 3 proof requires the active iris-division task assigned to a farm hand.';
  end if;

  select coalesce(nullif(farm.metadata ->> 'timezone', ''), 'America/Chicago')
  into v_timezone
  from atlas.farms farm
  where farm.id = v_farm_id;

  v_today := (now() at time zone v_timezone)::date;

  select membership.user_id
  into v_owner_user_id
  from atlas.farm_memberships membership
  where membership.farm_id = v_farm_id
    and membership.role = 'owner'
    and membership.active
  order by membership.created_at
  limit 1;

  insert into atlas.sky_state_samples (
    farm_id, service_date, sampled_at, timezone_name, frame, zodiac_basis,
    moon_longitude_deg, sun_longitude_deg, moon_sign, moon_sign_mode,
    phase_angle_deg, illumination_fraction, phase_state,
    source_provider, source_version, calculation_version, metadata
  ) values (
    v_farm_id, v_today, now(), v_timezone, 'geocentric', 'tropical_true_ecliptic_of_date',
    75, 140, 'gemini', 'common', 220, 0.35, 'waning',
    'pass3_regression', '1', 'pass3_regression_v1',
    jsonb_build_object('interpretation_prohibited', true)
  );

  insert into atlas.sky_windows (
    farm_id, window_kind, value_key, starts_at, ends_at, timezone_name,
    frame, zodiac_basis, source_provider, source_version, calculation_version,
    value_payload, metadata
  ) values
  (v_farm_id, 'moon_sign', 'gemini', now() - interval '1 day', now() + interval '1 day', v_timezone,
    'geocentric', 'tropical_true_ecliptic_of_date', 'pass3_regression', '1', 'pass3_regression_v1',
    jsonb_build_object('sign_index', 2, 'mode', 'common'), jsonb_build_object('interpretation_prohibited', true)),
  (v_farm_id, 'moon_mode', 'common', now() - interval '1 day', now() + interval '1 day', v_timezone,
    'geocentric', 'tropical_true_ecliptic_of_date', 'pass3_regression', '1', 'pass3_regression_v1',
    jsonb_build_object('moon_sign', 'gemini'), jsonb_build_object('interpretation_prohibited', true)),
  (v_farm_id, 'moon_phase_half', 'waning', now() - interval '10 days', now() + interval '10 days', v_timezone,
    'geocentric', null, 'pass3_regression', '1', 'pass3_regression_v1',
    jsonb_build_object('phase_state', 'waning'), jsonb_build_object('interpretation_prohibited', true));

  insert into atlas.sky_operation_rules (
    farm_id, stable_key, operation_class, rule_version, status, enforcement_mode,
    predicate, fitness_when_match, fitness_when_no_match, evidence_class,
    source_summary, priority, active
  ) values (
    v_farm_id, 'pass3_regression_rule', 'divide_reestablish_belowground', 1,
    'approved', 'windowed', jsonb_build_object('moon_sign_in', jsonb_build_array('taurus')),
    'favored', 'unfavored', 'owner_preference', 'Rollback-only Pass 3 regression rule.', 1, true
  ) returning id into v_rule_id;

  select row.presentation_state, row.presentation_reason,
         coalesce((row.task_card -> 'sky_timing' ->> 'withheldUnderSky')::boolean, false)
  into v_state, v_reason, v_sky_withheld
  from atlas.presented_work_rows_v1(v_farm_id, v_anna_membership_id, v_today) row
  where row.task_id = v_task_id;

  if v_state <> 'held' or v_reason <> 'awaiting_favored_sky_window' or not v_sky_withheld then
    raise exception 'Unfavored window must hold the iris task without presenting it; got state %, reason %, sky_withheld %.', v_state, v_reason, v_sky_withheld;
  end if;

  update atlas.sky_operation_rules
  set predicate = jsonb_build_object('moon_sign_in', jsonb_build_array('gemini'))
  where id = v_rule_id;

  select row.presentation_state, row.presentation_reason,
         coalesce((row.task_card -> 'sky_timing' ->> 'withheldUnderSky')::boolean, false)
  into v_state, v_reason, v_sky_withheld
  from atlas.presented_work_rows_v1(v_farm_id, v_anna_membership_id, v_today) row
  where row.task_id = v_task_id;

  if v_state = 'held' and v_reason = 'awaiting_favored_sky_window' then
    raise exception 'Favored window must return the same iris task to normal Body Budget selection.';
  end if;
  if v_sky_withheld then
    raise exception 'Favored window still reports sky withholding.';
  end if;

  update atlas.sky_operation_rules
  set predicate = jsonb_build_object('moon_sign_in', jsonb_build_array('taurus'))
  where id = v_rule_id;

  if v_owner_user_id is null then
    raise exception 'Pass 3 proof requires an active farm owner.';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);

  v_plan := atlas.prepare_living_day_plan_v1(
    v_farm_id,
    v_anna_membership_id,
    v_today,
    array[v_task_id],
    array[v_task_id],
    array[v_task_id]
  );

  if not ((v_plan -> 'withheldFlexibleTaskIds') ? v_task_id::text) then
    raise exception 'Living Day must record the iris task in withheldFlexibleTaskIds.';
  end if;
  if (v_plan -> 'plannedTaskIds') ? v_task_id::text then
    raise exception 'Sky-withheld iris task must not remain in plannedTaskIds.';
  end if;
  if (v_plan -> 'carriedTaskIds') ? v_task_id::text then
    raise exception 'Sky-withheld iris task must not become carryover.';
  end if;
  if coalesce((v_plan ->> 'denominator')::integer, -1) <> 0 then
    raise exception 'Withheld-only test plan must have denominator 0; got %.', v_plan ->> 'denominator';
  end if;

  if exists (
    select 1 from atlas.tasks task
    where task.id = v_task_id
      and (task.status <> 'open' or task.due_date is not null or task.commitment_kind <> 'floating')
  ) then
    raise exception 'Sky presentation must not mutate the underlying iris task status, due date, or commitment kind.';
  end if;
end;
$proof$;

rollback;
