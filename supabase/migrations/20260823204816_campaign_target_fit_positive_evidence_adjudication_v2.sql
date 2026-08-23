create or replace function local_intel.adjudicate_campaign_target_fit_v2(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, local_intel
as $$
declare
  v_key text := nullif(btrim(p_payload->>'adjudication_key'),'');
  v_target_id uuid;
  v_target local_intel.campaign_targets%rowtype;
  v_ev record;
  v_existing local_intel.campaign_target_fit_adjudications%rowtype;
  v_basis_ids uuid[] := '{}'::uuid[];
  v_available_ids uuid[] := '{}'::uuid[];
  v_basis_snapshot jsonb := '[]'::jsonb;
  v_new_fit text;
  v_new_next text;
  v_basis text;
  v_id uuid;
  v_note text := nullif(btrim(p_payload->>'basis_note'),'');
  v_requires_target_update boolean := false;
begin
  if v_key is null then raise exception 'adjudication_key is required'; end if;
  begin
    v_target_id := (p_payload->>'campaign_target_id')::uuid;
  exception when others then
    raise exception 'campaign_target_id must be UUID';
  end;

  if jsonb_typeof(p_payload->'basis_evidence_ids') is distinct from 'array' then
    raise exception 'basis_evidence_ids must be a non-empty JSON array';
  end if;
  begin
    select coalesce(array_agg(distinct x::uuid order by x::uuid),'{}'::uuid[])
      into v_basis_ids
    from jsonb_array_elements_text(p_payload->'basis_evidence_ids') j(x);
  exception when others then
    raise exception 'basis_evidence_ids must contain only UUID values';
  end;
  if cardinality(v_basis_ids)=0 then raise exception 'basis_evidence_ids must not be empty'; end if;

  select * into v_existing
  from local_intel.campaign_target_fit_adjudications
  where adjudication_key=v_key;
  if found then
    if v_existing.campaign_target_id is distinct from v_target_id
       or v_existing.basis_evidence_ids is distinct from v_basis_ids then
      raise exception 'adjudication_key % already belongs to different immutable adjudication',v_key;
    end if;
    return v_existing.id;
  end if;

  select * into v_target from local_intel.campaign_targets where id=v_target_id for update;
  if not found then raise exception 'unknown campaign target %',v_target_id; end if;

  select * into v_ev
  from local_intel.v_campaign_external_space_target_evidence_v1
  where campaign_target_id=v_target_id;
  if not found then raise exception 'campaign target % has no external-space evidence projection',v_target_id; end if;

  begin
    select coalesce(array_agg(distinct x::uuid order by x::uuid),'{}'::uuid[])
      into v_available_ids
    from jsonb_array_elements_text(coalesce(v_ev.evidence_ids,'[]'::jsonb)) j(x);
  exception when others then
    raise exception 'current evidence projection contains invalid evidence IDs';
  end;

  if not (v_basis_ids <@ v_available_ids) then
    raise exception 'basis_evidence_ids must be a subset of the target current evidence projection';
  end if;

  if exists (
    select 1
    from unnest(v_basis_ids) b(id)
    left join local_intel.organization_external_space_evidence e on e.id=b.id
    where e.id is null
       or e.entity_id is distinct from v_target.organization_entity_id
       or (e.use_case_id is not null and e.use_case_id is distinct from v_target.offering_use_case_id)
  ) then
    raise exception 'basis evidence must belong to the target organization and exact use-case scope or organization-wide scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,
      'evidence_key',e.evidence_key,
      'entity_id',e.entity_id,
      'use_case_id',e.use_case_id,
      'space_mode',e.space_mode,
      'evidence_kind',e.evidence_kind,
      'evidence_effect',e.evidence_effect,
      'observation_date',e.observation_date,
      'source_id',e.source_id,
      'research_attempt_id',e.research_attempt_id,
      'summary',e.summary,
      'observed_at',e.observed_at,
      'created_at',e.created_at
    ) order by e.id),'[]'::jsonb)
    into v_basis_snapshot
  from local_intel.organization_external_space_evidence e
  where e.id=any(v_basis_ids);

  if v_ev.derived_evidence_state='internal_self_supply_evidence_only' then
    if not exists (
      select 1 from local_intel.organization_external_space_evidence e
      where e.id=any(v_basis_ids)
        and e.evidence_effect='supports_internal_self_supply'
        and (e.use_case_id is null or e.use_case_id=v_target.offering_use_case_id)
    ) then
      raise exception 'internal self-supply adjudication requires canonical internal self-supply evidence in the basis';
    end if;
    v_new_fit := 'external_space_fit_needs_exception_evidence';
    v_new_next := 'external_space_exception_check';
    v_basis := 'Canonical internal self-supply evidence exists for this organization/use case. This does not prove that external space is never used; it means external-space fit now requires exception or direct external-use evidence before being treated as supported.';
  elsif v_ev.derived_evidence_state='use_case_external_evidence' then
    if not exists (
      select 1 from local_intel.organization_external_space_evidence e
      where e.id=any(v_basis_ids)
        and e.evidence_effect='supports_external_space_fit'
        and e.space_mode in ('external','mixed')
        and e.use_case_id=v_target.offering_use_case_id
    ) then
      raise exception 'external-space support adjudication requires exact use-case external evidence in the basis';
    end if;
    v_new_fit := 'external_space_fit_supported';
    v_new_next := 'marketing_eligibility_review';
    v_basis := 'Canonical external-space evidence exists for this exact organization/use-case scope. This supports external-space fit for the governed use case; it does not imply that every gathering uses external space or that another use case shares the same fit.';
  elsif v_ev.derived_evidence_state in ('context_evidence_only','no_canonical_external_space_evidence','organization_external_evidence_use_case_unresolved') then
    raise exception 'derived evidence state % does not support a target-fit change or confirmation; continue research or adjudicate use-case scope',v_ev.derived_evidence_state;
  else
    raise exception 'derived evidence state % is not deterministically writable under target-fit adjudication policy v2',v_ev.derived_evidence_state;
  end if;

  v_requires_target_update := v_target.venue_fit_readiness is distinct from v_new_fit
    or v_target.next_best_enrichment is distinct from v_new_next;

  insert into local_intel.campaign_target_fit_adjudications(
    adjudication_key,campaign_target_id,campaign_id,organization_entity_id,offering_use_case_id,
    previous_venue_fit_readiness,new_venue_fit_readiness,previous_next_best_enrichment,new_next_best_enrichment,
    derived_evidence_state,recommended_adjudication,available_evidence_ids,basis_evidence_ids,basis_evidence_snapshot,
    adjudication_basis,adjudication_mode,policy_key,policy_version,adjudicated_by,metadata
  ) values (
    v_key,v_target.id,v_target.campaign_id,v_target.organization_entity_id,v_target.offering_use_case_id,
    v_target.venue_fit_readiness,v_new_fit,v_target.next_best_enrichment,v_new_next,
    v_ev.derived_evidence_state,v_ev.recommended_adjudication,v_available_ids,v_basis_ids,v_basis_snapshot,
    v_basis,'deterministic_evidence_policy','external_space_fit_adjudication',2,'system:external_space_fit_adjudication_v2',
    jsonb_strip_nulls(jsonb_build_object(
      'basis_note',v_note,
      'state_change_required',v_requires_target_update,
      'requested_metadata',coalesce(p_payload->'metadata','{}'::jsonb)
    ))
  ) returning id into v_id;

  if v_requires_target_update then
    update local_intel.campaign_targets
    set venue_fit_readiness=v_new_fit,
        next_best_enrichment=v_new_next,
        reviewed_at=now(),
        updated_at=now()
    where id=v_target.id;
  end if;

  return v_id;
