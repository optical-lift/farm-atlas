create or replace function atlas.worker_record_transplant_readiness_v1(
  p_task_id uuid,
  p_action text,
  p_ready_count integer,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_role text;
  v_membership_id uuid;
  v_action text := lower(coalesce(nullif(btrim(p_action), ''), ''));
  v_count integer;
  v_now timestamptz := now();
  v_entry jsonb;
  v_history jsonb;
  v_transition text;
  v_result jsonb;
  v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'transplant-readiness:' || p_task_id::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
begin
  select * into v_task from atlas.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Transplant readiness task was not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if v_role not in ('farm_hand', 'manager')
    or v_membership_id is null
    or v_task.visibility_scope <> 'assigned_worker'
    or v_task.assigned_membership_id <> v_membership_id
  then
    raise exception 'This readiness task is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  if v_task.task_type <> 'transplant_readiness'
    and coalesce(v_task.metadata ->> 'task_style', '') <> 'transplant_readiness'
    and lower(coalesce(v_task.metadata ->> 'requires_transplant_readiness_check', 'false')) not in ('true','yes','1')
  then
    raise exception 'This task is not a transplant-readiness check.' using errcode = '22023';
  end if;

  if v_action not in ('ready', 'failed') then
    raise exception 'Choose ready or failed.' using errcode = '22023';
  end if;
  if v_action = 'ready' and (p_ready_count is null or p_ready_count < 1) then
    raise exception 'Enter how many seedlings are transplant-ready.' using errcode = '22023';
  end if;
  if p_ready_count is not null and p_ready_count < 0 then
    raise exception 'Seedling count cannot be negative.' using errcode = '22023';
  end if;

  v_count := case when v_action = 'failed' then 0 else p_ready_count end;
  v_entry := jsonb_build_object(
    'status', v_action,
    'ready_count', v_count,
    'note', nullif(btrim(p_note), ''),
    'recorded_at', v_now,
    'actor_membership_id', v_membership_id,
    'actor_user_id', auth.uid()
  );
  v_history := case
    when jsonb_typeof(coalesce(v_task.metadata, '{}'::jsonb) -> 'transplant_readiness_history') = 'array'
      then coalesce(v_task.metadata, '{}'::jsonb) -> 'transplant_readiness_history'
    else '[]'::jsonb
  end;

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'transplant_ready_seedlings', v_count,
        'transplant_readiness_status', v_action,
        'transplant_readiness', v_entry,
        'transplant_readiness_history', v_history || jsonb_build_array(v_entry),
        'crop_loss', v_action = 'failed',
        'crop_loss_reason', case when v_action = 'failed' then nullif(btrim(p_note), '') else null end
      ),
      updated_at = v_now
  where id = v_task.id;

  v_transition := case when v_task.status = 'done' then 'note' else 'done' end;
  v_result := atlas.worker_record_task_transition_v1(
    p_task_id => v_task.id,
    p_transition => v_transition,
    p_idempotency_key => v_key,
    p_note => null,
    p_reason => null,
    p_payload => jsonb_build_object(
      'completion_source', 'transplant_readiness',
      'transplant_readiness_status', v_action,
      'ready_count', v_count,
      'readiness_note', nullif(btrim(p_note), ''),
      'readiness_revision', v_task.status = 'done'
    ),
    p_lane_key => coalesce(v_task.action_key, 'check'),
    p_work_key => 'transplant_readiness'
  );

  return v_result || jsonb_build_object(
    'readinessStatus', v_action,
    'readyCount', v_count,
    'revised', v_task.status = 'done'
  );
end;
$function$;

