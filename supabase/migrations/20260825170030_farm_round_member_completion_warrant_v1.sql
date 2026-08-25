create or replace function atlas.worker_record_farm_round_member_done_v1(
  p_task_id uuid,
  p_idempotency_key text,
  p_note text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_parent atlas.tasks%rowtype;
  v_membership_id uuid;
  v_role text;
  v_parent_id uuid;
  v_service_date date := (now() at time zone 'America/Chicago')::date;
  v_readiness jsonb;
  v_payload jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  v_role := atlas.current_farm_role(v_task.farm_id);
  if v_membership_id is null or v_role not in ('farm_hand','manager') then
    raise exception 'Active assigned-worker membership required.' using errcode='42501';
  end if;
  if v_task.visibility_scope <> 'assigned_worker' or v_task.assigned_membership_id is distinct from v_membership_id then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode='42501';
  end if;
  if v_task.status <> 'open' or coalesce(v_task.metadata->>'farm_round_member','false') <> 'true' then
    raise exception 'This task is not an open Farm Round member.' using errcode='23514';
  end if;

  begin
    v_parent_id := nullif(p_payload->>'farmRoundParentTaskId','')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid Farm Round parent is required.' using errcode='22023';
  end;
  if v_parent_id is null or v_task.parent_task_id is distinct from v_parent_id then
    raise exception 'Farm Round parent/member identity does not match.' using errcode='42501';
  end if;

  select * into v_parent from atlas.tasks where id=v_parent_id and farm_id=v_task.farm_id;
  if v_parent.id is null
     or v_parent.task_type <> 'stewardship_round'
     or v_parent.status <> 'open'
     or v_parent.assigned_membership_id is distinct from v_membership_id
     or v_parent.due_date is distinct from v_service_date
     or v_task.due_date is distinct from v_service_date
     or coalesce(v_parent.metadata->>'farm_round_contract','') <> 'farm_round_grouping_v1'
  then
    raise exception 'Farm Round member is not inside the signed-in worker current-day round.' using errcode='23514';
  end if;

  v_readiness := atlas.task_execution_readiness_v1(v_task.id);
  if not coalesce((v_readiness->>'prerequisitesReady')::boolean,false)
     or not coalesce((v_readiness->>'destinationReady')::boolean,false)
     or not coalesce((v_readiness->>'seedReady')::boolean,false)
     or not coalesce((v_readiness->>'stateConsequenceClear')::boolean,false)
  then
    raise exception 'This Farm Round member has a non-resource execution blocker.' using errcode='23514';
  end if;

  v_payload := coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
    'actor_user_id',auth.uid(),
    'actor_membership_id',v_membership_id,
    'actor_role',v_role,
    'completion_warrant','farm_round_member_completion_v1',
    'resource_truth_not_inferred',true
  );

  return atlas.record_task_transition_v1(
    p_task_id,'done',p_idempotency_key,null,p_note,null,null,null,v_payload,null
  );
end;
$function$;

revoke all on function atlas.worker_record_farm_round_member_done_v1(uuid,text,text,jsonb) from public, anon;
grant execute on function atlas.worker_record_farm_round_member_done_v1(uuid,text,text,jsonb) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,
  security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,anonymous_execute_expected
) values (
  'atlas.worker_record_farm_round_member_done_v1(uuid, text, text, jsonb)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'caller','POST /api/atlas/task-transition',
    'purpose','Record a current-day Farm Round member completion through the canonical transition rail after exact parent/member jurisdiction validation.',
    'resourceSemantics','A completed Farm Round row is post-execution evidence; it does not assert current resource inventory or bypass non-resource blockers.'
  ),false
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
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();