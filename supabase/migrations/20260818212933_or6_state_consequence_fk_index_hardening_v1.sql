create index if not exists state_consequence_events_farm_id_idx
  on atlas.state_consequence_events(farm_id);

create index if not exists state_consequence_events_instance_id_idx
  on atlas.state_consequence_events(instance_id);

create index if not exists state_consequence_events_policy_id_idx
  on atlas.state_consequence_events(policy_id);

create index if not exists state_consequence_policies_farm_id_idx
  on atlas.state_consequence_policies(farm_id);