create or replace function atlas.owner_operator_record_transplant_readiness_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_action text,
  p_ready_count integer,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_effective_membership_id uuid;
  v_effective_role text;
  v_visible boolean := false;
  v_action text := lower(coalesce(nullif(btrim(p_action), ''), ''));
  v_count integer;
  v_now timestamptz := now();
  v_entry jsonb;
  v_history jsonb;
  v_transition text;
  v_result jsonb;
  v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'transplant-readiness:' || p_task_id::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_effective_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_effective_role := v_context #>> '{effective,role}';

  select * into v_task from atlas.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Transplant readiness task was not found.' using errcode = 'P0002';
  end if;
  if v_task.farm_id <> (v_context ->> 'farmId')::uuid then
    raise exception 'The readiness task is outside the operated farm.' using errcode = '42501';
  end if;

  v_visible := case
    when v_effective_role = 'owner' then v_task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared')
    when v_effective_role = 'manager' then v_task.visibility_scope in ('management', 'farm_shared') or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
    else v_task.visibility_scope = 'farm_shared' or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
  end;
  if not v_visible then
    raise exception 'The readiness task is not visible in the selected worker context.' using errcode = '42501';
  end if;

  if v_task.task_type <> 'transplant_readiness'
    and coalesce(v_task.metadata ->> 'task_style', '') <> 'transplant_readiness'
    and lower(coalesce(v_task.metadata ->> 'requires_transplant_readiness_check', 'false')) not in ('true','yes','1')
  then
    raise exception 'This task is not a transplant-readiness check.' using errcode = '22023';
  end if;

  if v_action not in ('ready', 'failed') then
    raise exception 'Choose ready or failed.' using errcode = '22023';
  end if;
  if v_action = 'ready' and (p_ready_count is null or p_ready_count < 1) then
    raise exception 'Enter how many seedlings are transplant-ready.' using errcode = '22023';
  end if;
  if p_ready_count is not null and p_ready_count < 0 then
    raise exception 'Seedling count cannot be negative.' using errcode = '22023';
  end if;

  v_count := case when v_action = 'failed' then 0 else p_ready_count end;
  v_entry := jsonb_build_object(
    'status', v_action,
    'ready_count', v_count,
    'note', nullif(btrim(p_note), ''),
    'recorded_at', v_now,
    'actor_membership_id', (v_context #>> '{actor,membershipId}')::uuid,
    'actor_user_id', auth.uid(),
    'effective_membership_id', v_effective_membership_id
  );
  v_history := case
    when jsonb_typeof(coalesce(v_task.metadata, '{}'::jsonb) -> 'transplant_readiness_history') = 'array'
      then coalesce(v_task.metadata, '{}'::jsonb) -> 'transplant_readiness_history'
    else '[]'::jsonb
  end;

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'transplant_ready_seedlings', v_count,
        'transplant_readiness_status', v_action,
        'transplant_readiness', v_entry,
        'transplant_readiness_history', v_history || jsonb_build_array(v_entry),
        'crop_loss', v_action = 'failed',
        'crop_loss_reason', case when v_action = 'failed' then nullif(btrim(p_note), '') else null end
      ),
      updated_at = v_now
  where id = v_task.id;

  v_transition := case when v_task.status = 'done' then 'note' else 'done' end;
  v_result := atlas.owner_operator_record_task_transition_v1(
    p_effective_membership_id => v_effective_membership_id,
    p_task_id => v_task.id,
    p_transition => v_transition,
    p_idempotency_key => v_key,
    p_target_date => null,
    p_note => null,
    p_reason => null,
    p_lane_key => coalesce(v_task.action_key, 'check'),
    p_work_key => 'transplant_readiness',
    p_payload => jsonb_build_object(
      'completion_source', 'transplant_readiness',
      'transplant_readiness_status', v_action,
      'ready_count', v_count,
      'readiness_note', nullif(btrim(p_note), ''),
      'readiness_revision', v_task.status = 'done'
    )
  );

  return v_result || jsonb_build_object(
    'readinessStatus', v_action,
    'readyCount', v_count,
    'revised', v_task.status = 'done'
  );
end;
$function$;

revoke all on function atlas.worker_record_transplant_readiness_v1(uuid,text,integer,text,text) from public;
revoke all on function atlas.owner_operator_record_transplant_readiness_v1(uuid,uuid,text,integer,text,text) from public;
grant execute on function atlas.worker_record_transplant_readiness_v1(uuid,text,integer,text,text) to authenticated;
grant execute on function atlas.owner_operator_record_transplant_readiness_v1(uuid,uuid,text,integer,text,text) to authenticated;
grant execute on function atlas.worker_record_transplant_readiness_v1(uuid,text,integer,text,text) to service_role;
grant execute on function atlas.owner_operator_record_transplant_readiness_v1(uuid,uuid,text,integer,text,text) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.worker_record_transplant_readiness_v1(uuid,text,integer,text,text)',
  'app_endpoint', 'verified', 'active', true, true, true, 1, 2,
  jsonb_build_object(
    'source','atlas_legacy_transplant_readiness_results_v1',
    'call_site','Transplant-readiness crop result card',
    'authorization','assigned farm hand or manager on task farm',
    'reviewed_date','2026-08-10'
  ), now(), now()
),
(
  'atlas.owner_operator_record_transplant_readiness_v1(uuid,uuid,text,integer,text,text)',
  'owner_admin_endpoint', 'verified', 'active', true, true, true, 1, 2,
  jsonb_build_object(
    'source','atlas_legacy_transplant_readiness_results_v1',
    'call_site','Owner operating through selected worker context',
    'authorization','owner operator context with effective membership visibility',
    'reviewed_date','2026-08-10'
  ), now(), now()
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
    evidence = coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb) || excluded.evidence,
    reviewed_at = excluded.reviewed_at;
