update atlas.rhythm_state state
set current_task_id=occurrence.released_task_id,
    updated_at=now()
from atlas.planned_work_occurrences occurrence
where state.current_occurrence_id=occurrence.id
  and occurrence.state='released'
  and occurrence.released_task_id is not null
  and state.current_task_id is distinct from occurrence.released_task_id;