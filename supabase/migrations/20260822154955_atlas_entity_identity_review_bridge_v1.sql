create or replace function atlas.entity_identity_review_queue_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'local_intel', 'auth', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_principal_id uuid;
  v_items jsonb;
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

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.recommended_at, q.review_kind, q.review_id),
    '[]'::jsonb
  )
  into v_items
  from local_intel.v_entity_identity_review_queue_v2 q;

  return jsonb_build_object(
    'contractVersion', 'entity_identity_review_v1',
    'state', case when jsonb_array_length(v_items)=0 then 'clear' else 'review_required' end,
    'pendingCount', jsonb_array_length(v_items),
    'reviewerUserId', v_user_id,
    'principalId', v_principal_id,
    'items', v_items,
    'truthBoundary', jsonb_build_object(
      'humanAdjudicationRequired', true,
      'rawMutationExposed', false,
      'approvalIsCanonicalMergeExecution', false,
      'canonicalMergeExecutionAvailableHere', false
    )
  );
end;
$$;

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
  if p_input ? 'metadata' and jsonb_typeof(p_input->'metadata') <> 'object' then
    raise exception 'metadata must be a JSON object.' using errcode='22023';
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

  v_metadata := coalesce(p_input->'metadata', '{}'::jsonb)
    || jsonb_build_object(
      'atlas_review_contract', 'entity_identity_review_v1',
      'authenticated_user_id', v_user_id,
      'principal_id', v_principal_id,
      'review_kind', v_review_kind,
      'review_id', v_review_id
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

revoke all on function atlas.entity_identity_review_queue_api_v1() from public, anon;
revoke all on function atlas.entity_identity_adjudicate_api_v1(jsonb) from public, anon;
grant execute on function atlas.entity_identity_review_queue_api_v1() to authenticated, service_role;
grant execute on function atlas.entity_identity_adjudicate_api_v1(jsonb) to authenticated, service_role;

comment on function atlas.entity_identity_review_queue_api_v1() is
'Authenticated Principal/organization-owner read aperture over local_intel.v_entity_identity_review_queue_v2. Exposes no raw mutation capability.';
comment on function atlas.entity_identity_adjudicate_api_v1(jsonb) is
'Authenticated Principal/organization-owner identity adjudication aperture. Derives reviewer identity from auth and delegates only to governed local_intel adjudication functions; never executes canonical merges.';
