create table if not exists atlas.operation_sky_policy_library (
  operation_class text primary key references atlas.operation_classes(stable_key) on update cascade on delete restrict,
  governance_level text not null check (governance_level in ('no_rule','informative','preferred','windowed')),
  candidate_predicate jsonb not null default '{}'::jsonb,
  evidence_class text not null,
  source_summary text not null,
  source_refs jsonb not null default '[]'::jsonb,
  worker_withholding_supported boolean not null default false,
  farm_reality_override_required boolean not null default true,
  promotion_status text not null default 'adopted' check (promotion_status in ('adopted','research_only','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table atlas.operation_sky_policy_library is
'Global Atlas operation-to-sky governance library. This is the promoted operational grammar layer, not ephemeris truth. Farm-specific sky_operation_rules remain the actual runtime rules.';

alter table atlas.operation_sky_policy_library enable row level security;
revoke all on table atlas.operation_sky_policy_library from public, anon, authenticated;
grant select on table atlas.operation_sky_policy_library to authenticated, service_role;
drop policy if exists operation_sky_policy_library_read_v1 on atlas.operation_sky_policy_library;
create policy operation_sky_policy_library_read_v1 on atlas.operation_sky_policy_library
for select to authenticated using (auth.uid() is not null);

insert into atlas.operation_sky_policy_library(
  operation_class,governance_level,candidate_predicate,evidence_class,source_summary,source_refs,
  worker_withholding_supported,farm_reality_override_required,promotion_status,metadata
) values
('apply_treatment','informative','{}'::jsonb,'historically_attested',
 'Historical timed-treatment systems exist, including condition-index and body-target contraindication architectures, but Atlas has no recovered generic plant-treatment Moon formula. Treatment label, weather, disease pressure, and biological urgency therefore remain authoritative.',
 jsonb_build_array(jsonb_build_object('noel_discovery',128),jsonb_build_object('noel_discovery',124),jsonb_build_object('architecture','condition-index treatment / contraindication')),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'reason','analogue_exists_but_generic_farm_predicate_not_recovered')),
('build_establish_structure','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('fixed')),'working_reconstruction',
 'Fixed/solid mode historically carries continuity, endurance, permanence, and long duration. Durable construction seeks precisely that operation result. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','fixed')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true,'garden_specific_claim',false)),
('clean_restore','informative','{}'::jsonb,'working_reconstruction',
 'Cleansing/restoration is a recognizable operation family, but the recovered material does not establish a trustworthy generic Moon-mode or phase predicate for farm cleaning. In particular Atlas does not backdate a modern waning-equals-release formula.',
 jsonb_build_array(jsonb_build_object('noel_discovery',75),jsonb_build_object('noel_discovery',189)),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'waning_release_rejected_as_established_fact',true)),
('clear_demolish','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('moveable')),'working_reconstruction',
 'Moveable/cardinal mode historically fits mutation, alteration, short duration, and quick conclusion. Clearing or demolition intentionally changes an established condition. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','moveable')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('cultivate_prepare','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('common')),'working_reconstruction',
 'Common/bicorporeal mode historically fits intermediate, repeated, second-phase, and non-final work. Soil preparation is explicitly preparatory rather than final settlement, so common mode is a structural fit. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('noel_discovery',104),jsonb_build_object('mode','common')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('cut_separate','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('moveable')),'working_reconstruction',
 'Moveable/cardinal mode historically fits alteration and quick change. Cutting, pruning, mowing, deadheading, and comparable separation operations change an existing aboveground condition. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','moveable')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('divide_reestablish_belowground','windowed',jsonb_build_object('moon_mode_in',jsonb_build_array('common')),'owner_operating_hypothesis',
 'Common/bicorporeal mode is a strong structural fit for a compound divide-and-reestablish operation because it carries duplication, transition, repetition, and second-phase/non-final settlement. Owner policy permits actual withholding only when Atlas independently proves the task can safely wait.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('noel_discovery',104),jsonb_build_object('atlas_policy','task_sky_deferral_policy_v2')),
 true,true,'adopted',jsonb_build_object('active_rule_created',true,'withholding_requires_deferrability',true)),
