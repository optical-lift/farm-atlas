revoke all on function atlas.worker_day_available_v1(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.worker_day_on_or_after_v1(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.next_worker_day_v1(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.worker_task_day_window_v1(text,text,jsonb) from public,anon,authenticated;
revoke all on function atlas.worker_task_order_v1(text,text,jsonb) from public,anon,authenticated;
revoke all on function atlas.owner_worker_day_plan_v1(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.jsonb_object_length(jsonb) from public,anon,authenticated;
revoke all on function atlas.owner_build_worker_day_schedule_v2(uuid,uuid,date,jsonb) from public,anon,authenticated;

grant execute on function atlas.worker_day_available_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.worker_day_on_or_after_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.next_worker_day_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.worker_task_day_window_v1(text,text,jsonb) to service_role;
grant execute on function atlas.worker_task_order_v1(text,text,jsonb) to service_role;
grant execute on function atlas.owner_worker_day_plan_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.jsonb_object_length(jsonb) to service_role;
grant execute on function atlas.owner_build_worker_day_schedule_v2(uuid,uuid,date,jsonb) to service_role;
