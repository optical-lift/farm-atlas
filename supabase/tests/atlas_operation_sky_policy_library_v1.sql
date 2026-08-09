begin;

do $$
declare
  v_total integer;
  v_windowed integer;
  v_preferred integer;
  v_informative integer;
  v_no_rule integer;
  v_bad_active integer;
begin
  select count(*) into v_total from atlas.operation_sky_policy_library;
  if v_total <> 17 then
    raise exception 'Expected 17 operation sky library rows, got %', v_total;
  end if;

  select count(*) into v_windowed from atlas.operation_sky_policy_library where governance_level='windowed';
  select count(*) into v_preferred from atlas.operation_sky_policy_library where governance_level='preferred';
  select count(*) into v_informative from atlas.operation_sky_policy_library where governance_level='informative';
  select count(*) into v_no_rule from atlas.operation_sky_policy_library where governance_level='no_rule';

  if v_windowed <> 1 or v_preferred <> 9 or v_informative <> 4 or v_no_rule <> 3 then
    raise exception 'Unexpected governance distribution: windowed %, preferred %, informative %, no_rule %',
      v_windowed, v_preferred, v_informative, v_no_rule;
  end if;

  if not exists (
    select 1 from atlas.operation_sky_policy_library
    where operation_class='divide_reestablish_belowground'
      and governance_level='windowed'
      and worker_withholding_supported=true
      and candidate_predicate @> '{"moon_mode_in":["common"]}'::jsonb
  ) then
    raise exception 'Division Windowed policy is missing or malformed';
  end if;

  select count(*) into v_bad_active
  from atlas.sky_operation_rules r
  join atlas.operation_sky_policy_library l on l.operation_class=r.operation_class
  where r.active
    and l.governance_level in ('no_rule','informative');

  if v_bad_active <> 0 then
    raise exception 'No-rule/informative operation classes must not have active runtime sky rules; found %', v_bad_active;
  end if;

  if exists (
    select 1 from atlas.sky_operation_rules
    where active and enforcement_mode='preferred'
      and coalesce((metadata->>'worker_withholding_authorized')::boolean,false)=true
  ) then
    raise exception 'Preferred rules may not authorize worker withholding';
  end if;
end $$;

rollback;
