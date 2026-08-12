begin;

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'execution_do','Repair the Curve Garden Arch 3 beds and the small Follow Me Arch 2 right bed.',
      'execution_how',jsonb_build_array(
        'Square, fasten, and stabilize the two 40-inch raised beds at Curve Garden Arch 3.',
        'Repair and stabilize the smaller 3 ft × 3 ft Follow Me Arch 2 right bed.',
        'Leave all three frames structurally stable and ready to fill.',
        'Do not mark the Curve Arch itself installed unless it is actually installed.'
      ),
      'execution_done_when','All three raised-bed frames are square, fastened, stable, and ready to fill.',
      'operation_family','build','operation_move','repair',
      'normalized_by','aug17_worker_execution_normalization_v1','normalized_at',now()
    ),updated_at=now()
where t.id='d256f453-c5fc-4562-8c9b-ab3fc5ee22e2';

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'execution_do','Reset Entry Billboard Beds 1–6 for the fall lettuce and spinach starts.',
      'execution_how',jsonb_build_array(
        'Clear dead sprayed biomass from EB1–EB6 and their walkways.',
        'Remove excess composted mulch and loose decomposed material while preserving usable soil.',
        'Move usable excess material to the repaired Curve Garden Arch 3 beds and the smaller Follow Me Arch 2 right bed.',
        'Do not return the removed excess material to EB1–EB6.',
        'Reshape and level EB1–EB6 and clear the walkways.'
      ),
      'execution_done_when','EB1–EB6 are level, clear, and planting-ready for the fall lettuce and spinach starts.',
      'operation_family','establish','operation_move','prepare_bed',
      'normalized_by','aug17_worker_execution_normalization_v1','normalized_at',now()
    ),updated_at=now()
where t.id='a6817742-babf-426c-88fd-545695392016';

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'execution_do',case when t.id='dec62434-58f9-4322-a521-a4141f715c6e' then 'Transplant the healthy fall lettuce starts into planting-ready space in Entry Billboard Beds 1–6.' else 'Transplant the healthy fall spinach starts into planting-ready space in Entry Billboard Beds 1–6.' end,
      'execution_how',jsonb_build_array(
        'Wait until the EB1–EB6 reset is complete.',
        'Use the healthy starts that are hardening off outside.',
        'Allocate the starts across the planting-ready space at transplant time; do not invent a bed-by-bed split in advance.',
        'Transplant during the coolest workable morning or evening.',
        'Firm the roots and water every start in thoroughly.'
      ),
      'execution_done_when',case when t.id='dec62434-58f9-4322-a521-a4141f715c6e' then 'The healthy fall lettuce starts are transplanted into the available EB1–EB6 planting space and watered in.' else 'The healthy fall spinach starts are transplanted into the available EB1–EB6 planting space and watered in.' end,
      'operation_family','establish','operation_move','transplant',
      'normalized_by','aug17_worker_execution_normalization_v1','normalized_at',now()
    ),updated_at=now()
where t.id in ('dec62434-58f9-4322-a521-a4141f715c6e','da88426f-a036-44f5-904e-1a1a61c914d5');

update atlas.planned_work_occurrences p
set task_payload=jsonb_set(
      coalesce(p.task_payload,'{}'::jsonb),'{metadata}',
      coalesce(p.task_payload->'metadata','{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
        'execution_do',t.metadata->>'execution_do','execution_how',t.metadata->'execution_how','execution_done_when',t.metadata->>'execution_done_when','operation_family',t.metadata->>'operation_family','operation_move',t.metadata->>'operation_move'
      )),true
    ),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','aug17_worker_execution_normalization_v1','normalizedAt',now()),updated_at=now()
from atlas.tasks t
where p.id=t.planned_occurrence_id
  and t.id in ('d256f453-c5fc-4562-8c9b-ab3fc5ee22e2','a6817742-babf-426c-88fd-545695392016','dec62434-58f9-4322-a521-a4141f715c6e','da88426f-a036-44f5-904e-1a1a61c914d5');

commit;
