-- Atlas Farm Care Phase 1 — foreign-key index coverage

create index if not exists object_state_care_strategy_membership_idx
  on atlas.object_state(care_strategy_set_by_membership_id)
  where care_strategy_set_by_membership_id is not null;

create index if not exists care_observations_zone_idx
  on atlas.care_observations(zone_id)
  where zone_id is not null;

create index if not exists care_observations_membership_idx
  on atlas.care_observations(observed_by_membership_id)
  where observed_by_membership_id is not null;

create index if not exists care_observations_source_task_idx
  on atlas.care_observations(source_task_id)
  where source_task_id is not null;

create index if not exists care_observations_source_history_idx
  on atlas.care_observations(source_maintenance_history_id)
  where source_maintenance_history_id is not null;

create index if not exists care_state_history_zone_idx
  on atlas.care_state_history(zone_id)
  where zone_id is not null;

create index if not exists care_state_history_source_observation_idx
  on atlas.care_state_history(source_observation_id)
  where source_observation_id is not null;

create index if not exists care_state_history_source_history_idx
  on atlas.care_state_history(source_maintenance_history_id)
  where source_maintenance_history_id is not null;

create index if not exists care_state_history_source_task_idx
  on atlas.care_state_history(source_task_id)
  where source_task_id is not null;

create index if not exists care_state_history_actor_membership_idx
  on atlas.care_state_history(actor_membership_id)
  where actor_membership_id is not null;
