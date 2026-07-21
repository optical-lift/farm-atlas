revoke execute on function atlas.apply_sowing_projections() from anon, authenticated;
revoke execute on function atlas.collapse_new_germination_duplicate_v1() from anon, authenticated;
revoke execute on function atlas.create_delayed_followup_task() from anon, authenticated;
revoke execute on function atlas.create_germination_check_after_sowing_done() from anon, authenticated;
revoke execute on function atlas.enforce_no_sunday_task_due_date() from anon, authenticated;
revoke execute on function atlas.enforce_weeding_21_day_cooldown() from anon, authenticated;

grant execute on function atlas.apply_sowing_projections() to service_role;
grant execute on function atlas.collapse_new_germination_duplicate_v1() to service_role;
grant execute on function atlas.create_delayed_followup_task() to service_role;
grant execute on function atlas.create_germination_check_after_sowing_done() to service_role;
grant execute on function atlas.enforce_no_sunday_task_due_date() to service_role;
grant execute on function atlas.enforce_weeding_21_day_cooldown() to service_role;
