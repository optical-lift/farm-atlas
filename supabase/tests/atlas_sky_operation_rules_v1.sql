begin;

do $proof$
declare
  v_farm_id uuid;
  v_task_id uuid;
  v_at timestamptz := '2026-08-08 18:00:00-05'::timestamptz;
  v_result jsonb;
begin
  select task.farm_id, task.id
  into v_farm_id, v_task_id
  from atlas.tasks task
  where task.status in ('open','blocked')
    and task.operation_class = 'divide_reestablish_belowground'
    and task.title = 'Divide and Replant Lilac Haven Irises into Drifts'
  limit 1;

  if v_task_id is null then
    raise exception 'Lilac Haven iris operation task was not found.';
  end if;

  if not atlas.sky_rule_matches_v1(
    '{"moon_sign_in":["taurus","virgo"],"moon_mode_in":["fixed"]}'::jsonb,
    '{"moonSign":"taurus","moonMode":"fixed","phaseState":"waxing","illuminationFraction":0.42}'::jsonb
  ) then
    raise exception 'Expected Taurus/fixed predicate to match.';
  end if;

  if atlas.sky_rule_matches_v1(
    '{"phase_state_in":["waning"]}'::jsonb,
    '{"moonSign":"taurus","moonMode":"fixed","phaseState":"waxing","illuminationFraction":0.42}'::jsonb
  ) then
    raise exception 'Expected waning predicate not to match waxing state.';
  end if;

  insert into atlas.sky_windows(
    farm_id,window_kind,value_key,starts_at,ends_at,timezone_name,frame,zodiac_basis,
    source_provider,source_version,calculation_version,value_payload,metadata
  ) values
  (v_farm_id,'moon_sign','taurus',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric','tropical_true_ecliptic_of_date','test','1','rollback_test','{}','{}'),
  (v_farm_id,'moon_mode','fixed',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric','tropical_true_ecliptic_of_date','test','1','rollback_test','{}','{}'),
  (v_farm_id,'moon_phase_half','waxing',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric',null,'test','1','rollback_test','{}','{}');

  insert into atlas.sky_operation_rules(
    farm_id,stable_key,operation_class,rule_version,status,enforcement_mode,predicate,
    fitness_when_match,fitness_when_no_match,evidence_class,priority,active
  ) values (
    v_farm_id,'rollback_iris_test','divide_reestablish_belowground',1,'approved','windowed',
    '{"moon_sign_in":["taurus"],"phase_state_in":["waxing"]}'::jsonb,
    'favored','unfavored','owner_operating_hypothesis',1,true
  );

  v_result := atlas.task_sky_fitness_v1(v_task_id,v_at);
  if v_result->>'fitness' <> 'favored' or (v_result->>'eligibleUnderSky')::boolean is not true then
    raise exception 'Expected iris task to be favored and eligible inside matching window: %', v_result;
  end if;

  delete from atlas.sky_windows where calculation_version='rollback_test' and farm_id=v_farm_id;
  insert into atlas.sky_windows(
    farm_id,window_kind,value_key,starts_at,ends_at,timezone_name,frame,zodiac_basis,
    source_provider,source_version,calculation_version,value_payload,metadata
  ) values
  (v_farm_id,'moon_sign','gemini',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric','tropical_true_ecliptic_of_date','test','1','rollback_test','{}','{}'),
  (v_farm_id,'moon_mode','common',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric','tropical_true_ecliptic_of_date','test','1','rollback_test','{}','{}'),
  (v_farm_id,'moon_phase_half','waxing',v_at-interval '1 hour',v_at+interval '1 hour','America/Chicago','geocentric',null,'test','1','rollback_test','{}','{}');

  v_result := atlas.task_sky_fitness_v1(v_task_id,v_at);
  if v_result->>'fitness' <> 'unfavored' or (v_result->>'eligibleUnderSky')::boolean is not false then
    raise exception 'Expected iris task to be unfavored and withheld outside matching sign window: %', v_result;
  end if;
end;
$proof$;

rollback;
