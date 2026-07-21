revoke execute on function atlas.show_sowing_projection_details() from public, anon, authenticated;
revoke execute on function atlas.sync_completed_crop_cycle_milestone_v1() from public, anon, authenticated;
revoke execute on function atlas.sync_planned_crop_cycles_from_task_v1() from public, anon, authenticated;
revoke execute on function atlas.trg_reconcile_sowing_bed_subtasks_v1() from public, anon, authenticated;
revoke execute on function atlas.trg_sync_crop_cycle_registry_from_object_content() from public, anon, authenticated;
revoke execute on function atlas.trg_sync_task_crop_cycle_links_v1() from public, anon, authenticated;

grant execute on function atlas.show_sowing_projection_details() to service_role;
grant execute on function atlas.sync_completed_crop_cycle_milestone_v1() to service_role;
grant execute on function atlas.sync_planned_crop_cycles_from_task_v1() to service_role;
grant execute on function atlas.trg_reconcile_sowing_bed_subtasks_v1() to service_role;
grant execute on function atlas.trg_sync_crop_cycle_registry_from_object_content() to service_role;
grant execute on function atlas.trg_sync_task_crop_cycle_links_v1() to service_role;
