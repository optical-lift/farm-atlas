-- P5: make the mature task readiness reader explicitly an execution-warrant contract.
-- No readiness logic changes. Requirement truth remains upstream in the state-consequence engine.

create or replace function atlas.task_execution_readiness_v1(p_task_id uuid)
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
  v_seed_ready boolean;
  v_state_gate jsonb;
  v_state_gate_clear boolean;
  v_ready boolean;
begin
  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  v_seed:=atlas.task_seed_readiness_v1(p_task_id);
  v_seed_ready:=coalesce((v_seed->>'ready')::boolean,false);
  v_state_gate:=atlas.task_state_consequence_gate_v1(p_task_id);
  v_state_gate_clear:=not coalesce((v_state_gate->>'blocking')::boolean,false);
  v_ready:=v_prereq and v_resources and coalesce((v_destination->>'ready')::boolean,false) and v_seed_ready and v_state_gate_clear;

  return jsonb_build_object(
    'contractVersion','task_execution_warrant_v1',
    'contractRole','execution_warrant',
    'taskId',p_task_id,
    'ready',v_ready,
    'executionReady',v_ready,
    'prerequisitesReady',v_prereq,
    'resourcesReady',v_resources,
    'destinationReady',coalesce((v_destination->>'ready')::boolean,false),
    'seedReady',v_seed_ready,
    'stateConsequenceClear',v_state_gate_clear,
    'preparationRequired',coalesce((v_state_gate->>'preparationRequired')::boolean,false),
    'destination',v_destination,
    'seed',v_seed,
    'stateConsequenceGate',v_state_gate,
    'truthBoundary',jsonb_build_object(
      'requirementAuthority',false,
      'requirementExistenceNotInferredFromReady',true,
      'notReadyDoesNotMeanNotRequired',true,
      'thisContractOnlyAnswersWhetherRepresentedTaskMayExecuteNow',true
    )
  );
end;
$function$;

revoke all on function atlas.task_execution_readiness_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.task_execution_readiness_v1(uuid) to service_role;

comment on function atlas.task_execution_readiness_v1(uuid) is
'P5 execution-warrant contract for an already represented task. It answers whether that task may execute now; it is never authority that the underlying reality requirement exists or does not exist.';