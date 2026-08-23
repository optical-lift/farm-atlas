create or replace view local_intel.v_campaign_target_fit_reconciliation_queue_v1
with (security_invoker = true)
as
with base as (
  select
    tev.*,
    a.id as latest_adjudication_id,
    a.adjudication_key as latest_adjudication_key,
    a.adjudicated_at as latest_adjudicated_at,
    a.new_venue_fit_readiness as latest_adjudicated_fit,
    case
      when a.id is not null
       and a.new_venue_fit_readiness is not distinct from tev.venue_fit_readiness
        then 'governed_adjudication'
      else 'legacy_or_unadjudicated'
    end as fit_state_provenance,
    case
      when tev.venue_fit_readiness in ('external_space_fit_supported','external_space_fit_partial_with_self_supply')
       and tev.derived_evidence_state in ('no_canonical_external_space_evidence','context_evidence_only')
        then 'legacy_claim_reconciliation'
      when tev.derived_evidence_state = 'internal_self_supply_evidence_only'
       and tev.venue_fit_readiness <> 'external_space_fit_needs_exception_evidence'
        then 'adjudication_ready_internal_self_supply'
      when tev.derived_evidence_state = 'use_case_external_evidence'
       and tev.venue_fit_readiness <> 'external_space_fit_supported'
        then 'positive_evidence_policy_extension_needed'
      when tev.derived_evidence_state = 'organization_external_evidence_use_case_unresolved'
        then 'use_case_scope_adjudication_needed'
      when tev.venue_fit_readiness <> 'demand_not_yet_proven'
       and tev.next_best_enrichment in ('external_space_fit_enrichment','external_space_exception_check')
       and tev.derived_evidence_state in ('no_canonical_external_space_evidence','context_evidence_only')
        then 'research_needed'
      when a.id is null
       and tev.venue_fit_readiness in ('external_space_fit_supported','external_space_fit_partial_with_self_supply','external_space_fit_needs_exception_evidence')
        then 'legacy_state_needs_provenance'
      else null
    end as queue_state
  from local_intel.v_campaign_external_space_target_evidence_v1 tev
  left join lateral (
    select x.*
    from local_intel.campaign_target_fit_adjudications x
    where x.campaign_target_id = tev.campaign_target_id
    order by x.adjudicated_at desc
    limit 1
  ) a on true
)
select
  b.*,
  case b.queue_state
    when 'legacy_claim_reconciliation' then 5
    when 'adjudication_ready_internal_self_supply' then 4
    when 'positive_evidence_policy_extension_needed' then 4
    when 'use_case_scope_adjudication_needed' then 4
    when 'legacy_state_needs_provenance' then 4
    when 'research_needed' then greatest(1,least(5,ceil(coalesce(b.rank_score,0)/30.0)::integer))
    else 1
  end as reconciliation_priority,
  case b.queue_state
    when 'legacy_claim_reconciliation' then 'execute_organization_external_space_research_then_governed_reconciliation'
    when 'adjudication_ready_internal_self_supply' then 'adjudicate_target_fit_from_internal_self_supply_evidence'
    when 'positive_evidence_policy_extension_needed' then 'extend_positive_target_fit_adjudication_policy_before_write'
    when 'use_case_scope_adjudication_needed' then 'adjudicate_external_evidence_use_case_scope'
    when 'legacy_state_needs_provenance' then 'reconstruct_or_adjudicate_legacy_fit_provenance'
    when 'research_needed' then 'execute_organization_external_space_research_contract'
    else null
  end as next_action
from base b
where b.queue_state is not null;

