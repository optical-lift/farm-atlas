begin;

do $$
declare
  v_iris uuid;
  v_timed uuid;
  v_policy jsonb;
  v_rule record;
begin
  select id into v_iris
  from atlas.tasks
  where metadata->>'task_key'='anna_20260716_divide_lilac_haven_irises_into_drifts'
  limit 1;

  if v_iris is null then raise exception 'iris task missing'; end if;

  v_policy := atlas.task_sky_deferral_policy_v1(v_iris,now());
  if coalesce((v_policy->>'canSkyWithhold')::boolean,false) is not true then
    raise exception 'iris should be long-horizon sky-deferrable: %',v_policy;
  end if;
  if (v_policy->>'maxDeferralDays')::integer <> 30 then
    raise exception 'iris safe deferral horizon should be 30 days: %',v_policy;
  end if;

  select id into v_timed
  from atlas.tasks
  where farm_id=(select farm_id from atlas.tasks where id=v_iris)
    and status in ('open','blocked')
    and due_date is not null
    and task_type in ('pot_up','transplanting','succession_sowing','sowing')
  order by due_date
  limit 1;

  if v_timed is null then raise exception 'timed biological task fixture missing'; end if;
  v_policy := atlas.task_sky_deferral_policy_v1(v_timed,now());
  if coalesce((v_policy->>'canSkyWithhold')::boolean,false) is true then
    raise exception 'dated biological work must never be sky-withheld: %',v_policy;
  end if;
  if v_policy->>'reason' <> 'dated_or_biologically_timed' then
    raise exception 'expected dated/biological protection reason: %',v_policy;
  end if;

  select stable_key,enforcement_mode,evidence_class,active,predicate
  into v_rule
  from atlas.sky_operation_rules
  where farm_id=(select farm_id from atlas.tasks where id=v_iris)
    and operation_class='divide_reestablish_belowground'
    and active
    and status='approved'
  order by priority,rule_version desc
  limit 1;

  if v_rule.stable_key <> 'elm_divide_reestablish_common_mode_window_v1' then
    raise exception 'wrong active iris operation rule: %',v_rule.stable_key;
  end if;
  if v_rule.enforcement_mode <> 'windowed' then
    raise exception 'deferrable iris operation must now be Windowed';
  end if;
  if v_rule.predicate <> '{"moon_mode_in":["common"]}'::jsonb then
    raise exception 'unexpected iris predicate: %',v_rule.predicate;
  end if;
end $$;

rollback;
