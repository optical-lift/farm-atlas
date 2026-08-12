begin;

update atlas.tasks t
set note=null,
    metadata=(coalesce(t.metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object(
      'execution_do','Paint the first purple coat on both exterior house doors.',
      'execution_how',jsonb_build_array(
        'Wipe both exterior doors.',
        'Tape the knobs and adjacent hardware.',
        'Apply the first purple coat to both exterior house doors.',
        'Keep the taped hardware clean.',
        'Leave the doors positioned to dry safely.',
        'Store the brushes in Ziplock bags between coats.'
      ),
      'execution_done_when','Both exterior house doors have an even first purple coat and are positioned to dry safely.',
      'operation_family','host',
      'operation_move','paint_finish',
      'normalized_by','aug19_paint_worker_execution_normalization_v1',
      'normalized_at',now()
    ),
    updated_at=now()
where t.id='c52997f0-855c-4e2a-81ff-62dec9284e4d';

update atlas.planned_work_occurrences p
set task_payload=jsonb_set(
      coalesce(p.task_payload,'{}'::jsonb),'{metadata}',
      coalesce(p.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'execution_do',t.metadata->>'execution_do',
        'execution_how',t.metadata->'execution_how',
        'execution_done_when',t.metadata->>'execution_done_when',
        'operation_family',t.metadata->>'operation_family',
        'operation_move',t.metadata->>'operation_move'
      ),true
    ),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','aug19_paint_worker_execution_normalization_v1','normalizedAt',now()),
    updated_at=now()
from atlas.tasks t
where p.id=t.planned_occurrence_id and t.id='c52997f0-855c-4e2a-81ff-62dec9284e4d';

commit;
