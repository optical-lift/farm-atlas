-- The reusable equipment is the mower. Battery count is readiness information, not the resource name.
update atlas.resources
set label='Battery push mower',
    resource_type='equipment',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'battery_count',2,
      'working_set_semantics','two_batteries_used_together_as_one_working_set',
      'worker_readiness_detail','2 charged batteries required',
      'display_normalized_by','battery_push_mower_resource_display_v1'
    ),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and stable_key='battery_push_mower_battery_set';
