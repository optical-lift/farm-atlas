create index if not exists idx_day_plan_snapshots_organization
  on atlas.day_plan_snapshots (organization_id);

create index if not exists idx_walkway_cards_organization
  on atlas.walkway_cards (organization_id);
create index if not exists idx_walkway_cards_zone
  on atlas.walkway_cards (zone_id)
  where zone_id is not null;
create index if not exists idx_walkway_cards_observation_log
  on atlas.walkway_cards (observation_field_log_id)
  where observation_field_log_id is not null;
create index if not exists idx_walkway_cards_current_task
  on atlas.walkway_cards (current_task_id)
  where current_task_id is not null;
create index if not exists idx_walkway_cards_current_occurrence
  on atlas.walkway_cards (current_occurrence_id)
  where current_occurrence_id is not null;
