begin;

create or replace function atlas.worker_dismiss_day_cue_api_v1(p_cue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_cue atlas.worker_day_cues%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and fm.user_id=auth.uid()
  for update of cue;

  if v_cue.id is null then
    raise exception 'Cue access required.' using errcode='42501';
  end if;

  if v_cue.status='resolved' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_dismissal_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'resolvedAt',v_cue.resolved_at,
      'deduplicated',true
    );
  end if;

  if v_cue.status='dismissed' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_dismissal_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'deduplicated',true
    );
  end if;

  update atlas.worker_day_cues cue
  set status='dismissed',
      updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_dismissal_v1',
    'cueId',v_cue.id,
    'status',v_cue.status,
    'dismissedAt',v_cue.updated_at
  );
end;
$function$;

revoke all on function atlas.worker_dismiss_day_cue_api_v1(uuid) from public, anon;
grant execute on function atlas.worker_dismiss_day_cue_api_v1(uuid) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
values (
  'atlas.worker_dismiss_day_cue_api_v1(uuid)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Persist an assigned worker dismissal of one delivered Day cue',
    'boundary','assigned active farm membership only; Owner operator previews never call this endpoint',
    'resultTruth','dismissed is distinct from resolved and applies no cue result contract'
  ),now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;

commit;
