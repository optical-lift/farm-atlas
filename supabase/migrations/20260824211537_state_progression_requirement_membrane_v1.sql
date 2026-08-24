create or replace function atlas.requirement_set_evaluate_v1(p_requirements jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_node jsonb;
  v_total integer:=0;
  v_satisfied_count integer:=0;
  v_open_count integer:=0;
  v_satisfied boolean;
begin
  if p_requirements is null or jsonb_typeof(p_requirements)<>'array' then
    raise exception 'Requirement set must be a JSON array.' using errcode='22023';
  end if;

  if jsonb_array_length(p_requirements)=0 then
    raise exception 'Requirement set must contain at least one requirement node.' using errcode='22023';
  end if;

  for v_node in select value from jsonb_array_elements(p_requirements)
  loop
    if jsonb_typeof(v_node)<>'object' then
      raise exception 'Each requirement node must be a JSON object.' using errcode='22023';
    end if;
    if nullif(btrim(coalesce(v_node->>'requirementKey','')),'') is null then
      raise exception 'Each requirement node requires requirementKey.' using errcode='22023';
    end if;
    if jsonb_typeof(v_node->'satisfied')<>'boolean' then
      raise exception 'Requirement % requires boolean satisfied.', v_node->>'requirementKey' using errcode='22023';
    end if;

    v_total:=v_total+1;
    v_satisfied:=(v_node->>'satisfied')::boolean;
    if v_satisfied then
      v_satisfied_count:=v_satisfied_count+1;
    else
      v_open_count:=v_open_count+1;
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','requirement_set_evaluation_v1',
    'aggregation','all_required',
    'state',case when v_open_count=0 then 'satisfied' else 'open' end,
    'satisfied',(v_open_count=0),
    'requirementCount',v_total,
    'satisfiedCount',v_satisfied_count,
    'openCount',v_open_count,
    'requirements',p_requirements,
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'evidenceRemainsDomainOwned',true,
      'evaluationDoesNotCreateBoundaryEvent',true,
      'evaluationDoesNotExecuteEffects',true,
      'allRequirementsMustBeExplicit',true
    )
  );
end;
$function$;

revoke all on function atlas.requirement_set_evaluate_v1(jsonb) from public,anon,authenticated;
grant execute on function atlas.requirement_set_evaluate_v1(jsonb) to service_role;

create or replace function atlas.task_execution_requirement_inputs_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_prereq boolean;
  v_resources boolean;
  v_destination jsonb;
  v_seed jsonb;
  v_state_gate jsonb;
  v_state_clear boolean;
begin
  if not exists(select 1 from atlas.tasks where id=p_task_id) then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  v_seed:=atlas.task_seed_readiness_v1(p_task_id);
  v_state_gate:=atlas.task_state_consequence_gate_v1(p_task_id);
  v_state_clear:=not coalesce((v_state_gate->>'blocking')::boolean,false);

  return jsonb_build_array(
    jsonb_build_object(
      'requirementKey','prerequisites',
      'satisfied',v_prereq,
      'provider','task_prerequisites_ready_v1',
      'providerState',case when v_prereq then 'satisfied' else 'open' end,
      'evidence',jsonb_build_object('ready',v_prereq)
    ),
    jsonb_build_object(
      'requirementKey','resources',
      'satisfied',v_resources,
      'provider','task_required_resources_available_v1',
      'providerState',case when v_resources then 'satisfied' else 'open' end,
      'evidence',jsonb_build_object('ready',v_resources)
    ),
    jsonb_build_object(
      'requirementKey','destination',
      'satisfied',coalesce((v_destination->>'ready')::boolean,false),
      'provider','task_execution_destination_readiness_v1',
      'providerState',coalesce(v_destination->>'state','unknown'),
      'evidence',v_destination
    ),
    jsonb_build_object(
      'requirementKey','seed',
      'satisfied',coalesce((v_seed->>'ready')::boolean,false),
      'provider','task_seed_readiness_v1',
      'providerState',coalesce(v_seed->>'state','unknown'),
      'evidence',v_seed
    ),
    jsonb_build_object(
      'requirementKey','state_consequence',
      'satisfied',v_state_clear,
      'provider','task_state_consequence_gate_v1',
      'providerState',coalesce(v_state_gate->>'state','unknown'),
      'evidence',v_state_gate
    )
  );
end;
$function$;

revoke all on function atlas.task_execution_requirement_inputs_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.task_execution_requirement_inputs_v1(uuid) to service_role;

create or replace function atlas.task_execution_requirement_evaluation_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_requirements jsonb;
  v_evaluation jsonb;
  v_legacy jsonb;
  v_satisfied boolean;
  v_legacy_ready boolean;
begin
  v_requirements:=atlas.task_execution_requirement_inputs_v1(p_task_id);
  v_evaluation:=atlas.requirement_set_evaluate_v1(v_requirements);
  v_legacy:=atlas.task_execution_readiness_v1(p_task_id);
  v_satisfied:=coalesce((v_evaluation->>'satisfied')::boolean,false);
  v_legacy_ready:=coalesce((v_legacy->>'ready')::boolean,false);

  return jsonb_build_object(
    'contractVersion','task_execution_requirement_evaluation_v1',
    'contractRole','read_only_compatibility_membrane',
    'taskId',p_task_id,
    'satisfied',v_satisfied,
    'executionReady',v_satisfied,
    'requirements',v_requirements,
    'evaluation',v_evaluation,
    'legacyReadiness',v_legacy,
    'legacyReady',v_legacy_ready,
    'parity',(v_satisfied=v_legacy_ready),
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'legacyReadinessRemainsExecutionAuthority',true,
      'providerResultsRemainDomainOwned',true,
      'doesNotMutateTask',true,
      'doesNotReleaseWork',true,
      'doesNotWriteBoundaryLedger',true,
      'doesNotNotify',true,
      'doesNotArbitrateClock',true
    )
  );
end;
$function$;

revoke all on function atlas.task_execution_requirement_evaluation_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.task_execution_requirement_evaluation_v1(uuid) to service_role;