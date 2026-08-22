create or replace function local_intel.record_intelligence_decision_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_id uuid;
  v_key text := nullif(btrim(p_payload->>'stable_key'),'');
  v_subject uuid;
  v_campaign_target uuid;
  v_use_case uuid;
  v_probability numeric;
begin
  if v_key is null then raise exception 'stable_key is required'; end if;
  if nullif(btrim(p_payload->>'decision_kind'),'') is null then raise exception 'decision_kind is required'; end if;
  if nullif(btrim(p_payload->>'source_object_kind'),'') is null or nullif(btrim(p_payload->>'source_object_ref'),'') is null then raise exception 'source object kind/ref are required'; end if;
  if nullif(btrim(p_payload->>'model_key'),'') is null or nullif(btrim(p_payload->>'model_version'),'') is null then raise exception 'model key/version are required'; end if;
  if nullif(btrim(p_payload->>'prediction_kind'),'') is null then raise exception 'prediction_kind is required'; end if;
  if nullif(btrim(p_payload->>'recommendation'),'') is null then raise exception 'recommendation is required'; end if;

  begin v_subject := nullif(p_payload->>'subject_entity_id','')::uuid; exception when invalid_text_representation then raise exception 'subject_entity_id must be UUID'; end;
  begin v_campaign_target := nullif(p_payload->>'campaign_target_id','')::uuid; exception when invalid_text_representation then raise exception 'campaign_target_id must be UUID'; end;
  begin v_use_case := nullif(p_payload->>'offering_use_case_id','')::uuid; exception when invalid_text_representation then raise exception 'offering_use_case_id must be UUID'; end;
  if jsonb_typeof(p_payload->'predicted_probability')='number' then v_probability := (p_payload->>'predicted_probability')::numeric; end if;
  if v_probability is not null and (v_probability < 0 or v_probability > 1) then raise exception 'predicted_probability must be 0..1'; end if;

  insert into local_intel.intelligence_decisions(
    stable_key,decision_kind,subject_entity_id,campaign_target_id,offering_use_case_id,source_object_kind,source_object_ref,
    model_key,model_version,prediction_kind,predicted_class,predicted_probability,rank_score,recommendation,
    feature_snapshot,evidence_snapshot,issued_at,metadata
  ) values (
    v_key,p_payload->>'decision_kind',v_subject,v_campaign_target,v_use_case,p_payload->>'source_object_kind',p_payload->>'source_object_ref',
    p_payload->>'model_key',p_payload->>'model_version',p_payload->>'prediction_kind',nullif(p_payload->>'predicted_class',''),v_probability,
    case when jsonb_typeof(p_payload->'rank_score')='number' then (p_payload->>'rank_score')::numeric else null end,
    p_payload->>'recommendation',coalesce(p_payload->'feature_snapshot','{}'::jsonb),coalesce(p_payload->'evidence_snapshot','{}'::jsonb),
    coalesce(nullif(p_payload->>'issued_at','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb)
  ) on conflict (stable_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_decisions where stable_key=v_key; end if;
  return v_id;
end;
$function$;

create or replace function local_intel.record_intelligence_action_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_id uuid;
  v_key text := nullif(btrim(p_payload->>'action_key'),'');
  v_decision uuid;
begin
  if v_key is null then raise exception 'action_key is required'; end if;
  begin v_decision := (p_payload->>'decision_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'decision_id must be UUID'; end;
  if not exists(select 1 from local_intel.intelligence_decisions where id=v_decision) then raise exception 'Unknown decision %',v_decision; end if;
  if nullif(btrim(p_payload->>'action_kind'),'') is null then raise exception 'action_kind is required'; end if;
  if coalesce(p_payload->>'action_state','') not in ('planned','executed','failed','cancelled') then raise exception 'Invalid action_state'; end if;
  if nullif(btrim(p_payload->>'actor_kind'),'') is null then raise exception 'actor_kind is required'; end if;

  insert into local_intel.intelligence_actions(action_key,decision_id,action_kind,action_state,actor_kind,actor_ref,channel,action_snapshot,occurred_at,metadata)
  values(v_key,v_decision,p_payload->>'action_kind',p_payload->>'action_state',p_payload->>'actor_kind',nullif(p_payload->>'actor_ref',''),nullif(p_payload->>'channel',''),coalesce(p_payload->'action_snapshot','{}'::jsonb),coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb))
  on conflict (action_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_actions where action_key=v_key; end if;
  return v_id;
end;
$function$;

create or replace function local_intel.record_intelligence_outcome_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_id uuid;
  v_key text := nullif(btrim(p_payload->>'outcome_key'),'');
  v_decision uuid;
  v_action uuid;
  v_dec local_intel.intelligence_decisions%rowtype;
  v_policy local_intel.intelligence_outcome_scoring_policies%rowtype;
  v_policy_found boolean;
begin
  if v_key is null then raise exception 'outcome_key is required'; end if;
  begin v_decision := (p_payload->>'decision_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'decision_id must be UUID'; end;
  begin v_action := nullif(p_payload->>'action_id','')::uuid; exception when invalid_text_representation then raise exception 'action_id must be UUID'; end;
  select * into v_dec from local_intel.intelligence_decisions where id=v_decision;
  if not found then raise exception 'Unknown decision %',v_decision; end if;
  if v_action is not null and not exists(select 1 from local_intel.intelligence_actions where id=v_action and decision_id=v_decision) then raise exception 'Action % does not belong to decision %',v_action,v_decision; end if;
  if nullif(btrim(p_payload->>'outcome_kind'),'') is null then raise exception 'outcome_kind is required'; end if;
  if nullif(btrim(p_payload->>'evidence_source_kind'),'') is null then raise exception 'evidence_source_kind is required'; end if;

  select * into v_policy from local_intel.intelligence_outcome_scoring_policies p
  where p.status='active' and p.decision_kind=v_dec.decision_kind and p.prediction_kind=v_dec.prediction_kind and p.outcome_kind=p_payload->>'outcome_kind'
  order by p.updated_at desc limit 1;
  v_policy_found := found;

  insert into local_intel.intelligence_outcomes(outcome_key,decision_id,action_id,outcome_kind,outcome_class,outcome_score,interpretation_state,scoring_policy_key,evidence_source_kind,evidence_ref,occurred_at,evidence_snapshot,metadata)
  values(v_key,v_decision,v_action,p_payload->>'outcome_kind',coalesce(nullif(p_payload->>'outcome_class',''),p_payload->>'outcome_kind'),case when v_policy_found then v_policy.outcome_score else null end,case when v_policy_found then v_policy.interpretation_state else 'unmapped' end,case when v_policy_found then v_policy.policy_key else null end,p_payload->>'evidence_source_kind',nullif(p_payload->>'evidence_ref',''),coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),coalesce(p_payload->'evidence_snapshot','{}'::jsonb),coalesce(p_payload->'metadata','{}'::jsonb))
  on conflict (outcome_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_outcomes where outcome_key=v_key; end if;
  perform local_intel.evaluate_intelligence_outcome_v1(v_id);
  return v_id;
end;
$function$;

revoke execute on function local_intel.record_intelligence_decision_v1(jsonb) from public, anon, authenticated;
revoke execute on function local_intel.record_intelligence_action_v1(jsonb) from public, anon, authenticated;
revoke execute on function local_intel.record_intelligence_outcome_v1(jsonb) from public, anon, authenticated;
grant execute on function local_intel.record_intelligence_decision_v1(jsonb) to service_role;
grant execute on function local_intel.record_intelligence_action_v1(jsonb) to service_role;
grant execute on function local_intel.record_intelligence_outcome_v1(jsonb) to service_role;