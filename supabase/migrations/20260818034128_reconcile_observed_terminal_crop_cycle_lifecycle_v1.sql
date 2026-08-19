update atlas.crop_cycles cc
set lifecycle_status='archived',
    metadata=coalesce(cc.metadata,'{}'::jsonb) || jsonb_build_object(
      'lifecycle_reconciliation',jsonb_build_object(
        'source','reality_expression_terminal_observation_repair_v1',
        'reason',case
          when cc.cycle_state='failed_germination' then 'observed germination failure terminates this crop cycle; any resow is a separate future cycle and is not inferred here'
          when cc.cycle_state='absent' then 'high-confidence field observation records this represented crop stand as absent'
          else 'observed terminal crop-cycle state cannot remain lifecycle-active'
        end,
        'priorLifecycleStatus','active',
        'preservedCycleState',cc.cycle_state,
        'futureResowDecisionInferred',false,
        'reconciledOn',(now() at time zone 'America/Chicago')::date
      )
    ),
    updated_at=now()
where cc.lifecycle_status='active'
  and (
    (
      cc.cycle_state='failed_germination'
      and cc.germination_checked_date is not null
      and cc.source_task_id is not null
      and cc.metadata->>'source' in ('owner_report','owner_photo_audit')
    )
    or
    (
      cc.cycle_state='absent'
      and cc.metadata->>'source'='field_rows_photo_truth_pass_20260712'
      and cc.metadata->>'stand_quality'='failed_or_absent'
      and cc.metadata->>'registry_confidence'='high'
      and exists (
        select 1
        from atlas.crop_occupancy_evidence e
        where e.crop_cycle_id=cc.id
          and e.evidence_role='observation'
          and e.confidence='high'
          and e.metadata->>'stage'='absent'
      )
    )
  );