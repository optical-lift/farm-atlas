update atlas.work_definitions
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'work_order_anchor','top',
      'opening_routine',true,
      'clock_trait_source','owner_clock_choreography_20260820'
    ),
    updated_at=now()
where id='3199c7cc-d4d4-4838-9de2-a200a92a4615'::uuid
  and farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;

update atlas.planned_work_occurrences
set task_payload = jsonb_set(
      coalesce(task_payload,'{}'::jsonb),
      '{metadata}',
      coalesce(task_payload->'metadata','{}'::jsonb) || jsonb_build_object(
        'work_order_anchor','top',
        'opening_routine',true,
        'clock_trait_source','owner_clock_choreography_20260820'
      ),
      true
    ),
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'clockOpeningRoutine',true,
      'clockTraitSource','owner_clock_choreography_20260820'
    ),
    updated_at=now()
where work_definition_id='3199c7cc-d4d4-4838-9de2-a200a92a4615'::uuid
  and farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and state in ('planned','eligible','released')
  and planned_due_date>=date '2026-08-20';

update atlas.tasks
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'work_order_anchor','top',
      'opening_routine',true,
      'clock_trait_source','owner_clock_choreography_20260820'
    ),
    updated_at=now()
where id='b8ce42aa-387f-4f8c-8ce9-cc5384efbdae'::uuid
  and farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and status='open';