('establish_aboveground','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('fixed')),'working_reconstruction',
 'Fixed/solid mode historically fits continuity, endurance, permanence, and stable duration. Establishment aims for a planting to take hold and persist. Because Atlas has no recovered gardening-specific planting formula, this is preference only and biological timing always outranks it.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','fixed')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true,'biological_timing_overrides',true)),
('establish_belowground','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('fixed')),'working_reconstruction',
 'Fixed/solid mode historically fits continuity, endurance, permanence, and stable duration. Establishing a bulb, corm, tuber, root, or rhizome seeks durable settlement. Because no gardening-specific formula is recovered, this is preference only.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','fixed')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true,'garden_specific_claim',false)),
('harvest_aboveground','informative','{}'::jsonb,'working_reconstruction',
 'Historical operation timing can address undertakings, but Atlas has not recovered a reliable generic harvest predicate for flowers, foliage, fruit, or seed. Ripeness, market timing, weather, and postharvest quality dominate.',
 jsonb_build_array(jsonb_build_object('noel_discovery',107),jsonb_build_object('noel_discovery',124)),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'harvest_readiness_dominates',true)),
('harvest_belowground','informative','{}'::jsonb,'working_reconstruction',
 'Historical operation timing can address undertakings, but Atlas has not recovered a reliable generic predicate for lifting roots, bulbs, corms, tubers, or rhizomes. Crop maturity, soil condition, storage, and weather dominate.',
 jsonb_build_array(jsonb_build_object('noel_discovery',107),jsonb_build_object('noel_discovery',124)),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'harvest_readiness_dominates',true)),
('inspect_assess','no_rule','{}'::jsonb,'historically_attested',
 'Foregrounded/readable celestial state is not automatic permission or prohibition. Inspection exists to discover farm reality, so Atlas must not delay seeing reality because the sky is unfavorable.',
 jsonb_build_array(jsonb_build_object('noel_discovery',100),jsonb_build_object('principle','foregrounded_state_not_action_control')),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'inspection_is_reality_acquisition',true)),
('process_postharvest','no_rule','{}'::jsonb,'working_reconstruction',
 'Once material is harvested, conditioning and postharvest handling are part of a quality-preservation chain with elapsed-time consequences. Atlas therefore gives the sky no scheduling authority here absent a specific future evidence-backed rule.',
 jsonb_build_array(jsonb_build_object('atlas_principle','process_dependency_precedes_sky')),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'process_continuation_protected',true)),
('remove_uproot','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('moveable')),'working_reconstruction',
 'Moveable/cardinal mode historically fits mutation, alteration, and quick conclusion. Uprooting or removing unwanted growth intentionally terminates the present biological arrangement. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','moveable')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('repair_restore','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('fixed')),'working_reconstruction',
 'Fixed/solid mode historically fits continuity, endurance, permanence, and stable duration. Repair aims to restore an object or system to durable service. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','fixed')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('retain_strengthen','preferred',jsonb_build_object('moon_mode_in',jsonb_build_array('fixed')),'working_reconstruction',
 'Fixed/solid mode historically fits continuity, endurance, permanence, and strengthening what is intended to remain. Staking, securing, protecting, or strengthening an existing condition is therefore a structural fit. Atlas uses this only as a non-blocking preference.',
 jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('mode','fixed')),
 false,true,'adopted',jsonb_build_object('active_rule_created',true)),
('water_nourish','no_rule','{}'::jsonb,'working_reconstruction',
 'Watering and direct nourishment respond to present physiological need. Atlas has no recovered generic lunar predicate strong enough to outrank moisture state, weather, crop stage, or stress, so sky has no scheduling authority here.',
 jsonb_build_array(jsonb_build_object('atlas_principle','biological_reality_precedes_sky')),
 false,true,'adopted',jsonb_build_object('active_rule_created',false,'need_based_care',true))
