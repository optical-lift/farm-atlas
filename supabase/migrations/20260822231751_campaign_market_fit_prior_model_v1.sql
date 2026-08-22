create table if not exists local_intel.intelligence_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  model_version text not null,
  domain_key text not null references local_intel.intelligence_competence_domains(stable_key) on delete restrict,
  decision_kind text not null,
  prediction_kind text not null,
  model_type text not null,
  feature_contract_version text not null,
  effective_from timestamptz not null default now(),
  training_outcome_count integer not null default 0 check (training_outcome_count >= 0),
  calibration_state text not null,
  probability_semantics text not null,
  retroactive_application_allowed boolean not null default false,
  specification_basis text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(model_key, model_version)
);

create table if not exists local_intel.intelligence_model_coefficients (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references local_intel.intelligence_model_versions(id) on delete restrict,
  feature_key text not null,
  feature_value text not null,
  coefficient numeric not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  unique(model_id, feature_key, feature_value)
);

create index if not exists intelligence_model_versions_domain_idx
  on local_intel.intelligence_model_versions(domain_key, effective_from desc);
create index if not exists intelligence_model_coefficients_model_idx
  on local_intel.intelligence_model_coefficients(model_id);

create or replace function local_intel.block_intelligence_model_spec_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'released intelligence model specifications are append-only';
end;
$function$;

drop trigger if exists intelligence_model_versions_append_only_v1 on local_intel.intelligence_model_versions;
create trigger intelligence_model_versions_append_only_v1
before update or delete on local_intel.intelligence_model_versions
for each row execute function local_intel.block_intelligence_model_spec_mutation_v1();

drop trigger if exists intelligence_model_coefficients_append_only_v1 on local_intel.intelligence_model_coefficients;
create trigger intelligence_model_coefficients_append_only_v1
before update or delete on local_intel.intelligence_model_coefficients
for each row execute function local_intel.block_intelligence_model_spec_mutation_v1();

insert into local_intel.intelligence_model_versions(
  model_key, model_version, domain_key, decision_kind, prediction_kind, model_type,
  feature_contract_version, training_outcome_count, calibration_state, probability_semantics,
  retroactive_application_allowed, specification_basis, metadata
) values (
  'campaign_market_fit_prior','1.0.0','market_fit','campaign_target_selection','market_fit',
  'preregistered_logistic_prior','campaign_market_fit_features_v1',0,'uncalibrated_prior',
  'A prospective prior probability estimate produced by a frozen logistic specification before outcome calibration. It is not empirical calibration and does not itself authorize action.',
  false,
  'Frozen before prospective outcomes. Uses only upstream market-fit evidence already present in the target qualification snapshot: research warrant, external-space fit state, and workforce scale. Excludes legacy rank_score and qualification_tier because they are downstream summaries; excludes marketing clearance and organizer/contact routing because those govern outreach actionability rather than market fit.',
  jsonb_build_object(
    'release_class','prospective_only',
    'authority_boundary','intelligence_confidence_abstention_authority_v1',
    'training_outcomes_at_release',0,
    'coefficient_origin','governance_prior_not_fitted_to_outcomes'
  )
)
on conflict (model_key, model_version) do nothing;

insert into local_intel.intelligence_model_coefficients(model_id,feature_key,feature_value,coefficient,rationale)
select m.id, x.feature_key, x.feature_value, x.coefficient, x.rationale
from local_intel.intelligence_model_versions m
cross join (values
  ('__intercept__','*',-1.00::numeric,'Conservative base log-odds before target-specific evidence.'),
  ('research_warrant','proven_demand',1.00::numeric,'Direct/proven demand evidence materially raises the prior.'),
  ('research_warrant','high_value_role_hypothesis',0.20::numeric,'A role hypothesis is informative but substantially weaker than proven demand.'),
  ('external_space_fit_state','direct_external_space_fit',1.25::numeric,'Direct evidence that outside space is useful strongly raises fit.'),
  ('external_space_fit_state','mixed_direct_evidence',0.70::numeric,'Mixed direct evidence supports fit but preserves meaningful uncertainty.'),
  ('external_space_fit_state','structural_fit_with_self_supply',0.40::numeric,'Structural fit remains positive despite some self-supply capacity.'),
  ('external_space_fit_state','propensity_only',0.15::numeric,'Propensity evidence is weak positive evidence, not direct fit proof.'),
  ('external_space_fit_state','no_fit_evidence',0.00::numeric,'Absence of fit evidence contributes no directional evidence.'),
  ('external_space_fit_state','weak_self_supply_signal',-0.45::numeric,'Weak self-supply evidence lowers the prior without ruling out fit.'),
  ('external_space_fit_state','strong_self_supply_signal',-1.20::numeric,'Strong self-supply evidence substantially lowers expected need for outside space.'),
  ('workforce_scale_summary','250_plus',0.50::numeric,'Large workforce creates more plausible recurring group-use demand.'),
  ('workforce_scale_summary','reported_band:51-200',0.30::numeric,'Medium-large workforce modestly raises plausible group-use demand.'),
  ('workforce_scale_summary','25_49',0.10::numeric,'Smaller workforce is a weak positive scale signal.'),
  ('workforce_scale_summary','workforce_known_size_unknown',0.05::numeric,'Known workforce presence with unresolved size is only minimally positive.'),
  ('workforce_scale_summary','unknown',0.00::numeric,'Unknown scale contributes no directional evidence.')
) as x(feature_key,feature_value,coefficient,rationale)
where m.model_key='campaign_market_fit_prior' and m.model_version='1.0.0'
on conflict (model_id,feature_key,feature_value) do nothing;