create or replace view local_intel.v_campaign_external_space_research_queue_v2
with (security_invoker = true)
as
with targets as (
  select r.*
  from local_intel.v_campaign_target_fit_reconciliation_queue_v1 r
  where r.queue_state in ('legacy_claim_reconciliation','research_needed')
), grouped as (
  select
    t.campaign_id,
    t.organization_entity_id,
    t.organization_name,
    count(*) as target_count,
    count(*) filter (where t.queue_state='legacy_claim_reconciliation') as contradiction_count,
    max(t.rank_score) as max_rank_score,
    jsonb_agg(t.campaign_target_id order by t.reconciliation_priority desc,t.rank_score desc) as target_ids,
    jsonb_agg(
      jsonb_build_object(
        'campaign_target_id',t.campaign_target_id,
        'use_case_id',t.offering_use_case_id,
        'use_case_key',t.use_case_key,
        'use_case_name',t.use_case_name,
        'segment',t.segment_name,
        'rank_score',t.rank_score,
        'current_fit',t.venue_fit_readiness,
        'fit_state_provenance',t.fit_state_provenance,
        'derived_evidence_state',t.derived_evidence_state,
        'queue_state',t.queue_state,
        'recommended_adjudication',t.recommended_adjudication,
        'next_action',t.next_action
      ) order by t.reconciliation_priority desc,t.rank_score desc
    ) as target_contexts
  from targets t
  group by t.campaign_id,t.organization_entity_id,t.organization_name
)
select
  g.campaign_id,
  g.organization_entity_id,
  g.organization_name,
  g.target_count,
  g.contradiction_count,
  g.max_rank_score,
  g.target_ids,
  g.target_contexts,
  rq.id as research_question_id,
  rq.stable_key as research_question_key,
  la.research_attempt_id as latest_attempt_id,
  la.attempted_at as latest_attempted_at,
  la.outcome as latest_attempt_outcome,
  la.evidence_effect as latest_attempt_evidence_effect,
  la.finding_summary as latest_attempt_summary,
  la.revisit_after,
  qg.id as question_gap_id,
  qg.status as question_gap_status,
  case
    when g.contradiction_count > 0 and la.revisit_after is not null and la.revisit_after > now()
      then 'legacy_reconciliation_wait'
    when g.contradiction_count > 0
      then 'legacy_claim_reconciliation'
    when la.revisit_after is not null and la.revisit_after > now()
      then 'recent_unresolved_wait'
    else 'research_needed'
  end as queue_state,
  case
    when g.contradiction_count > 0 and la.revisit_after is not null and la.revisit_after > now()
      then 'human_review_legacy_claim_or_wait_for_new_material_evidence'
    when g.contradiction_count > 0
      then 'execute_external_space_use_research_contract_for_legacy_reconciliation'
    when la.revisit_after is not null and la.revisit_after > now()
      then 'wait_until_revisit_or_new_material_evidence'
    else 'execute_external_space_use_research_contract'
  end as next_action
from grouped g
join local_intel.research_questions rq
  on rq.stable_key='external_space_use' and rq.version=1 and rq.status='active'
left join lateral (
  select x.*
  from local_intel.v_latest_scoped_research_attempt_v1 x
  where x.entity_id=g.organization_entity_id
    and x.research_kind='external_space_use_resolution'
    and x.offering_id is null
    and x.use_case_id is null
  limit 1
) la on true
left join lateral (
  select q.*
  from local_intel.question_gaps q
  where q.entity_id=g.organization_entity_id
    and q.question_key='external_space_use'
    and (q.metadata->>'campaign_id')=g.campaign_id::text
  order by (q.status='open') desc,q.created_at desc
  limit 1
) qg on true;

create index if not exists question_gaps_external_space_campaign_open_idx
  on local_intel.question_gaps(entity_id,((metadata->>'campaign_id')))
  where question_key='external_space_use' and status='open';

