insert into local_intel.entity_resolution_veto_rules (
  stable_key,version,status,severity,applies_to_relationship,predicate_contract,required_evidence,rationale,metadata,created_at,updated_at
)
select 'identity_form_separation_required',1,'active','hard','same_entity',
       jsonb_build_object('effect','veto_same_entity','condition','a shared brand and its legal entities, or two differently named legal entities, must remain distinct identity records even when they share a domain'),
       jsonb_build_object('requires','governed organization_identity_profiles.identity_form plus first-party or authoritative identity evidence'),
       'A public brand identity is not identical to one legal entity that uses the brand, and two separately named legal entities are not interchangeable merely because they share a public identity surface.',
       jsonb_build_object('policy_family','identity_safety','introduced_by','resolver_2_2'),now(),now()
where not exists (select 1 from local_intel.entity_resolution_veto_rules where stable_key='identity_form_separation_required' and status='active');

create or replace view local_intel.v_entity_ingestion_identity_review_candidates_v2 as
select v.ingestion_candidate_id,
       v.review_state,
       v.proposed_name,
       v.proposed_entity_type,
       v.proposed_website_url,
       v.proposed_city,
       v.proposed_state,
       v.source_id,
       v.source_role,
       v.source_class_key,
       v.authority_tier,
       c.publisher_authority,
       c.default_subject_party_relationship as subject_party_relationship,
       v.acceptance_mode,
       v.source_currently_admissible,
       v.proposed_name_normalized,
       v.proposed_website_host,
       v.entity_id,
       v.entity_name,
       v.entity_type,
       v.entity_website_url,
       v.entity_city,
       v.entity_state,
       v.identity_unit_class,
       v.hierarchy_state,
       p.identity_form,
       v.legal_name,
       v.exact_normalized_name,
       v.exact_website_host,
       case
         when v.exact_normalized_name and v.exact_website_host and c.default_subject_party_relationship='first_party' then 3
         when v.exact_normalized_name and v.exact_website_host and c.default_subject_party_relationship='authoritative_third_party' then 2
         when v.exact_normalized_name or v.exact_website_host then 1
         else 0
       end as evidence_score,
       case
         when v.exact_normalized_name and v.exact_website_host
          and c.default_subject_party_relationship in ('first_party','authoritative_third_party')
          then 'strong_review_candidate'
         else 'review_candidate'
       end as recommendation_state,
       case
         when v.exact_normalized_name and v.exact_website_host and c.default_subject_party_relationship='first_party'
           then 'first_party_exact_name_and_website_host'
         when v.exact_normalized_name and v.exact_website_host and c.default_subject_party_relationship='authoritative_third_party'
           then 'authoritative_third_party_exact_name_and_website_host'
         when v.exact_website_host then 'qualified_source_exact_website_host'
         when v.exact_normalized_name then 'qualified_source_exact_normalized_name'
         else 'insufficient_identity_surface_evidence'
       end as recommendation_basis,
       v.candidate_rank,
       v.top_score_tie_count,
       'public_identity_surface'::text as identity_match_scope,
       false as same_legal_entity_asserted
from local_intel.v_entity_ingestion_identity_review_candidates_v1 v
left join local_intel.source_class_assignments a on a.source_id=v.source_id
left join local_intel.research_source_classes c on c.id=a.source_class_id
left join local_intel.organization_identity_profiles p on p.entity_id=v.entity_id;

