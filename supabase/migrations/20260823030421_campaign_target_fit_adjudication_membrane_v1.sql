create table if not exists local_intel.campaign_target_fit_adjudications (
  id uuid primary key default gen_random_uuid(),
  adjudication_key text not null unique,
  campaign_target_id uuid not null references local_intel.campaign_targets(id) on delete restrict,
  campaign_id uuid not null references local_intel.campaigns(id) on delete restrict,
  organization_entity_id uuid not null references local_intel.entities(id) on delete restrict,
  offering_use_case_id uuid not null references local_intel.offering_use_cases(id) on delete restrict,
  previous_venue_fit_readiness text,
  new_venue_fit_readiness text not null,
  previous_next_best_enrichment text,
  new_next_best_enrichment text,
  derived_evidence_state text not null,
  recommended_adjudication text not null,
  available_evidence_ids uuid[] not null default '{}'::uuid[],
  basis_evidence_ids uuid[] not null,
  basis_evidence_snapshot jsonb not null,
  adjudication_basis text not null,
  adjudication_mode text not null,
  policy_key text not null,
  policy_version integer not null,
  adjudicated_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  write_txid bigint not null default txid_current(),
  adjudicated_at timestamptz not null default now(),
  constraint campaign_target_fit_adjudications_mode_check check (adjudication_mode in ('deterministic_evidence_policy','human_review')),
  constraint campaign_target_fit_adjudications_policy_version_check check (policy_version > 0),
  constraint campaign_target_fit_adjudications_basis_evidence_check check (cardinality(basis_evidence_ids) > 0)
);

create index if not exists campaign_target_fit_adjudications_target_idx
  on local_intel.campaign_target_fit_adjudications(campaign_target_id, adjudicated_at desc);

create index if not exists campaign_target_fit_adjudications_tx_idx
  on local_intel.campaign_target_fit_adjudications(write_txid, campaign_target_id);

create or replace function local_intel.block_campaign_target_fit_adjudication_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, local_intel
as $$
begin
  raise exception 'campaign target fit adjudications are append-only';
end;
$$;

create trigger campaign_target_fit_adjudications_append_only_v1
before update or delete on local_intel.campaign_target_fit_adjudications
for each row execute function local_intel.block_campaign_target_fit_adjudication_mutation_v1();

create or replace function local_intel.enforce_campaign_target_fit_adjudication_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, local_intel
as $$
begin
  if new.venue_fit_readiness is distinct from old.venue_fit_readiness then
    if not exists (
      select 1
      from local_intel.campaign_target_fit_adjudications a
      where a.write_txid = txid_current()
        and a.campaign_target_id = old.id
        and a.previous_venue_fit_readiness is not distinct from old.venue_fit_readiness
        and a.new_venue_fit_readiness is not distinct from new.venue_fit_readiness
        and a.previous_next_best_enrichment is not distinct from old.next_best_enrichment
        and a.new_next_best_enrichment is not distinct from new.next_best_enrichment
    ) then
      raise exception 'venue_fit_readiness may change only through governed target-fit adjudication';
    end if;
  end if;
  return new;
end;
$$;

create trigger campaign_target_fit_adjudication_guard_v1
before update of venue_fit_readiness on local_intel.campaign_targets
for each row execute function local_intel.enforce_campaign_target_fit_adjudication_v1();

create or replace function local_intel.adjudicate_campaign_target_fit_v1(p_payload jsonb)
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
  elsif v_ev.derived_evidence_state in ('context_evidence_only','no_canonical_external_space_evidence','organization_external_evidence_use_case_unresolved') then
    raise exception 'derived evidence state % does not support a target-fit change; continue research or adjudicate use-case scope',v_ev.derived_evidence_state;
  else
    raise exception 'derived evidence state % is not deterministically writable under target-fit adjudication policy v1',v_ev.derived_evidence_state;
  end if;

  if v_target.venue_fit_readiness is not distinct from v_new_fit
     and v_target.next_best_enrichment is not distinct from v_new_next then
    raise exception 'campaign target % already has the adjudicated fit state',v_target_id;
  end if;

  insert into local_intel.campaign_target_fit_adjudications(
    adjudication_key,campaign_target_id,campaign_id,organization_entity_id,offering_use_case_id,
    previous_venue_fit_readiness,new_venue_fit_readiness,previous_next_best_enrichment,new_next_best_enrichment,
    derived_evidence_state,recommended_adjudication,available_evidence_ids,basis_evidence_ids,basis_evidence_snapshot,
    adjudication_basis,adjudication_mode,policy_key,policy_version,adjudicated_by,metadata
  ) values (
    v_key,v_target.id,v_target.campaign_id,v_target.organization_entity_id,v_target.offering_use_case_id,
    v_target.venue_fit_readiness,v_new_fit,v_target.next_best_enrichment,v_new_next,
    v_ev.derived_evidence_state,v_ev.recommended_adjudication,v_available_ids,v_basis_ids,v_basis_snapshot,
    v_basis,'deterministic_evidence_policy','external_space_fit_adjudication',1,'system:external_space_fit_adjudication_v1',
    jsonb_strip_nulls(jsonb_build_object('basis_note',v_note,'requested_metadata',coalesce(p_payload->'metadata','{}'::jsonb)))
  ) returning id into v_id;

  update local_intel.campaign_targets
  set venue_fit_readiness=v_new_fit,
      next_best_enrichment=v_new_next,
      reviewed_at=now(),
      updated_at=now()
  where id=v_target.id;

  return v_id;
end;
$$;

revoke all on local_intel.campaign_target_fit_adjudications from public, anon, authenticated, service_role;
grant select on local_intel.campaign_target_fit_adjudications to service_role;

revoke all on function local_intel.adjudicate_campaign_target_fit_v1(jsonb) from public, anon, authenticated;
grant execute on function local_intel.adjudicate_campaign_target_fit_v1(jsonb) to service_role;

revoke all on function local_intel.block_campaign_target_fit_adjudication_mutation_v1() from public, anon, authenticated, service_role;
revoke all on function local_intel.enforce_campaign_target_fit_adjudication_v1() from public, anon, authenticated, service_role;