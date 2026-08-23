insert into atlas.task_completion_impact_policies
  (action_family, expectation, acceptable_state_impacts, minimum_state_impacts, description)
values
  ('grow_room','contextual',array['crop_cycle','workflow_handoff','next_task','object_event','object_state'],1,'Grow-room actions should update a tray or crop stage when the work represents a biological transition.')
on conflict (action_family) do update set
  expectation=excluded.expectation,
  acceptable_state_impacts=excluded.acceptable_state_impacts,
  minimum_state_impacts=excluded.minimum_state_impacts,
  description=excluded.description,
  updated_at=now();