create or replace function local_intel.get_intelligence_model_coefficient_v1(
  p_model_id uuid,
  p_feature_key text,
  p_feature_value text
)
returns numeric
language sql
security definer
stable
set search_path to 'pg_catalog','local_intel'
as $function$
  select c.coefficient
  from local_intel.intelligence_model_coefficients c
  where c.model_id=p_model_id
    and c.feature_key=p_feature_key
    and c.feature_value=p_feature_value
  limit 1
$function$;

create or replace function local_intel.score_campaign_market_fit_prior_v1(
  p_campaign_target_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  m local_intel.intelligence_model_versions%rowtype;
  v_research text;
  v_space text;
  v_scale text;
  v_intercept numeric;
  v_research_c numeric;
  v_space_c numeric;
  v_scale_c numeric;
  v_lp numeric;
  v_probability numeric;
  v_class text;
  v_unmapped jsonb := '[]'::jsonb;
begin
  select * into t from local_intel.campaign_targets where id=p_campaign_target_id;
  if not found then raise exception 'Unknown campaign target %',p_campaign_target_id; end if;

  select * into m
  from local_intel.intelligence_model_versions
  where model_key='campaign_market_fit_prior' and model_version='1.0.0'
  limit 1;
  if not found then raise exception 'campaign_market_fit_prior 1.0.0 is not released'; end if;

  v_research := nullif(t.qualification_snapshot->>'research_warrant','');
  v_space := nullif(t.qualification_snapshot->>'external_space_fit_state','');
  v_scale := nullif(t.qualification_snapshot->>'workforce_scale_summary','');

  v_intercept := local_intel.get_intelligence_model_coefficient_v1(m.id,'__intercept__','*');
  v_research_c := local_intel.get_intelligence_model_coefficient_v1(m.id,'research_warrant',coalesce(v_research,'<missing>'));
  v_space_c := local_intel.get_intelligence_model_coefficient_v1(m.id,'external_space_fit_state',coalesce(v_space,'<missing>'));
  v_scale_c := local_intel.get_intelligence_model_coefficient_v1(m.id,'workforce_scale_summary',coalesce(v_scale,'<missing>'));

  if v_research_c is null then
    v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('feature_key','research_warrant','feature_value',coalesce(v_research,'<missing>')));
  end if;
  if v_space_c is null then
    v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('feature_key','external_space_fit_state','feature_value',coalesce(v_space,'<missing>')));
  end if;
  if v_scale_c is null then
    v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('feature_key','workforce_scale_summary','feature_value',coalesce(v_scale,'<missing>')));
  end if;

  if jsonb_array_length(v_unmapped)=0 then
    v_lp := v_intercept + v_research_c + v_space_c + v_scale_c;
    v_probability := round((1.0 / (1.0 + exp((-1.0 * v_lp)::double precision)))::numeric,6);
    v_class := case
      when v_probability >= 0.75 then 'strong_prior_fit'
      when v_probability >= 0.55 then 'moderate_prior_fit'
      when v_probability >= 0.35 then 'weak_prior_fit'
      else 'low_prior_fit'
    end;
  else
    v_lp := null;
    v_probability := null;
    v_class := 'unscored';
  end if;

  return jsonb_build_object(
    'model_id',m.id,
    'model_key',m.model_key,
    'model_version',m.model_version,
    'model_type',m.model_type,
    'feature_contract_version',m.feature_contract_version,
    'calibration_state',m.calibration_state,
    'training_outcome_count',m.training_outcome_count,
    'probability_semantics',m.probability_semantics,
    'retroactive_application_allowed',m.retroactive_application_allowed,
    'scoring_state',case when v_probability is null then 'unsupported_feature_contract' else 'scored' end,
    'predicted_probability',v_probability,
    'predicted_class',v_class,
    'linear_predictor',v_lp,
    'features',jsonb_build_object(
      'intercept',jsonb_build_object('value','*','coefficient',v_intercept),
      'research_warrant',jsonb_build_object('value',v_research,'coefficient',v_research_c),
      'external_space_fit_state',jsonb_build_object('value',v_space,'coefficient',v_space_c),
      'workforce_scale_summary',jsonb_build_object('value',v_scale,'coefficient',v_scale_c)
    ),
    'unmapped_features',v_unmapped,
    'excluded_from_model',jsonb_build_array(
      'rank_score','qualification_tier','marketing_clearance_state','organizer_resolution_state','buyer_context_snapshot'
    ),
    'exclusion_basis','Downstream ranking summaries and outreach/actionability fields are not market-fit evidence.'
  );
