update atlas.crop_cycles cc
set lifecycle_status='archived',
    metadata=coalesce(cc.metadata,'{}'::jsonb) || jsonb_build_object(
      'lifecycle_reconciliation',jsonb_build_object(
        'source','reality_expression_continuity_repair_v1',
        'reason','terminal occupancy backfill state cannot remain lifecycle-active',
        'priorLifecycleStatus','active',
        'preservedCycleState',cc.cycle_state,
        'reconciledOn',(now() at time zone 'America/Chicago')::date
      )
    ),
    updated_at=now()
where cc.lifecycle_status='active'
  and cc.cycle_state in ('failed','abandoned','archived')
  and cc.metadata->>'source'='crop_occupancy_backfill_v1';