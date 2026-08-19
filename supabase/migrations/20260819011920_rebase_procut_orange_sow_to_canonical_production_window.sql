update atlas.planned_work_occurrences o
set work_lane='required',
    commitment_kind='hard_date',
    source_kind='production_succession',
    preferred_start_date=date '2026-08-17',
    latest_lawful_date=date '2026-09-11',
    temporal_contract_source='owner_succession_projection_20260817',
    temporal_contract_updated_at=now(),
    task_payload=coalesce(o.task_payload,'{}'::jsonb)||jsonb_build_object(
      'work_lane','required',
      'commitment_kind','hard_date',
      'metadata',coalesce(o.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'latest_safe_sow_date','2026-09-11',
        'work_rhythm','Sunflower Succession',
        'crop_profile_stable_key','sunflower_procut_orange'
      )
    ),
    metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
      'productionWindowRebasedAt',now(),
      'productionWindowSource','owner_instruction_20260817',
      'latestSafeSowDate','2026-09-11'
    ),
    updated_at=now()
where o.id='6c49d2ad-0eba-4909-bcaf-950895288e13'::uuid;

update atlas.tasks t
set work_lane='required',
    commitment_kind='hard_date',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'work_lane','required',
      'commitment_kind','hard_date',
      'latest_safe_sow_date','2026-09-11',
      'temporal_contract_source','owner_succession_projection_20260817'
    ),
    updated_at=now()
where t.id='151fd9fc-9180-44c8-afc4-139ed93ff5bd'::uuid;