alter table atlas.sky_operation_rules
  add constraint sky_operation_rules_active_requires_approved_v1
  check (not active or status = 'approved');

insert into atlas.sky_operation_rules(
  farm_id,stable_key,operation_class,rule_version,status,enforcement_mode,predicate,
  fitness_when_match,fitness_when_no_match,evidence_class,source_summary,source_refs,
  priority,active,owner_note,metadata
)
select
  farm.id,
  'elm_iris_division_window_v1',
  'divide_reestablish_belowground',
  1,
  'draft',
  'windowed',
  '{}'::jsonb,
  'favored',
  'unfavored',
  'working_reconstruction',
  'Intended behavior is windowed, but the specific agricultural lunar predicate is not yet promoted from Noel research. Current research supports operation-selection architecture and Moon/sign state as timing information, while warning that foregrounded state does not itself authorize intervention and that waning=release is not an established ancient lunar rule.',
  jsonb_build_array(
    jsonb_build_object('noel_discovery_key','historical_timing_operation_branch_matrix_result'),
    jsonb_build_object('noel_discovery_key','external_operation_timing_architecture_split_result'),
    jsonb_build_object('noel_discovery_key','foregrounded_state_not_automatic_action_control'),
    jsonb_build_object('noel_discovery_key','moon_independent_cycle_body_timing_control_result')
  ),
  10,
  false,
  'Do not approve until a concrete favored/contraindicated predicate for perennial rhizome division is independently supported or explicitly adopted as an Owner preference.',
  jsonb_build_object(
    'rule_intent','iris_division_disappears_outside_favored_window_and_returns_next_window',
    'predicate_status','unresolved',
    'activation_blocked_by_research_gap',true,
    'created_from','pass_2_sky_engine'
  )
from atlas.farms farm
where farm.stable_key='elm_farm'
on conflict (farm_id,stable_key,rule_version) do nothing;
