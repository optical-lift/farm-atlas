begin;

-- Object Work was an empty parallel work-authoring system. Atlas now uses canonical
-- tasks, Task Move requirements, checklists, Trail, and task results instead.
-- Keep atlas.object_workbench_v1 / atlas.v_object_workbench: despite the old name,
-- those are canonical object read surfaces and do not depend on these tables.

-- Lock/drop in the same order as the live task-release path: tasks first, then
-- planned occurrences. This avoids crossing the trigger locks used by task writes.
drop trigger if exists trg_sync_object_work_from_task_status_v1 on atlas.tasks;
drop trigger if exists trg_sync_object_work_release_v1 on atlas.planned_work_occurrences;

-- Remove the retired callable surface from Atlas's authenticated RPC inventory,
-- but preserve the canonical object_workbench_v1 reader.
delete from atlas.authenticated_rpc_registry
where signature ilike 'atlas.%object_work%'
  and signature not ilike 'atlas.object_workbench_v1(%';

drop function if exists atlas.cancel_object_work_plan_v1(uuid, text);
drop function if exists atlas.create_object_work_v1(uuid, text, text, text, text, text, text, text, uuid, date, text, text, uuid[], text[], text);
drop function if exists atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text);
drop function if exists atlas.create_object_work_v3(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text);
drop function if exists atlas.object_work_action_contract_v1(text);
drop function if exists atlas.object_work_context_v1(uuid, text);
drop function if exists atlas.object_work_context_v2(uuid, text, uuid, date);
drop function if exists atlas.object_work_for_task_v1(uuid);
drop function if exists atlas.object_work_item_json_v1(uuid);
drop function if exists atlas.record_object_work_truth_v1(uuid, text, uuid);
drop function if exists atlas.set_object_work_step_v1(uuid, boolean);
drop function if exists atlas.sync_object_work_from_task_status_v1();
drop function if exists atlas.sync_object_work_release_v1();

alter table atlas.object_state
  drop constraint if exists object_state_operational_truth_work_item_id_fkey;
alter table atlas.object_state
  drop column if exists operational_truth_work_item_id;

drop table if exists atlas.object_work_crop_cycles;
drop table if exists atlas.object_work_steps;
drop table if exists atlas.object_work_items;

commit;