end;
$function$;

create or replace function local_intel.capture_campaign_target_market_fit_v1_0(
  p_campaign_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  v_score jsonb;
  v_id uuid;
  v_key text;
  v_probability numeric;
  v_recommendation text;
begin
  select * into t from local_intel.campaign_targets where id=p_campaign_target_id;
  if not found then raise exception 'Unknown campaign target %',p_campaign_target_id; end if;

  v_score := local_intel.score_campaign_market_fit_prior_v1(p_campaign_target_id);
  v_key := 'campaign_target:'||t.id::text||':market_fit:campaign_market_fit_prior:1.0.0';

  if jsonb_typeof(v_score->'predicted_probability')='number' then
    v_probability := (v_score->>'predicted_probability')::numeric;
  end if;

  v_recommendation := case
    when v_probability is null then
      'Market-fit prior could not score this target under the frozen v1.0 feature contract. Research or a later model version is required before a probability-bearing prediction.'
    else
      'Prospective market-fit prior estimate only. Route any action through the intelligence authority membrane; this probability is not yet empirically calibrated.'
  end;

  insert into local_intel.intelligence_decisions(
    stable_key,decision_kind,subject_entity_id,campaign_target_id,offering_use_case_id,
    source_object_kind,source_object_ref,model_key,model_version,prediction_kind,
    predicted_class,predicted_probability,rank_score,recommendation,feature_snapshot,evidence_snapshot,issued_at,metadata
  ) values (
    v_key,'campaign_target_selection',t.organization_entity_id,t.id,t.offering_use_case_id,
    'campaign_target',t.id::text,'campaign_market_fit_prior','1.0.0','market_fit',
    v_score->>'predicted_class',v_probability,null,v_recommendation,
    coalesce(v_score,'{}'::jsonb),
    jsonb_build_object(
      'campaign_id',t.campaign_id,
      'segment_id',t.segment_id,
      'qualification_snapshot',coalesce(t.qualification_snapshot,'{}'::jsonb),
      'source_view',t.metadata->>'source_view',
      'selected_at',t.selected_at
    ),
    now(),
    jsonb_build_object(
      'snapshot_origin','prospective_campaign_target_model',
      'prospective_only',true,
      'legacy_rank_score_excluded',true,
      'qualification_tier_excluded',true,
      'marketing_clearance_excluded_from_market_fit',true,
      'organizer_resolution_excluded_from_market_fit',true,
      'authority_required',true
    )
  )
  on conflict (stable_key) do nothing returning id into v_id;

  if v_id is null then
    select id into v_id from local_intel.intelligence_decisions where stable_key=v_key;
  end if;
  return v_id;
end;
$function$;

create or replace function local_intel.capture_new_campaign_target_decision_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  perform local_intel.capture_campaign_target_market_fit_v1_0(new.id);
  return new;
end;
$function$;

create or replace function local_intel.capture_campaign_target_decision_v1(p_campaign_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  v_id uuid;
  v_stable_key text;
  v_effective_from timestamptz;
begin
  select * into t from local_intel.campaign_targets where id=p_campaign_target_id;
  if not found then raise exception 'Unknown campaign target %',p_campaign_target_id; end if;

  select d.id into v_id
  from local_intel.intelligence_decisions d
  where d.campaign_target_id=p_campaign_target_id
    and d.decision_kind='campaign_target_selection'
    and d.prediction_kind='market_fit'
    and d.model_key='campaign_market_fit_prior'
    and d.model_version='1.0.0'
  order by d.issued_at desc,d.id
  limit 1;
  if v_id is not null then return v_id; end if;

  select m.effective_from into v_effective_from
  from local_intel.intelligence_model_versions m
  where m.model_key='campaign_market_fit_prior' and m.model_version='1.0.0'
  limit 1;

  if v_effective_from is not null and t.created_at >= v_effective_from then
    return local_intel.capture_campaign_target_market_fit_v1_0(p_campaign_target_id);
  end if;

  v_stable_key := 'campaign_target:' || t.id::text || ':market_fit:v1';
  select id into v_id from local_intel.intelligence_decisions where stable_key=v_stable_key;
  if v_id is not null then return v_id; end if;

  insert into local_intel.intelligence_decisions(
    stable_key,decision_kind,subject_entity_id,campaign_target_id,offering_use_case_id,source_object_kind,source_object_ref,
    model_key,model_version,prediction_kind,predicted_class,predicted_probability,rank_score,recommendation,
    feature_snapshot,evidence_snapshot,issued_at,metadata
  ) values (
    v_stable_key,'campaign_target_selection',t.organization_entity_id,t.id,t.offering_use_case_id,'campaign_target',t.id::text,
    coalesce(nullif(t.metadata->>'ranking_model_key',''),'campaign_target_rank_score'),
    coalesce(nullif(t.metadata->>'ranking_model_version',''),'unversioned'),'market_fit',t.qualification_tier,
    case when jsonb_typeof(t.metadata->'predicted_probability')='number' then (t.metadata->>'predicted_probability')::numeric else null end,
    t.rank_score,'Include this organization × use-case pair in the campaign target set at the recorded qualification tier.',
    jsonb_build_object('qualification_tier',t.qualification_tier,'target_state',t.target_state,'rank_score',t.rank_score,'test_wave',t.test_wave,'test_cell',t.test_cell,'venue_fit_readiness',t.venue_fit_readiness,'organizer_resolution_state',t.organizer_resolution_state,'marketing_clearance_state',t.marketing_clearance_state,'buyer_context_snapshot',coalesce(t.buyer_context_snapshot,'{}'::jsonb),'qualification_snapshot',coalesce(t.qualification_snapshot,'{}'::jsonb)),
    jsonb_build_object('campaign_id',t.campaign_id,'segment_id',t.segment_id),coalesce(t.selected_at,t.created_at,now()),
    jsonb_build_object('snapshot_origin','campaign_target','historical_probability_available',jsonb_typeof(t.metadata->'predicted_probability')='number')
  ) on conflict (stable_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_decisions where stable_key=v_stable_key; end if;
  return v_id;
end;
$function$;

create or replace view local_intel.v_campaign_market_fit_prior_shadow_v1 as
select
  t.id as campaign_target_id,
  t.organization_entity_id,
  t.offering_use_case_id,
  s.packet->>'scoring_state' as scoring_state,
  nullif(s.packet->>'predicted_probability','')::numeric as shadow_predicted_probability,
  s.packet->>'predicted_class' as shadow_predicted_class,
  s.packet->'features' as feature_packet,
  s.packet->'unmapped_features' as unmapped_features,
  true as shadow_only,
  false as is_prospective_decision,
  s.packet as model_packet
from local_intel.campaign_targets t
cross join lateral (
  select local_intel.score_campaign_market_fit_prior_v1(t.id) as packet
) s;

revoke all on local_intel.intelligence_model_versions from public,anon,authenticated;
revoke all on local_intel.intelligence_model_coefficients from public,anon,authenticated;
revoke all on local_intel.v_campaign_market_fit_prior_shadow_v1 from public,anon,authenticated;
revoke execute on function local_intel.block_intelligence_model_spec_mutation_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.get_intelligence_model_coefficient_v1(uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function local_intel.score_campaign_market_fit_prior_v1(uuid) from public,anon,authenticated;
revoke execute on function local_intel.capture_campaign_target_market_fit_v1_0(uuid) from public,anon,authenticated,service_role;
revoke execute on function local_intel.capture_new_campaign_target_decision_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.capture_campaign_target_decision_v1(uuid) from public,anon,authenticated;

grant select on local_intel.intelligence_model_versions to service_role;
grant select on local_intel.intelligence_model_coefficients to service_role;
grant select on local_intel.v_campaign_market_fit_prior_shadow_v1 to service_role;
grant execute on function local_intel.score_campaign_market_fit_prior_v1(uuid) to service_role;
grant execute on function local_intel.capture_campaign_target_decision_v1(uuid) to service_role;
