create index if not exists task_transitions_outcome_event_idx
  on atlas.task_transitions (task_outcome_event_id)
  where task_outcome_event_id is not null;
