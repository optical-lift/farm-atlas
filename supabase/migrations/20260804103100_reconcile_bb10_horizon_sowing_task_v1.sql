-- Convert the old BB8-BB11 sowing card into the one remaining BB10 outcome.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_bb8_id uuid;
  v_bb9_id uuid;
  v_bb10_id uuid;
  v_bb10_cycle_id uuid;
  v_parent_task_id uuid;
  v_parent_occurrence_id uuid;
  v_child record;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id,user_id into v_owner_membership_id,v_owner_user_id
  from atlas.farm_memberships where farm_id=v_farm_id and worker_key='lex' and active limit 1;
  select id into v_bb8_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_8';
  select id into v_bb9_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_9';
  select id into v_bb10_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_10';
  select id into v_bb10_cycle_id from atlas.crop_cycles
  where farm_id=v_farm_id and object_id=v_bb10_id
    and crop_profile_id=(select id from atlas.crop_profiles where stable_key='sunflower_procut_horizon')
  order by created_at desc limit 1;

  select id,planned_occurrence_id into v_parent_task_id,v_parent_occurrence_id
  from atlas.tasks
  where farm_id=v_farm_id
    and metadata->>'task_key' in ('owner_20260802_sow_procut_horizon_bb8_bb11','owner_20260825_sow_procut_horizon_bb10')
    and status in ('open','blocked')
  order by case when metadata->>'task_key'='owner_20260802_sow_procut_horizon_bb8_bb11' then 0 else 1 end,created_at
  limit 1;

  if v_parent_task_id is null then
    raise exception 'Canonical Barn Bed sowing task not found.';
  end if;

  update atlas.tasks
  set title='Sow ProCut Horizon in BB10',due_date=date '2026-08-25',status='open',blocker_text=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'detail_lines'-'projection_detail_lines'-'display_detail'-'display_location'-'location_label')
        ||jsonb_build_object(
          'task_key','owner_20260825_sow_procut_horizon_bb10','display_action','Sow',
          'display_subject','ProCut Horizon sunflowers','display_detail','BB10','display_location','BB10',
          'location_label','BB10','collection_label','Barn Bed 10 ProCut Horizon',
          'expected_stems',162,'expected_stems_source','1 linked 18-foot bed × 3 rows × 4-inch spacing',
          'planned_sow_date','2026-08-25','readiness_blocked',true,
          'readiness_blocked_reason','BB10 requires three Bermuda-grass spray passes and a readiness confirmation before sowing.',
          'readiness_blocked_until','2026-08-25','projection_status','blocked_until_bed_ready',
          'owner_rescheduled_at',now(),'owner_rescheduled_to','2026-08-25',
          'owner_reschedule_reason','BB8 and BB9 were sown; BB10 remains after Bermuda-grass treatment; BB11 does not exist.'
        ),updated_at=now()
  where id=v_parent_task_id;

  delete from atlas.task_objects where task_id=v_parent_task_id and object_id<>v_bb10_id;
  insert into atlas.task_objects(task_id,object_id,role)
  select v_parent_task_id,v_bb10_id,'target'
  where not exists(select 1 from atlas.task_objects where task_id=v_parent_task_id and object_id=v_bb10_id);

  delete from atlas.task_crop_cycles where task_id=v_parent_task_id and crop_cycle_id<>v_bb10_cycle_id;
  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_parent_task_id,v_bb10_cycle_id,'creates','confirmed','owner_instruction',jsonb_build_object('source','bb10_bermuda_reconciliation_v1'))
  on conflict(task_id,crop_cycle_id,role) do update
  set confidence='confirmed',source='owner_instruction',metadata=atlas.task_crop_cycles.metadata||excluded.metadata;

  update atlas.planned_work_occurrences occurrence
  set title='Sow ProCut Horizon in BB10',planned_due_date=date '2026-08-25',not_before_date=date '2026-08-25',
      task_payload=coalesce(occurrence.task_payload,'{}'::jsonb)||jsonb_build_object(
        'title','Sow ProCut Horizon in BB10','due_date','2026-08-25',
        'metadata',coalesce(occurrence.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'task_key','owner_20260825_sow_procut_horizon_bb10','display_detail','BB10','display_location','BB10',
          'location_label','BB10','expected_stems',162,'readiness_blocked',true,
          'readiness_blocked_reason','BB10 requires three Bermuda-grass spray passes and a readiness confirmation before sowing.'
        )
      ),
      relation_payload=coalesce(occurrence.relation_payload,'{}'::jsonb)||jsonb_build_object(
        'task_objects',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'role',l.role,'object_id',l.object_id)),'[]'::jsonb) from atlas.task_objects l where l.task_id=v_parent_task_id),
        'task_crop_cycles',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'role',l.role,'source',l.source,'metadata',l.metadata,'confidence',l.confidence,'crop_cycle_id',l.crop_cycle_id)),'[]'::jsonb) from atlas.task_crop_cycles l where l.task_id=v_parent_task_id)
      ),updated_at=now()
  where occurrence.id=v_parent_occurrence_id;

  for v_child in
    select * from atlas.tasks
    where parent_task_id=v_parent_task_id
      and metadata->>'sowing_bed_object_id' in (v_bb8_id::text,v_bb9_id::text)
  loop
    update atlas.tasks
    set status='done',completed_at=coalesce(completed_at,now()),completed_by='owner',due_date=date '2026-08-03',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'checklist_status','done','completed_from_physical_truth',true,'actual_sow_date','2026-08-03',
          'actual_variety','ProCut Horizon','completion_source','marshall_text_20260804'
        ),updated_at=now()
    where id=v_child.id;

    insert into atlas.task_transitions(
      farm_id,task_id,transition,previous_status,next_status,previous_due_date,target_date,
      action_key,work_class,note,reason,idempotency_key,payload,created_by,
      actor_user_id,actor_membership_id,actor_role
    ) values(
      v_farm_id,v_child.id,'done',v_child.status,'done',v_child.due_date,date '2026-08-03',
      'sow',coalesce(v_child.work_class,'planting_sowing'),'ProCut Horizon was sown August 3.',
      'Physical sowing truth reported by Marshall.','owner:physical-truth:done:'||v_child.id::text||':2026-08-03',
      jsonb_build_object('actual_sow_date','2026-08-03','variety','ProCut Horizon'),
      'owner',v_owner_user_id,v_owner_membership_id,'owner'
    ) on conflict do nothing;

    insert into atlas.task_outcome_events(
      farm_id,task_id,outcome,lane_key,work_key,note,task_title,task_type,zone_id,due_date,priority,created_by,source,metadata
    )
    select v_farm_id,v_child.id,'done','sowing','procut_horizon',
      'Completed from Marshall''s physical sowing report.',v_child.title,v_child.task_type,v_child.zone_id,
      date '2026-08-03',v_child.priority,'owner','owner_instruction',
      jsonb_build_object('idempotencyKey','owner:physical-truth:outcome:'||v_child.id::text||':2026-08-03')
    where not exists(
      select 1 from atlas.task_outcome_events e where e.task_id=v_child.id
        and e.metadata->>'idempotencyKey'='owner:physical-truth:outcome:'||v_child.id::text||':2026-08-03'
    );

    update atlas.planned_work_occurrences
    set state='completed',gate_satisfied_at=coalesce(gate_satisfied_at,now()),updated_at=now()
    where id=v_child.planned_occurrence_id;
  end loop;

  update atlas.tasks
  set status='archived',due_date=null,parent_task_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'archived_at',now(),'archived_reason','Replaced by the canonical BB10 sowing task behind Bermuda-grass treatment.'
      ),updated_at=now()
  where parent_task_id=v_parent_task_id and metadata->>'sowing_bed_object_id'=v_bb10_id::text
    and status in ('open','blocked');

  update atlas.planned_work_occurrences occurrence
  set state='cancelled',released_task_id=null,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
        'cancelledAt',now(),'cancelledReason','Replaced by canonical BB10 sowing task after Bermuda treatment.'
      ),updated_at=now()
  where occurrence.id in(
    select task.planned_occurrence_id from atlas.tasks task
    where task.metadata->>'sowing_bed_object_id'=v_bb10_id::text
      and task.metadata->>'archived_reason'='Replaced by the canonical BB10 sowing task behind Bermuda-grass treatment.'
  );
end;
$migration$;

commit;
