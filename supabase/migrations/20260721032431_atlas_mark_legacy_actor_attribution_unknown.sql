update atlas.field_logs fl
set metadata = coalesce(fl.metadata, '{}'::jsonb) || jsonb_build_object(
      'actor_attribution_status', 'migrated_unknown',
      'actor_attribution_reason', 'record predates canonical membership actor boundary'
    ),
    updated_at = now()
where fl.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and fl.actor_user_id is null
  and fl.actor_membership_id is null
  and not (coalesce(fl.metadata, '{}'::jsonb) ? 'actor_attribution_status');