end;
$$;

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
       and not (
         a.id is not null
         and a.new_venue_fit_readiness is not distinct from tev.venue_fit_readiness
         and a.derived_evidence_state = 'use_case_external_evidence'
       )
        then 'adjudication_ready_external_space'
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
    when 'adjudication_ready_external_space' then 4
    when 'use_case_scope_adjudication_needed' then 4
    when 'legacy_state_needs_provenance' then 4
    when 'research_needed' then greatest(1,least(5,ceil(coalesce(b.rank_score,0)/30.0)::integer))
    else 1
  end as reconciliation_priority,
  case b.queue_state
    when 'legacy_claim_reconciliation' then 'execute_organization_external_space_research_then_governed_reconciliation'
    when 'adjudication_ready_internal_self_supply' then 'adjudicate_target_fit_from_internal_self_supply_evidence_v2'
    when 'adjudication_ready_external_space' then 'adjudicate_target_fit_from_exact_external_use_evidence_v2'
    when 'use_case_scope_adjudication_needed' then 'adjudicate_external_evidence_use_case_scope'
    when 'legacy_state_needs_provenance' then 'reconstruct_or_adjudicate_legacy_fit_provenance'
    when 'research_needed' then 'execute_organization_external_space_research_contract'
    else null
  end as next_action
from base b
where b.queue_state is not null;

revoke all on function local_intel.adjudicate_campaign_target_fit_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function local_intel.adjudicate_campaign_target_fit_v2(jsonb) to service_role;

revoke all on local_intel.v_campaign_target_fit_reconciliation_queue_v1 from public,anon,authenticated;
grant select on local_intel.v_campaign_target_fit_reconciliation_queue_v1 to service_role;