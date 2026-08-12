begin;

-- The basement task has no executable worker method recorded. Hold it out of Anna's packet until Owner defines the actual move.
update atlas.tasks t
set status='blocked',
    due_date=null,
    visibility_scope='system_internal',
    blocker_text='Owner definition required before this can return to the Farm Hand packet.',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'worker_packet_hold',true,
      'worker_packet_hold_reason','No execution method or completion state is recorded for Prepare Farm Work Area in Basement.',
      'owner_definition_required',true,
      'held_by','aug18_truthful_worker_packet_hold_v1',
      'held_at',now()
    ),
    updated_at=now()
where t.id='91d75c86-6a33-4a16-8a5a-346b844fce27'
  and t.status in ('open','blocked');

update atlas.planned_work_occurrences p
set planned_due_date=null,
    not_before_date=null,
    state='planned',
    released_task_id=null,
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      'workerPacketHold',true,
      'workerPacketHoldReason','Owner definition required before release.',
      'heldBy','aug18_truthful_worker_packet_hold_v1',
      'heldAt',now()
    ),
    updated_at=now()
where p.id='0440d25f-0649-4ace-84c3-74ae0ef3638a';

-- Spray work cannot be executable without the real product/method. Hold it rather than invent directions.
update atlas.tasks t
set status='blocked',
    due_date=null,
    visibility_scope='system_internal',
    blocker_text='Spray product and application method are not recorded. Owner method required before worker release.',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'worker_packet_hold',true,
      'worker_packet_hold_reason','Spray product and application method are not recorded.',
      'worker_method_required',true,
      'owner_definition_required',true,
      'held_by','aug18_truthful_worker_packet_hold_v1',
      'held_at',now()
    ),
    updated_at=now()
where t.id='53590d76-5e63-4c3a-9c58-724639f81067'
  and t.status in ('open','blocked');

update atlas.planned_work_occurrences p
set planned_due_date=null,
    not_before_date=null,
    state='planned',
    released_task_id=null,
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      'workerPacketHold',true,
      'workerPacketHoldReason','Spray product and application method must be recorded before release.',
      'heldBy','aug18_truthful_worker_packet_hold_v1',
      'heldAt',now()
    ),
    updated_at=now()
where p.id='654a0ffe-4777-40c0-a3dc-adbac9871b0a';

-- Iris clump 2 already has enough canonical operation truth to make the child instruction literal without inventing horticultural technique.
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'execution_do','Replant Front Iris Clump 2 in Lilac Haven.',
      'execution_how',jsonb_build_array(
        'Use the rhizome divisions from Front Iris Clump 2.',
        'Replant them in Lilac Haven as part of the iris drift.'
      ),
      'execution_done_when','The Front Iris Clump 2 rhizome divisions are replanted in the Lilac Haven iris drift.',
      'display_location','Lilac Haven Irises',
      'operation_family','establish',
      'operation_move','replant_division',
      'normalized_by','aug18_truthful_worker_packet_hold_v1',
      'normalized_at',now()
    ),
    updated_at=now()
where t.id='9f5638d2-3606-4a5a-aa24-e48553fb2858';

update atlas.planned_work_occurrences p
set task_payload=jsonb_set(
      coalesce(p.task_payload,'{}'::jsonb),'{metadata}',
      coalesce(p.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'execution_do',t.metadata->>'execution_do',
        'execution_how',t.metadata->'execution_how',
        'execution_done_when',t.metadata->>'execution_done_when',
        'display_location',t.metadata->>'display_location',
        'operation_family',t.metadata->>'operation_family',
        'operation_move',t.metadata->>'operation_move'
      ),true
    ),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','aug18_truthful_worker_packet_hold_v1','normalizedAt',now()),
    updated_at=now()
from atlas.tasks t
where p.id=t.planned_occurrence_id and t.id='9f5638d2-3606-4a5a-aa24-e48553fb2858';

commit;