create or replace function local_intel.sync_campaign_external_space_research_gaps_v2(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, local_intel
as $$
declare
  v_updated integer := 0;
  v_inserted integer := 0;
  v_closed integer := 0;
begin
  with q as (
    select *
    from local_intel.v_campaign_external_space_research_queue_v2
    where campaign_id=p_campaign_id
  ), updated as (
    update local_intel.question_gaps g
    set gap_kind=case when q.contradiction_count>0 then 'external_space_fit_reconciliation' else 'external_space_fit_missing' end,
        priority=case when q.contradiction_count>0 then 5 else greatest(1,least(5,ceil(coalesce(q.max_rank_score,0)/30.0)::integer)) end,
        status='open',
        reason=case
          when q.contradiction_count>0 then format('%s legacy fit claim(s) exceed canonical evidence; %s campaign target row(s) require organization-level external-space reconciliation/research before fit can be trusted.',q.contradiction_count,q.target_count)
          else format('%s campaign target row(s) require external-space-use evidence before venue-fit adjudication.',q.target_count)
        end,
        recommended_acquisition=case
          when q.queue_state in ('legacy_claim_reconciliation','research_needed') then 'governed_external_space_research'
          else q.next_action
        end,
        metadata=g.metadata || jsonb_build_object(
          'campaign_id',q.campaign_id,
          'target_ids',q.target_ids,
          'target_contexts',q.target_contexts,
          'contradiction_count',q.contradiction_count,
          'queue_state',q.queue_state,
          'next_action',q.next_action,
          'dedupe_scope','organization_once_then_use_case_adjudication',
          'last_synced_by','sync_campaign_external_space_research_gaps_v2',
          'last_synced_at',now()
        ),
        updated_at=now()
    from q
    where g.entity_id=q.organization_entity_id
      and g.question_key='external_space_use'
      and g.status='open'
      and (g.metadata->>'campaign_id')=q.campaign_id::text
    returning g.id
  )
  select count(*) into v_updated from updated;

  with q as (
    select *
    from local_intel.v_campaign_external_space_research_queue_v2
    where campaign_id=p_campaign_id
  ), inserted as (
    insert into local_intel.question_gaps(
      question_key,object_type,entity_id,gap_kind,priority,status,reason,recommended_acquisition,metadata
    )
    select
      'external_space_use','entity',q.organization_entity_id,
      case when q.contradiction_count>0 then 'external_space_fit_reconciliation' else 'external_space_fit_missing' end,
      case when q.contradiction_count>0 then 5 else greatest(1,least(5,ceil(coalesce(q.max_rank_score,0)/30.0)::integer)) end,
      'open',
      case
        when q.contradiction_count>0 then format('%s legacy fit claim(s) exceed canonical evidence; %s campaign target row(s) require organization-level external-space reconciliation/research before fit can be trusted.',q.contradiction_count,q.target_count)
        else format('%s campaign target row(s) require external-space-use evidence before venue-fit adjudication.',q.target_count)
      end,
      case when q.queue_state in ('legacy_claim_reconciliation','research_needed') then 'governed_external_space_research' else q.next_action end,
      jsonb_build_object(
        'campaign_id',q.campaign_id,
        'target_ids',q.target_ids,
        'target_contexts',q.target_contexts,
        'contradiction_count',q.contradiction_count,
        'queue_state',q.queue_state,
        'next_action',q.next_action,
        'dedupe_scope','organization_once_then_use_case_adjudication',
        'created_by','sync_campaign_external_space_research_gaps_v2'
      )
    from q
    where not exists (
      select 1 from local_intel.question_gaps g
      where g.entity_id=q.organization_entity_id
        and g.question_key='external_space_use'
        and g.status='open'
        and (g.metadata->>'campaign_id')=q.campaign_id::text
    )
    returning id
  )
  select count(*) into v_inserted from inserted;

  with closed as (
    update local_intel.question_gaps g
    set status='resolved',
        metadata=g.metadata || jsonb_build_object(
          'resolved_by','sync_campaign_external_space_research_gaps_v2',
          'resolved_at',now(),
          'resolution_reason','organization_no_longer_has_external_space_research_or_legacy_reconciliation_targets'
        ),
        updated_at=now()
    where g.question_key='external_space_use'
      and g.status='open'
      and (g.metadata->>'campaign_id')=p_campaign_id::text
      and not exists (
        select 1
        from local_intel.v_campaign_external_space_research_queue_v2 q
        where q.campaign_id=p_campaign_id
          and q.organization_entity_id=g.entity_id
      )
    returning g.id
  )
  select count(*) into v_closed from closed;

  return jsonb_build_object(
    'campaign_id',p_campaign_id,
    'updated',v_updated,
    'inserted',v_inserted,
    'closed',v_closed,
    'queue_organizations',(select count(*) from local_intel.v_campaign_external_space_research_queue_v2 where campaign_id=p_campaign_id)
  );
end;
$$;

revoke all on local_intel.v_campaign_target_fit_reconciliation_queue_v1 from public,anon,authenticated;
revoke all on local_intel.v_campaign_external_space_research_queue_v2 from public,anon,authenticated;
grant select on local_intel.v_campaign_target_fit_reconciliation_queue_v1 to service_role;
grant select on local_intel.v_campaign_external_space_research_queue_v2 to service_role;

revoke all on function local_intel.sync_campaign_external_space_research_gaps_v2(uuid) from public,anon,authenticated;
grant execute on function local_intel.sync_campaign_external_space_research_gaps_v2(uuid) to service_role;