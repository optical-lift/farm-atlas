revoke execute on function atlas.enrich_crop_cycle_milestone_task_profile_v1() from public;
revoke execute on function atlas.guard_single_active_weeding_task_from_link() from public;
revoke execute on function atlas.guard_single_active_weeding_task_from_status() from public;
revoke execute on function atlas.normalize_child_checklist_task_status() from public;
revoke execute on function atlas.normalize_germination_next_stage_task() from public;
revoke execute on function atlas.prevent_completed_crop_milestone_reopen_v1() from public;
alter default privileges in schema atlas revoke execute on functions from public;
