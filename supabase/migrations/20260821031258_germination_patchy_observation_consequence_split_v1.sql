create or replace function atlas.germination_target_spacing_for_task_v1(
  p_task_id uuid,
  p_supplied_target numeric default null
)
returns numeric
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_metadata jsonb;
  v_in_row numeric;
  v_target numeric;
  v_profile_id uuid;
  v_profile_key text;
begin
  select
    case
      when coalesce(t.metadata->>'crop_profile_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (t.metadata->>'crop_profile_id')::uuid
      else null
    end,
    nullif(t.metadata->>'crop_profile_stable_key','')
  into v_profile_id, v_profile_key
  from atlas.tasks t
  where t.id=p_task_id;

  if v_profile_id is not null then
    select cp.metadata, cp.in_row_spacing_in
    into v_metadata, v_in_row
    from atlas.crop_profiles cp
    where cp.id=v_profile_id;
  elsif v_profile_key is not null then
    select cp.metadata, cp.in_row_spacing_in
    into v_metadata, v_in_row
    from atlas.crop_profiles cp
    where cp.stable_key=v_profile_key
    limit 1;
  end if;

  v_target := coalesce(
    case
      when coalesce(v_metadata->>'target_spacing_inches','') ~ '^\d+(\.\d+)?$'
        then (v_metadata->>'target_spacing_inches')::numeric
      else null
    end,
    v_in_row,
    p_supplied_target
  );

  if v_target is null or v_target<=0 or v_target>120 then
    raise exception 'Atlas needs a valid crop target spacing before it can interpret a patchy stand.' using errcode='22023';
  end if;

  return v_target;
end;
$$;

revoke all on function atlas.germination_target_spacing_for_task_v1(uuid,numeric) from public, anon, authenticated;

create or replace function atlas.normalize_patchy_germination_result_v1(
  p_farm_id uuid,
  p_task_id uuid,
  p_target_spacing_inches numeric,
  p_observed_gap_inches numeric,
  p_patch_required boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_truth jsonb;
  v_transition_id uuid;
  v_field_log_id uuid;
  v_outcome_id uuid;
  v_old_note text;
  v_truthful_note text;
  v_phrase text;
begin
  if p_farm_id is null or p_task_id is null then
    raise exception 'Farm and germination task are required.' using errcode='22023';
  end if;
  if p_target_spacing_inches is null or p_target_spacing_inches<=0 or p_target_spacing_inches>120 then
    raise exception 'A valid target spacing is required.' using errcode='22023';
  end if;
  if p_observed_gap_inches is null or p_observed_gap_inches<=0 or p_observed_gap_inches>120 then
    raise exception 'A valid observed gap is required.' using errcode='22023';
  end if;

  v_truth := jsonb_build_object(
    'germination_observation','patchy',
    'germination_stand_condition','patchy',
    'stand_condition','patchy',
    'observed_gap_inches',p_observed_gap_inches,
    'target_spacing_inches',p_target_spacing_inches,
    'patch_required',p_patch_required,
    'management_consequence',case when p_patch_required then 'patch' else 'none' end,
    'spacing_action_required',case when p_patch_required then 'patch' else null end,
    'spacing_measurement_kind','observed_gap_against_crop_target'
  );

  select tt.id,tt.field_log_id,tt.task_outcome_event_id,tt.note
  into v_transition_id,v_field_log_id,v_outcome_id,v_old_note
  from atlas.task_transitions tt
  where tt.farm_id=p_farm_id
    and tt.task_id=p_task_id
    and tt.idempotency_key='germination:done:'||p_task_id::text
    and coalesce((tt.payload->>'retracted')::boolean,false)=false
  order by tt.created_at desc,tt.id desc
  limit 1;

  v_phrase := case
    when p_patch_required then 'patchy stand; patch seeding required'
    else 'patchy stand; no patching required'
  end;
  v_truthful_note := case
    when v_old_note is null then
      'Patchy germination recorded · '||trim(to_char(p_observed_gap_inches,'FM999990.##'))||'-inch gaps · '
      ||trim(to_char(p_target_spacing_inches,'FM999990.##'))||'-inch target · '
      ||case when p_patch_required then 'patch seeding required' else 'no patching required' end
    else regexp_replace(
      v_old_note,
      '(sparse stand; patch seeding required|stand on target; no action required)',
      v_phrase,
      'i'
    )
  end;

  update atlas.tasks t
  set metadata = case
      when coalesce(t.metadata,'{}'::jsonb) ? 'last_transition'
        then jsonb_set(coalesce(t.metadata,'{}'::jsonb)||v_truth,'{last_transition,note}',to_jsonb(v_truthful_note),true)
      else coalesce(t.metadata,'{}'::jsonb)||v_truth
    end,
    note = case when t.note=v_old_note then v_truthful_note else t.note end,
    updated_at=now()
  where t.id=p_task_id and t.farm_id=p_farm_id;

  update atlas.crop_cycles cc
  set metadata=coalesce(cc.metadata,'{}'::jsonb)||v_truth,
      updated_at=now()
  where cc.farm_id=p_farm_id
    and cc.id in (select tcc.crop_cycle_id from atlas.task_crop_cycles tcc where tcc.task_id=p_task_id);

  update atlas.object_state os
  set metadata=coalesce(os.metadata,'{}'::jsonb)||v_truth,
      updated_at=now()
  where os.farm_id=p_farm_id
    and os.object_id in (select tro.object_id from atlas.task_objects tro where tro.task_id=p_task_id);

  if v_transition_id is not null then
    update atlas.task_transitions
    set note=v_truthful_note,
        payload=coalesce(payload,'{}'::jsonb)||v_truth
    where id=v_transition_id;
  end if;

  if v_outcome_id is not null then
    update atlas.task_outcome_events
    set note=v_truthful_note,
        metadata=coalesce(metadata,'{}'::jsonb)||v_truth
    where id=v_outcome_id;
  end if;

  if v_field_log_id is not null then
    update atlas.field_logs
    set note=v_truthful_note,
        metadata=coalesce(metadata,'{}'::jsonb)||v_truth,
        updated_at=now()
    where id=v_field_log_id;
  end if;
end;
$$;

revoke all on function atlas.normalize_patchy_germination_result_v1(uuid,uuid,numeric,numeric,boolean) from public, anon, authenticated;

create or replace function atlas.record_germination_observation_for_member_v4(
  p_farm_id uuid,
  p_task_id uuid,
  p_task_title text default null,
  p_action text default null,
  p_stand_condition text default null,
  p_spacing_outcome text default null,
  p_target_spacing_inches numeric default null,
  p_observed_gap_inches numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_stand_condition text:=lower(btrim(coalesce(p_stand_condition,'')));
  v_role text;
  v_membership_id uuid;
  v_task atlas.tasks%rowtype;
  v_target numeric;
  v_patch_required boolean;
  v_legacy_outcome text;
  v_base jsonb;
begin
  if v_stand_condition<>'patchy' then
    return atlas.record_germination_observation_for_member_v3(
      p_farm_id,p_task_id,p_task_title,p_action,p_spacing_outcome,p_target_spacing_inches,p_note
    );
  end if;

  if v_action<>'germinated' then
    raise exception 'Patchy is a germinated stand observation.' using errcode='22023';
  end if;

  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership_id:=atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=p_farm_id
  for update;
  if v_task.id is null then raise exception 'Germination check task was not found.' using errcode='P0002'; end if;
  if v_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id<>v_membership_id) then
    raise exception 'This germination task is not assigned to the signed-in Farm Hand.' using errcode='42501';
  end if;

  v_target:=atlas.germination_target_spacing_for_task_v1(p_task_id,p_target_spacing_inches);
  if p_observed_gap_inches is null or p_observed_gap_inches<=0 or p_observed_gap_inches>120 then
    raise exception 'Patchy requires an observed gap size.' using errcode='22023';
  end if;

  v_patch_required:=p_observed_gap_inches >= v_target*3;
  v_legacy_outcome:=case when v_patch_required then 'patch' else 'on_target' end;

  v_base:=atlas.record_germination_observation_for_member_v3(
    p_farm_id,p_task_id,p_task_title,'germinated',v_legacy_outcome,v_target,p_note
  );
  perform atlas.normalize_patchy_germination_result_v1(
    p_farm_id,p_task_id,v_target,p_observed_gap_inches,v_patch_required
  );

  return v_base||jsonb_build_object(
    'standCondition','patchy',
    'observedGapInches',p_observed_gap_inches,
    'targetSpacingInches',v_target,
    'patchRequired',v_patch_required,
    'managementConsequence',case when v_patch_required then 'patch' else 'none' end
  );
end;
$$;

create or replace function atlas.owner_operator_record_germination_observation_v4(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_action text,
  p_stand_condition text default null,
  p_spacing_outcome text default null,
  p_target_spacing_inches numeric default null,
  p_observed_gap_inches numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_stand_condition text:=lower(btrim(coalesce(p_stand_condition,'')));
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_target numeric;
  v_patch_required boolean;
  v_legacy_outcome text;
  v_base jsonb;
begin
  if v_stand_condition<>'patchy' then
    return atlas.owner_operator_record_germination_observation_v3(
      p_effective_membership_id,p_task_id,p_action,p_spacing_outcome,p_target_spacing_inches,p_note
    );
  end if;

  if v_action<>'germinated' then
    raise exception 'Patchy is a germinated stand observation.' using errcode='22023';
  end if;

  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=(v_context->>'farmId')::uuid;
  v_membership_id:=(v_context#>>'{effective,membershipId}')::uuid;
  v_role:=v_context#>>'{effective,role}';
  if v_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record germination.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=v_farm_id
  for update;
  if v_task.id is null then raise exception 'Germination check task was not found.' using errcode='P0002'; end if;
  if v_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id<>v_membership_id) then
    raise exception 'The germination task is not assigned to the selected worker.' using errcode='42501';
  end if;

  v_target:=atlas.germination_target_spacing_for_task_v1(p_task_id,p_target_spacing_inches);
  if p_observed_gap_inches is null or p_observed_gap_inches<=0 or p_observed_gap_inches>120 then
    raise exception 'Patchy requires an observed gap size.' using errcode='22023';
  end if;

  v_patch_required:=p_observed_gap_inches >= v_target*3;
  v_legacy_outcome:=case when v_patch_required then 'patch' else 'on_target' end;

  v_base:=atlas.owner_operator_record_germination_observation_v3(
    p_effective_membership_id,p_task_id,'germinated',v_legacy_outcome,v_target,p_note
  );
  perform atlas.normalize_patchy_germination_result_v1(
    v_farm_id,p_task_id,v_target,p_observed_gap_inches,v_patch_required
  );

  return v_base||jsonb_build_object(
    'standCondition','patchy',
    'observedGapInches',p_observed_gap_inches,
    'targetSpacingInches',v_target,
    'patchRequired',v_patch_required,
    'managementConsequence',case when v_patch_required then 'patch' else 'none' end,
    'operatorMode',true,
    'effectiveMembershipId',v_membership_id
  );
end;
$$;

revoke all on function atlas.record_germination_observation_for_member_v4(uuid,uuid,text,text,text,text,numeric,numeric,text) from public, anon;
grant execute on function atlas.record_germination_observation_for_member_v4(uuid,uuid,text,text,text,text,numeric,numeric,text) to authenticated, service_role;

revoke all on function atlas.owner_operator_record_germination_observation_v4(uuid,uuid,text,text,text,numeric,numeric,text) from public, anon;
grant execute on function atlas.owner_operator_record_germination_observation_v4(uuid,uuid,text,text,text,numeric,numeric,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at,anonymous_execute_expected
) values
(
  'atlas.record_germination_observation_for_member_v4(uuid, uuid, text, text, text, text, numeric, numeric, text)',
  'app_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'caller','POST /api/atlas/germination-check',
    'purpose','Record germination observations while separating the observed stand condition from the corrective management consequence.',
    'truthBoundary','Patchy remains Patchy. Observed gap size decides whether patch seeding is required; a small Patchy gap does not become an on-target observation.',
    'authorizationBoundary','Active farm membership and assigned-worker scope are verified before consequence calculation and mutation.'
  ),now(),false
),
(
  'atlas.owner_operator_record_germination_observation_v4(uuid, uuid, text, text, text, numeric, numeric, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'caller','POST /api/atlas/germination-check in operator mode',
    'purpose','Provide operator-mode parity for germination observations with independent Patchy observation and patching consequence.',
    'truthBoundary','Operator mode changes actor context only. Patchy remains the observation; observed gap size determines management action.',
    'authorizationBoundary','The selected effective membership, role, farm, and assignment are verified before mutation.'
  ),now(),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at,
  anonymous_execute_expected=excluded.anonymous_execute_expected;

update atlas.task_transitions tt
set idempotency_key=left(tt.idempotency_key||':retracted:'||replace(tt.id::text,'-',''),160),
    payload=coalesce(tt.payload,'{}'::jsonb)||jsonb_build_object('released_idempotency_key',tt.idempotency_key,'released_idempotency_key_at',now())
where tt.idempotency_key like 'germination:done:%'
  and coalesce((tt.payload->>'retracted')::boolean,false)=true;
