update atlas.tasks
set due_date = null,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'plant_part','rhizome',
      'operation_class_manual','divide_reestablish_belowground',
      'schedule_semantics','floating_eligibility',
      'legacy_due_date_retired_from','2026-07-19',
      'legacy_due_date_retired_on','2026-08-08',
      'legacy_due_date_retired_reason','Converted from a repeatedly moved calendar date to floating operation truth; future visibility belongs to eligibility windows rather than date rollover.',
      'planned_occurrence_date_role','historical_release_provenance'
    )
where id='6e44f4a6-a0f1-4061-b1c5-f63b1a233580'::uuid
  and status in ('open','blocked');
