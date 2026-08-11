-- Owner Day atomic commit v2
-- Cue edits belong to the same purple draft as work placement and added work.
-- Existing focused cue/edit/schedule RPCs remain compatibility boundaries.

create or replace function atlas.owner_commit_worker_day_choreography_api_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_edits jsonb default '[]'::jsonb,
  p_selections jsonb default '[]'::jsonb,
  p_cue_edits jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_work_result jsonb:='{}'::jsonb;
  v_cue_results jsonb:='[]'::jsonb;
  v_cue_edit jsonb;
  v_cue_result jsonb;
  v_kind text;
  v_cue_id uuid;
  v_edit_count integer;
  v_selection_count integer;
  v_cue_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_edits,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_selections,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_cue_edits,'[]'::jsonb))<>'array' then
    raise exception 'Day edits, selections, and cue edits must be arrays.' using errcode='22023';
  end if;

  v_edit_count:=jsonb_array_length(coalesce(p_edits,'[]'::jsonb));
  v_selection_count:=jsonb_array_length(coalesce(p_selections,'[]'::jsonb));
  v_cue_count:=jsonb_array_length(coalesce(p_cue_edits,'[]'::jsonb));
  if v_edit_count=0 and v_selection_count=0 and v_cue_count=0 then
    raise exception 'Choose at least one Day change.' using errcode='22023';
  end if;
  if v_edit_count>100 or v_selection_count>40 or v_cue_count>40 then
    raise exception 'Too many Day changes.' using errcode='22023';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
      and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_day_atomic_commit_v2',0)
  );

  if v_edit_count>0 or v_selection_count>0 then
    v_work_result:=atlas.owner_commit_worker_day_choreography_api_v1(
      p_farm_id,
      p_membership_id,
      p_day,
      p_edits,
      p_selections
    );
  end if;

  for v_cue_edit in
    select value from jsonb_array_elements(coalesce(p_cue_edits,'[]'::jsonb))
  loop
    if jsonb_typeof(v_cue_edit)<>'object' then
      raise exception 'Each cue edit must be an object.' using errcode='22023';
    end if;
    v_kind:=nullif(v_cue_edit->>'kind','');

    if v_kind='upsert' then
      if jsonb_typeof(v_cue_edit->'cue')<>'object' then
        raise exception 'Cue upsert data is required.' using errcode='22023';
      end if;
      v_cue_result:=atlas.owner_upsert_worker_day_cue_api_v1(
        p_farm_id,
        p_membership_id,
        v_cue_edit->'cue'
      );
    elsif v_kind='delete' then
      begin
        v_cue_id:=nullif(v_cue_edit->>'cueId','')::uuid;
      exception when invalid_text_representation then
        raise exception 'Cue id is invalid.' using errcode='22023';
      end;
      if v_cue_id is null then
        raise exception 'Cue id is required.' using errcode='22023';
      end if;
      if not exists (
        select 1 from atlas.worker_day_cues cue
        where cue.id=v_cue_id
          and cue.farm_id=p_farm_id
          and cue.membership_id=p_membership_id
      ) then
        raise exception 'Cue is outside this worker Day.' using errcode='55000';
      end if;
      v_cue_result:=atlas.owner_delete_worker_day_cue_api_v1(v_cue_id);
    else
      raise exception 'Unsupported cue edit kind.' using errcode='22023';
    end if;

    v_cue_results:=v_cue_results||jsonb_build_array(v_cue_result);
  end loop;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_atomic_commit_v2',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'editCount',v_edit_count,
    'selectionCount',v_selection_count,
    'cueEditCount',v_cue_count,
    'work',v_work_result,
    'cues',v_cue_results
  );
end;
$function$;

revoke all on function atlas.owner_commit_worker_day_choreography_api_v2(uuid,uuid,date,jsonb,jsonb,jsonb) from public,anon;
grant execute on function atlas.owner_commit_worker_day_choreography_api_v2(uuid,uuid,date,jsonb,jsonb,jsonb) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
)
values(
  'atlas.owner_commit_worker_day_choreography_api_v2(uuid, uuid, date, jsonb, jsonb, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Commit the complete Owner Day purple draft atomically across work placement, approved additions, and cue edits',
    'boundary','owner-only; cue edits remain scoped to the same target Farm Hand and farm',
    'rollback','any failed work, selection, cue upsert, or cue delete rolls back the complete Day draft',
    'route','/api/atlas/owner-day-commit'
  ),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
