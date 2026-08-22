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
  m local_intel.intelligence_model_versions%rowtype;
  v_score jsonb;
  v_id uuid;
  v_key text;
  v_probability numeric;
  v_recommendation text;
begin
  select * into t from local_intel.campaign_targets where id=p_campaign_target_id;
  if not found then raise exception 'Unknown campaign target %',p_campaign_target_id; end if;

  select * into m
  from local_intel.intelligence_model_versions
  where model_key='campaign_market_fit_prior' and model_version='1.0.0'
  limit 1;
  if not found then raise exception 'campaign_market_fit_prior 1.0.0 is not released'; end if;

  if m.retroactive_application_allowed=false and t.created_at < m.effective_from then
    raise exception 'campaign_market_fit_prior 1.0.0 is prospective-only; target % predates model release',p_campaign_target_id;
  end if;

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
      'model_effective_from',m.effective_from,
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

revoke execute on function local_intel.capture_campaign_target_market_fit_v1_0(uuid) from public,anon,authenticated,service_role;