create or replace view local_intel.v_entity_resolution_resolver_v2_2_live_pair_recommendations as
select b.left_entity_id,
       b.right_entity_id,
       b.left_entity_name,
       b.right_entity_name,
       b.left_entity_type,
       b.right_entity_type,
       b.left_city,
       b.right_city,
       b.left_state,
       b.right_state,
       b.left_identity_unit_class,
       b.right_identity_unit_class,
       lp.identity_form as left_identity_form,
       rp.identity_form as right_identity_form,
       b.left_hierarchy_state,
       b.right_hierarchy_state,
       b.left_legal_name,
       b.right_legal_name,
       b.left_identity_source_id,
       b.right_identity_source_id,
       b.left_identity_source_class_key,
       b.right_identity_source_class_key,
       b.left_identity_source_admissible,
       b.right_identity_source_admissible,
       b.left_authority_namespace,
       b.right_authority_namespace,
       b.left_authority_identifier,
       b.right_authority_identifier,
       b.left_institution_identifier,
       b.right_institution_identifier,
       b.left_parent_entity_id,
       b.right_parent_entity_id,
       b.left_authoritative_identity,
       b.right_authoritative_identity,
       b.left_name_normalized,
       b.right_name_normalized,
       b.left_legal_name_normalized,
       b.right_legal_name_normalized,
       b.blocked_by_exact_name,
       b.blocked_by_canonical_domain,
       b.blocked_by_authoritative_identifier,
       b.operating_unit_veto,
       b.authoritative_identifier_conflict_veto,
       b.incompatible_function_veto,
       b.distinct_governed_organizations_veto,
       (
         (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
         or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
         or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
             and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                 <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
       ) as identity_form_separation_veto,
       case
         when (
           (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
           or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
           or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
               and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                   <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
         ) then array_append(coalesce(b.triggered_veto_keys,array[]::text[]),'identity_form_separation_required')
         else b.triggered_veto_keys
       end as triggered_veto_keys,
       (b.same_entity_vetoed or (
         (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
         or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
         or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
             and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                 <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
       )) as same_entity_vetoed,
       case
         when (
           (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
           or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
           or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
               and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                   <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
         ) then 'different_entity'
         else b.predicted_relationship
       end as predicted_relationship,
       case
         when (
           (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
           or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
           or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
               and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                   <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
         ) then 0.999::numeric
         else b.predicted_confidence
       end as predicted_confidence,
       case
         when (
           (lp.identity_form='shared_brand' and rp.identity_form='legal_entity')
           or (lp.identity_form='legal_entity' and rp.identity_form='shared_brand')
           or (lp.identity_form='legal_entity' and rp.identity_form='legal_entity'
               and local_intel.normalize_entity_name_for_resolution_v2(coalesce(lp.legal_name,b.left_entity_name))
                   <> local_intel.normalize_entity_name_for_resolution_v2(coalesce(rp.legal_name,b.right_entity_name)))
         ) then 'hard_veto_identity_form_separation_required'
         else b.decision_basis
       end as decision_basis
from local_intel.v_entity_resolution_resolver_v2_1_live_pair_recommendations b
left join local_intel.organization_identity_profiles lp on lp.entity_id=b.left_entity_id
left join local_intel.organization_identity_profiles rp on rp.entity_id=b.right_entity_id;

create or replace function local_intel.refresh_entity_resolution_v2_2_review_recommendations()
returns jsonb
language plpgsql
set search_path to 'local_intel','pg_temp'
as $function$
declare
  v_ingestion_updated integer := 0;
  v_merge_inserted integer := 0;
begin
  with chosen as (
    select r.*
    from local_intel.v_entity_ingestion_identity_review_candidates_v2 r
    where r.candidate_rank=1
      and r.top_score_tie_count=1
      and r.recommendation_state='strong_review_candidate'
      and not exists (
        select 1
        from local_intel.identity_review_adjudications a
        where a.review_kind='ingestion_candidate_match'
          and a.review_subject_id=r.ingestion_candidate_id
          and a.decision='rejected'
          and a.recommended_target_entity_id=r.entity_id
          and coalesce(a.algorithm_key,'')='governed_evidence_veto_resolver'
      )
  )
  update local_intel.entity_ingestion_candidates ic
     set review_state='needs_review',
         resolver_recommended_entity_id=c.entity_id,
         resolver_recommendation_state=c.recommendation_state,
         resolver_algorithm_key='governed_evidence_veto_resolver',
         resolver_algorithm_version='2.2',
         resolver_recommendation_basis=c.recommendation_basis,
         resolver_recommendation_evidence=jsonb_build_object(
           'source_id',c.source_id,
           'source_class_key',c.source_class_key,
           'authority_tier',c.authority_tier,
           'publisher_authority',c.publisher_authority,
           'subject_party_relationship',c.subject_party_relationship,
           'acceptance_mode',c.acceptance_mode,
           'exact_normalized_name',c.exact_normalized_name,
           'exact_website_host',c.exact_website_host,
           'identity_unit_class',c.identity_unit_class,
           'identity_form',c.identity_form,
           'hierarchy_state',c.hierarchy_state,
           'identity_match_scope',c.identity_match_scope,
           'same_legal_entity_asserted',c.same_legal_entity_asserted,
           'auto_accept',false
         ),
         resolver_recommended_at=now(),
         resolver_adjudication_state=null,
         resolver_adjudicated_at=null,
         resolver_adjudicated_by=null,
         resolver_adjudication_basis=null,
         resolver_adjudication_metadata='{}'::jsonb,
         updated_at=now()
    from chosen c
   where ic.id=c.ingestion_candidate_id
     and ic.matched_entity_id is null
     and (
       ic.review_state='pending'
       or ic.resolver_recommended_entity_id is distinct from c.entity_id
       or ic.resolver_algorithm_version is distinct from '2.2'
       or ic.resolver_recommendation_basis is distinct from c.recommendation_basis
     );
  get diagnostics v_ingestion_updated = row_count;

  with eligible as (
    select r.*
    from local_intel.v_entity_resolution_resolver_v2_2_live_pair_recommendations r
    where r.predicted_relationship='same_entity'
      and not r.same_entity_vetoed
      and not exists (
        select 1
        from local_intel.entity_merge_decisions d
        where least(d.left_entity_id,d.right_entity_id)=least(r.left_entity_id,r.right_entity_id)
          and greatest(d.left_entity_id,d.right_entity_id)=greatest(r.left_entity_id,r.right_entity_id)
          and d.algorithm_key='governed_evidence_veto_resolver'
          and d.decision_state in ('proposed','approved')
      )
  ), ins as (
    insert into local_intel.entity_merge_decisions (
      left_entity_id,right_entity_id,proposed_relationship,algorithm_key,algorithm_version,
      proposed_confidence,decision_state,decision_basis,requires_cluster_reverification,metadata
    )
    select e.left_entity_id,e.right_entity_id,'same_entity','governed_evidence_veto_resolver','2.2',
           e.predicted_confidence,'proposed',e.decision_basis,true,
           jsonb_build_object(
             'origin','resolver_v2_2_live_review_bridge',
             'triggered_veto_keys',e.triggered_veto_keys,
             'left_identity_form',e.left_identity_form,
             'right_identity_form',e.right_identity_form,
             'blocked_by_exact_name',e.blocked_by_exact_name,
             'blocked_by_canonical_domain',e.blocked_by_canonical_domain,
             'blocked_by_authoritative_identifier',e.blocked_by_authoritative_identifier,
             'auto_merge_locked',true,
             'human_review_required',true
           )
    from eligible e
    returning id,left_entity_id,right_entity_id
  ), veto_rows as (
    insert into local_intel.entity_merge_veto_evaluations (merge_decision_id,veto_rule_id,outcome,evidence,metadata)
    select ins.id, vr.id,
           case vr.stable_key
             when 'accepted_operating_unit_relation_blocks_collapse' then case when r.operating_unit_veto then 'fail' else 'pass' end
             when 'authoritative_identifier_conflict' then case when r.authoritative_identifier_conflict_veto then 'fail' else 'pass' end
             when 'incompatible_governed_entity_functions' then case when r.incompatible_function_veto then 'fail' else 'pass' end
             when 'distinct_authoritative_legal_entities' then case when r.distinct_governed_organizations_veto then 'fail' else 'pass' end
             when 'identity_form_separation_required' then case when r.identity_form_separation_veto then 'fail' else 'pass' end
             when 'transitive_cluster_reverification_required' then 'not_applicable'
             else 'unknown'
           end,
           jsonb_build_object('resolver_algorithm_version','2.2','direct_pair_recommendation',true,'left_identity_form',r.left_identity_form,'right_identity_form',r.right_identity_form),
           jsonb_build_object('origin','resolver_v2_2_live_review_bridge')
    from ins
    join local_intel.v_entity_resolution_resolver_v2_2_live_pair_recommendations r
      on r.left_entity_id=ins.left_entity_id and r.right_entity_id=ins.right_entity_id
    join local_intel.entity_resolution_veto_rules vr
      on vr.status='active' and vr.applies_to_relationship='same_entity'
    returning 1
  )
  select count(*) into v_merge_inserted from ins;

  return jsonb_build_object(
    'ingestion_candidates_moved_to_review',v_ingestion_updated,
    'merge_recommendations_inserted',v_merge_inserted,
    'automatic_merge_executed',false,
    'algorithm_key','governed_evidence_veto_resolver',
    'algorithm_version','2.2',
    'identity_scope','public_identity_surface',
    'legal_identity_collapse_allowed',false
  );
end;
$function$;

select local_intel.refresh_entity_resolution_v2_2_review_recommendations();