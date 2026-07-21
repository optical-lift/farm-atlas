revoke execute on function atlas.get_object_operational_timeline_v1(text,text,integer,integer) from anon, authenticated;
revoke execute on function atlas.recalculate_weeding_priorities(text,date) from anon, authenticated;
revoke execute on function atlas.reconcile_active_weeding_tasks_for_object(uuid) from anon, authenticated;
revoke execute on function atlas.reconcile_sowing_bed_subtasks_v1(uuid) from anon, authenticated;
revoke execute on function atlas.record_crop_observation_v1(text,text,uuid,text,date,text,numeric,text,jsonb,text) from anon, authenticated;
revoke execute on function atlas.sync_crop_cycle_registry_v1(uuid,uuid) from anon, authenticated;
revoke execute on function atlas.sync_task_crop_cycle_links_v1(uuid) from anon, authenticated;

grant execute on function atlas.get_object_operational_timeline_v1(text,text,integer,integer) to service_role;
grant execute on function atlas.recalculate_weeding_priorities(text,date) to service_role;
grant execute on function atlas.reconcile_active_weeding_tasks_for_object(uuid) to service_role;
grant execute on function atlas.reconcile_sowing_bed_subtasks_v1(uuid) to service_role;
grant execute on function atlas.record_crop_observation_v1(text,text,uuid,text,date,text,numeric,text,jsonb,text) to service_role;
grant execute on function atlas.sync_crop_cycle_registry_v1(uuid,uuid) to service_role;
grant execute on function atlas.sync_task_crop_cycle_links_v1(uuid) to service_role;
