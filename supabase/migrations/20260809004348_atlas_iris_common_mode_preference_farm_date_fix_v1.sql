update atlas.sky_operation_rules r
set valid_from = (
      now() at time zone coalesce(
        nullif((select f.metadata->>'timezone' from atlas.farms f where f.id=r.farm_id),''),
        'America/Chicago'
      )
    )::date,
    updated_at = now()
where r.stable_key='elm_divide_reestablish_common_mode_preference_v1'
  and r.rule_version=1;
