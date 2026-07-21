revoke execute on function atlas.enrich_crop_cycle_milestone_task_profile_v1() from anon, authenticated;
revoke execute on function atlas.guard_single_active_weeding_task_from_link() from anon, authenticated;
revoke execute on function atlas.guard_single_active_weeding_task_from_status() from anon, authenticated;
revoke execute on function atlas.normalize_child_checklist_task_status() from anon, authenticated;
revoke execute on function atlas.normalize_germination_next_stage_task() from anon, authenticated;
revoke execute on function atlas.prevent_completed_crop_milestone_reopen_v1() from anon, authenticated;

grant execute on function atlas.enrich_crop_cycle_milestone_task_profile_v1() to service_role;
grant execute on function atlas.guard_single_active_weeding_task_from_link() to service_role;
grant execute on function atlas.guard_single_active_weeding_task_from_status() to service_role;
grant execute on function atlas.normalize_child_checklist_task_status() to service_role;
grant execute on function atlas.normalize_germination_next_stage_task() to service_role;
grant execute on function atlas.prevent_completed_crop_milestone_reopen_v1() to service_role;
