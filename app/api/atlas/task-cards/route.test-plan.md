# Task-card ID hardening checks

- `GET /api/atlas/task-cards?taskId=3dad22c5` returns HTTP 400 without querying the UUID column.
- A valid task UUID continues to filter `v_task_cards` normally.
- Requests without `taskId` continue to return the standard task-card collection.
