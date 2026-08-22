create or replace function atlas.entity_identity_adjudicate_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'local_intel', 'auth', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_principal_id uuid;
  v_review_kind text;
  v_review_id uuid;
  v_decision text;
  v_basis text;
  v_reviewer text;
  v_metadata jsonb;
  v_queue local_intel.v_entity_identity_review_queue_v2%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  v_principal_id := atlas.current_principal_id_v1();
  if v_principal_id is null then
    raise exception 'Principal access required.' using errcode='42501';
  end if;

  if not exists (
    select 1
    from atlas.organization_memberships om
    where om.user_id = v_user_id
      and om.active = true
      and om.role = 'owner'
  ) then
    raise exception 'Organization owner access required.' using errcode='42501';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Review input must be a JSON object.' using errcode='22023';
  end if;
  if p_input ? 'metadata' then
    raise exception 'Caller-supplied adjudication metadata is not accepted.' using errcode='22023';
  end if;

  v_review_kind := nullif(btrim(p_input->>'reviewKind'), '');
  v_decision := nullif(btrim(p_input->>'decision'), '');
  v_basis := nullif(btrim(p_input->>'basis'), '');

  begin
    v_review_id := nullif(btrim(p_input->>'reviewId'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid reviewId is required.' using errcode='22023';
  end;

  if v_review_id is null then
    raise exception 'A valid reviewId is required.' using errcode='22023';
  end if;
  if v_review_kind not in ('ingestion_candidate_match','entity_merge') then
    raise exception 'Unsupported reviewKind.' using errcode='22023';
  end if;
  if v_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode='22023';
  end if;
  if v_basis is null then
    raise exception 'A reviewer basis is required.' using errcode='22023';
  end if;
  if length(v_basis) > 4000 then
    raise exception 'Reviewer basis is too long.' using errcode='22023';
  end if;

  select * into v_queue
  from local_intel.v_entity_identity_review_queue_v2 q
  where q.review_id = v_review_id
    and q.review_kind = v_review_kind;

  if not found then
    raise exception 'This review item is no longer pending.' using errcode='22023';
  end if;

  if v_review_kind = 'entity_merge'
     and v_decision = 'approved'
     and not coalesce(v_queue.approval_ready, false) then
    raise exception 'Merge approval is blocked by the hard-veto membrane.' using errcode='22023';
  end if;

  select coalesce(nullif(btrim(up.display_name), ''), v_user_id::text)
  into v_reviewer
  from atlas.user_profiles up
  where up.user_id = v_user_id;
  v_reviewer := coalesce(v_reviewer, v_user_id::text);

  v_metadata := jsonb_build_object(
    'atlas_review_contract', 'entity_identity_review_v1',
    'authenticated_user_id', v_user_id,
    'principal_id', v_principal_id,
    'review_kind', v_review_kind,
    'review_id', v_review_id,
    'surface', 'principal_entity_identity_review_v1',
    'caller_metadata_accepted', false
  );

  if v_review_kind = 'ingestion_candidate_match' then
    v_result := local_intel.adjudicate_entity_ingestion_match_v1(
      v_review_id,
      v_decision,
      v_reviewer,
      v_basis,
      v_metadata
    );
  else
    v_result := local_intel.adjudicate_entity_merge_decision_v1(
      v_review_id,
      v_decision,
      v_reviewer,
      v_basis,
      v_metadata
    );
  end if;

  return jsonb_build_object(
    'contractVersion', 'entity_identity_review_v1',
    'reviewKind', v_review_kind,
    'reviewId', v_review_id,
    'decision', v_decision,
    'reviewerUserId', v_user_id,
    'canonicalMergeExecuted', false,
    'result', v_result
  );
end;
$$;

comment on function atlas.entity_identity_adjudicate_api_v1(jsonb) is
'Authenticated Principal/organization-owner identity adjudication aperture. Derives reviewer and audit provenance from auth, rejects caller-supplied audit metadata, delegates only to governed local_intel adjudication functions, and never executes canonical merges.';
