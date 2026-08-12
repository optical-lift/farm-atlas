begin;

update atlas.task_release_queue_items qi
set state='skipped',position=14,metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object('skipped_by','weed_projection_and_clear_crop_merge_v1','skipped_at',now(),'skipped_reason','Duplicate MG11 continuation; the active MG11 identity already owns the serial work.'),updated_at=now()
where qi.farm_id=(select id from atlas.farms where stable_key='elm_farm') and qi.queue_key='anna_weeding_rotation' and qi.position=13 and qi.planned_occurrence_id in (select id from atlas.planned_work_occurrences where title='Weed MG11' and state='planned');

update atlas.planned_work_occurrences p
set state='cancelled',metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','weed_projection_and_clear_crop_merge_v1','cancelledAt',now(),'cancelledReason','Duplicate MG11 queue continuation removed; current active MG11 remains canonical.'),updated_at=now()
where p.id in (select qi.planned_occurrence_id from atlas.task_release_queue_items qi where qi.farm_id=(select id from atlas.farms where stable_key='elm_farm') and qi.queue_key='anna_weeding_rotation' and qi.position=14 and qi.state='skipped') and p.title='Weed MG11';

update atlas.tasks t
set status='archived',due_date=null,action_key='weed',task_type='maintenance',work_lane='rhythm',commitment_kind='persistent',operation_class='remove_uproot',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('work_collection_key','weeding','operation_family','tend','operation_move','remove','removal_mode','clear_crop','display_action','Clear crop','display_subject','Field Row 9 beans','display_location','Field Row 9','execution_do','Clear the bean crop from Field Row 9.','execution_how',jsonb_build_array('Take the final usable bean harvest.','Remove the bean plants from the bed.','Leave the bed open for the pollenless sunflower succession.'),'execution_done_when','Field Row 9 is cleared and available for the pollenless sunflower succession.','work_lane','rhythm','commitment_kind','persistent','serial_queue_key','anna_weeding_rotation','serial_queue_state','queued','normalized_by','weed_projection_and_clear_crop_merge_v1','normalized_at',now()),updated_at=now()
where t.metadata->>'task_key'='fr9_clear_beans_for_pollenless_20260820' and t.status in ('open','blocked');

update atlas.planned_work_occurrences p
set title='Clear crop · Field Row 9 beans',planned_due_date=null,not_before_date=null,state='planned',released_task_id=null,work_lane='rhythm',commitment_kind='persistent',task_payload=coalesce(p.task_payload,'{}'::jsonb)||jsonb_build_object('title','Clear crop · Field Row 9 beans','task_type','maintenance','action_key','weed','work_lane','rhythm','commitment_kind','persistent'),metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('queueKey','anna_weeding_rotation','queueMode','clear_crop','queuedBy','weed_projection_and_clear_crop_merge_v1','queuedAt',now()),updated_at=now()
where p.id in (select (t.metadata->>'planned_occurrence_id')::uuid from atlas.tasks t where t.metadata->>'task_key'='fr9_clear_beans_for_pollenless_20260820');

update atlas.planned_work_occurrences p
set task_payload=jsonb_set(coalesce(p.task_payload,'{}'::jsonb),'{metadata}',coalesce(p.task_payload->'metadata','{}'::jsonb)||jsonb_build_object('task_key','fr9_clear_beans_for_pollenless_20260820','work_collection_key','weeding','operation_family','tend','operation_move','remove','removal_mode','clear_crop','display_action','Clear crop','display_subject','Field Row 9 beans','display_location','Field Row 9','execution_do','Clear the bean crop from Field Row 9.','execution_how',jsonb_build_array('Take the final usable bean harvest.','Remove the bean plants from the bed.','Leave the bed open for the pollenless sunflower succession.'),'execution_done_when','Field Row 9 is cleared and available for the pollenless sunflower succession.','serial_queue_key','anna_weeding_rotation','serial_queue_state','queued'),true),updated_at=now()
where p.id in (select (t.metadata->>'planned_occurrence_id')::uuid from atlas.tasks t where t.metadata->>'task_key'='fr9_clear_beans_for_pollenless_20260820');

insert into atlas.task_release_queue_items(id,farm_id,queue_key,task_id,maintenance_object_id,position,state,initial_batch,original_due_date,activated_at,completed_at,metadata,created_at,updated_at,planned_occurrence_id)
select gen_random_uuid(),t.farm_id,'anna_weeding_rotation',null,null,13,'queued',false,date '2026-08-20',null,null,jsonb_build_object('created_by','weed_projection_and_clear_crop_merge_v1','removal_mode','clear_crop','source_task_key','fr9_clear_beans_for_pollenless_20260820','projected_slot_only',true,'target_object_id',t.metadata->>'target_object_id'),now(),now(),(t.metadata->>'planned_occurrence_id')::uuid
from atlas.tasks t
where t.metadata->>'task_key'='fr9_clear_beans_for_pollenless_20260820' and not exists (select 1 from atlas.task_release_queue_items qi where qi.farm_id=t.farm_id and qi.queue_key='anna_weeding_rotation' and qi.planned_occurrence_id=(t.metadata->>'planned_occurrence_id')::uuid);

select atlas.sync_task_release_queue_summary_v1((select id from atlas.farms where stable_key='elm_farm'),'anna_weeding_rotation');

commit;