on conflict (operation_class) do update set
  governance_level=excluded.governance_level,
  candidate_predicate=excluded.candidate_predicate,
  evidence_class=excluded.evidence_class,
  source_summary=excluded.source_summary,
  source_refs=excluded.source_refs,
  worker_withholding_supported=excluded.worker_withholding_supported,
  farm_reality_override_required=excluded.farm_reality_override_required,
  promotion_status=excluded.promotion_status,
  metadata=excluded.metadata,
  updated_at=now();

with preferred(operation_class,stable_key,mode,summary_text) as (
  values
  ('build_establish_structure','atlas_build_establish_structure_fixed_preference_v1','fixed','Fixed mode is a non-blocking preference for durable establishment because its recovered operation grammar is continuity/endurance/permanence.'),
  ('clear_demolish','atlas_clear_demolish_moveable_preference_v1','moveable','Moveable mode is a non-blocking preference for clearing/demolition because its recovered operation grammar is mutation/alteration/quick conclusion.'),
  ('cultivate_prepare','atlas_cultivate_prepare_common_preference_v1','common','Common mode is a non-blocking preference for preparation because its recovered operation grammar is intermediate/non-final/second-phase work.'),
  ('cut_separate','atlas_cut_separate_moveable_preference_v1','moveable','Moveable mode is a non-blocking preference for cutting/separation because its recovered operation grammar is alteration/quick change.'),
  ('establish_aboveground','atlas_establish_aboveground_fixed_preference_v1','fixed','Fixed mode is a non-blocking preference for establishment because its recovered operation grammar is continuity/endurance/permanence; biological timing remains authoritative.'),
  ('establish_belowground','atlas_establish_belowground_fixed_preference_v1','fixed','Fixed mode is a non-blocking preference for belowground establishment because its recovered operation grammar is continuity/endurance/permanence.'),
  ('remove_uproot','atlas_remove_uproot_moveable_preference_v1','moveable','Moveable mode is a non-blocking preference for uprooting/removal because its recovered operation grammar is mutation/alteration/quick conclusion.'),
  ('repair_restore','atlas_repair_restore_fixed_preference_v1','fixed','Fixed mode is a non-blocking preference for repair/restoration because its recovered operation grammar is continuity/endurance/permanence.'),
  ('retain_strengthen','atlas_retain_strengthen_fixed_preference_v1','fixed','Fixed mode is a non-blocking preference for retaining/strengthening because its recovered operation grammar is continuity/endurance/permanence.')
)
insert into atlas.sky_operation_rules(
  farm_id,stable_key,operation_class,rule_version,status,enforcement_mode,predicate,
  fitness_when_match,fitness_when_no_match,evidence_class,source_summary,source_refs,
  priority,active,valid_from,owner_note,metadata
)
select distinct
  f.id,
  p.stable_key,
  p.operation_class,
  1,
  'approved',
  'preferred',
  jsonb_build_object('moon_mode_in',jsonb_build_array(p.mode)),
  'favored',
  'neutral',
  'working_reconstruction',
  p.summary_text,
  jsonb_build_array(jsonb_build_object('noel_discovery',102),jsonb_build_object('operation_library','atlas.operation_sky_policy_library')),
  50,
  true,
  (now() at time zone coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago'))::date,
  'Preferred means ranking signal only. This rule cannot hide work. Farm urgency, dates, dependencies, biological timing, and Body Budget remain authoritative.',
  jsonb_build_object('worker_withholding_authorized',false,'library_version','operation_sky_policy_library_v1','garden_specific_claim',false)
from atlas.farms f
join preferred p on true
where exists (select 1 from atlas.sky_state_samples s where s.farm_id=f.id)
  and not exists (
    select 1 from atlas.sky_operation_rules r
    where r.farm_id=f.id and r.stable_key=p.stable_key and r.rule_version=1
  );

comment on column atlas.operation_sky_policy_library.governance_level is
'no_rule: sky has no operation authority; informative: context only, no ranking predicate; preferred: non-blocking ranking; windowed: may withhold only through independent task deferrability policy.';