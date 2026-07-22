-- These SECURITY DEFINER functions are trigger/cron/internal execution paths,
-- not public Data API endpoints.
revoke all on function atlas.install_task_release_gate_v1()
  from public,anon,authenticated;
revoke all on function atlas.validate_active_task_release_v1()
  from public,anon,authenticated;
revoke all on function atlas.finalize_task_release_v1()
  from public,anon,authenticated;
revoke all on function atlas.capture_deferred_task_v1()
  from public,anon,authenticated;
revoke all on function atlas.attach_released_task_to_source_v1(uuid,uuid)
  from public,anon,authenticated;
revoke all on function atlas.release_after_task_terminal_v1()
  from public,anon,authenticated;
revoke all on function atlas.validate_workflow_handoff_mode_v1()
  from public,anon,authenticated;
revoke all on function atlas.apply_workflow_event_v1(uuid)
  from public,anon,authenticated;
revoke all on function atlas.sync_task_release_queue_summary_v1(uuid,text)
  from public,anon,authenticated;
revoke all on function atlas.release_next_task_in_queue_v1(uuid,text,date)
  from public,anon,authenticated;
revoke all on function atlas.refresh_weeding_collection_tasks(date,integer)
  from public,anon,authenticated;
