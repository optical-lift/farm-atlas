-- Prepare soil -> make soil blocks is one serial workflow. The second step
-- remains canonical but is not actionable until the first step is completed.
do $soil$
declare
  prepare_task atlas.tasks%rowtype;
  make_task atlas.tasks%rowtype;
  queue_key text:='anna_soil_block_1_5_sequence';
begin
  select * into prepare_task from atlas.tasks
  where metadata->>'task_key'='anna_20260804_prepare_soil_1_5_blocks' and status in ('open','blocked')
  order by created_at desc limit 1;
  select * into make_task from atlas.tasks
  where metadata->>'task_key'='anna_20260804_make_1_5_soil_blocks' and status in ('open','blocked')
  order by created_at desc limit 1;

  if prepare_task.id is not null and make_task.id is not null
     and prepare_task.planned_occurrence_id is not null and make_task.planned_occurrence_id is not null then
    delete from atlas.task_release_queue_items where farm_id=prepare_task.farm_id and queue_key=queue_key;

    insert into atlas.task_release_queue_items(
      farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,activated_at,metadata
    ) values
      (prepare_task.farm_id,queue_key,prepare_task.id,prepare_task.planned_occurrence_id,1,'active',false,prepare_task.due_date,now(),
       jsonb_build_object('policy','completion_gated_serial','work_shape','serial_workflow','source','canonical_work_shapes_v1')),
      (make_task.farm_id,queue_key,make_task.id,make_task.planned_occurrence_id,2,'queued',false,make_task.due_date,null,
       jsonb_build_object('policy','completion_gated_serial','work_shape','serial_workflow','source','canonical_work_shapes_v1',
         'release_timing','same_day','prerequisite_task_key','anna_20260804_prepare_soil_1_5_blocks'));

    update atlas.tasks
    set status='archived',completed_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'task_work_shape','serial_workflow_step','locked_by_queue',queue_key,
          'locked_after_task_key','anna_20260804_prepare_soil_1_5_blocks',
          'archived_reason','Locked until Prepare Soil for 1.5-inch Soil Blocks is completed.','locked_at',now()),updated_at=now()
    where id=make_task.id;

    update atlas.planned_work_occurrences
    set state='planned',released_task_id=null,released_at=null,gate_satisfied_at=null,
        metadata=(coalesce(metadata,'{}'::jsonb)-'releasedBy'-'releasedLane'-'releasedExecutionDate')||jsonb_build_object(
          'taskWorkShape','serial_workflow_step','lockedByQueue',queue_key,
          'lockedAfterTaskKey','anna_20260804_prepare_soil_1_5_blocks'),updated_at=now()
    where id=make_task.planned_occurrence_id;

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'task_work_shape','serial_workflow_step','unlocks_queue_key',queue_key,'unlocks_task_label','Make 1.5-inch Soil Blocks'),updated_at=now()
    where id=prepare_task.id;

    perform atlas.sync_task_release_queue_summary_v1(prepare_task.farm_id,queue_key);
  end if;
end;$soil$;