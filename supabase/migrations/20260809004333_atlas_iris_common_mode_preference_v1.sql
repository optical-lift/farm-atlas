-- Promote only the historically supported operation-mode inference for iris division.
-- This is deliberately Preferred, not Windowed: Noel supports common/bicorporeal
-- mode as transition/repetition/second-phase grammar, but does not establish a
-- gardening-specific lunar prescription or divine appointment for iris division.

update atlas.sky_operation_rules
set source_summary = 'Strict automatic withholding remains intentionally unapproved. Noel now supports a narrower historical operation-mode inference: common/bicorporeal signs are used for transition, repetition, duplication, return, second-phase participation, and non-final settlement. That structure resembles the compound farm operation divide + re-establish, but no source recovered so far establishes common-sign Moon timing as an agronomic rule for iris/rhizome division. Therefore this draft may not govern worker eligibility.',
    source_refs = jsonb_build_array(
      jsonb_build_object('noel_object_type','term','noel_object_id','zodiac_common_mode','claim','common/bicorporeal mode = transition, repetition, second phase, non-final settlement'),
      jsonb_build_object('noel_object_type','term','noel_object_id','operation_fitness','claim','readability or timing information does not itself authorize intervention'),
      jsonb_build_object('noel_object_type','trail','noel_object_id','3','claim','Historical Celestial Operation-Readiness Architecture; gardening-specific lunar mapping remains unproved')
    ),
    owner_note = 'Keep this strict Windowed rule inactive until the Owner explicitly adopts a stronger operating hypothesis or direct agricultural evidence is recovered. The active v1 preference is intentionally non-blocking.',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'predicate_status','strict_window_unresolved',
      'activation_blocked_by_research_gap',true,
      'narrower_preference_promoted_as','elm_divide_reestablish_common_mode_preference_v1'
    ),
    updated_at = now()
where stable_key='elm_iris_division_window_v1';

insert into atlas.sky_operation_rules(
  farm_id,
  stable_key,
  operation_class,
  rule_version,
  status,
  enforcement_mode,
  predicate,
  fitness_when_match,
  fitness_when_no_match,
  evidence_class,
  source_summary,
  source_refs,
  priority,
  active,
  valid_from,
  valid_until,
  owner_note,
  metadata
)
select
  f.id,
  'elm_divide_reestablish_common_mode_preference_v1',
  'divide_reestablish_belowground',
  1,
  'approved',
  'preferred',
  '{"moon_mode_in":["common"]}'::jsonb,
  'favored',
  'neutral',
  'working_reconstruction',
  'Noel supports common/bicorporeal mode as an operational grammar for transition, repetition, duplication, return, second-phase participation, and non-final settlement. Divide + re-establish is itself a compound transition operation: one established clump is divided and the resulting material must enter a second establishment phase before the job is complete. This is a structural historical analogy, not a recovered gardening rule, agronomic efficacy claim, celestial causation claim, or divine appointment. It is therefore promoted only as a non-blocking preference.',
  jsonb_build_array(
    jsonb_build_object('noel_object_type','term','noel_object_id','zodiac_common_mode','confidence','historical_working'),
    jsonb_build_object('noel_object_type','term','noel_object_id','operation_fitness','confidence','high_working'),
    jsonb_build_object('noel_object_type','trail','noel_object_id','3','evidence','Ramesey; Bonatti/Sahl; Dorothean common/double-bodied operation grammar')
  ),
  20,
  true,
  current_date,
  null,
  'Preferred only. Common-mode timing may raise this operation inside otherwise viable farm work, but may not hide it. A future Windowed promotion requires explicit Owner adoption or stronger direct evidence.',
  jsonb_build_object(
    'promotion_scope','operation_mode_preference_only',
    'worker_withholding_authorized',false,
    'agricultural_lunar_rule_established',false,
    'divine_appointment_established',false,
    'moon_phase_rule_used',false,
    'candidate_rationale','divide + re-establish is a transition/duplication/second-phase operation',
    'research_boundary','Do not backfill waxing/waning, fruitful/barren, or gardening almanac doctrine into this rule.'
  )
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (farm_id,stable_key,rule_version) do update
set status=excluded.status,
    enforcement_mode=excluded.enforcement_mode,
    predicate=excluded.predicate,
    fitness_when_match=excluded.fitness_when_match,
    fitness_when_no_match=excluded.fitness_when_no_match,
    evidence_class=excluded.evidence_class,
    source_summary=excluded.source_summary,
    source_refs=excluded.source_refs,
    priority=excluded.priority,
    active=excluded.active,
    valid_from=excluded.valid_from,
    valid_until=excluded.valid_until,
    owner_note=excluded.owner_note,
    metadata=excluded.metadata,
    updated_at=now();
