-- P8 — Structured physical result for requirement-derived crop transplant execution.
-- Reuses the canonical planting capture in task transitions, then reclassifies the
-- source seedling cycle from the witnessed result and evaluates the next continuation.

create or replace function atlas.record_crop_requirement_transplant_result_v1(
  p_task_id uuid,
  p_actor_membership_id uuid,
  p_planted_date date,
  p_planted_amount numeric,
  p_destination_object_id uuid,
  p_all_remaining_transplanted boolean,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_task atlas.tasks%rowtype;
  v_actor atlas.farm_memberships%rowtype;
  v_req atlas.state_consequence_instances%rowtype;
  v_source_cycle atlas.crop_cycles%rowtype;
  v_warrant jsonb;
  v_transition jsonb;
  v_claim_id uuid;
  v_content_id uuid;
  v_field_log_id uuid;
  v_destination_cycle_id uuid;
  v_source_requirement_status text;
  v_source_reconcile jsonb;
  v_next_execution jsonb;
  v_destination_snapshot jsonb;
  v_destination_label text;
  v_key text:=nullif(btrim(p_idempotency_key),'');
begin
  if p_task_id is null or p_actor_membership_id is null then raise exception 'Task and actor membership are required.' using errcode='22023'; end if;
  if p_planted_date is null or p_planted_date<>v_today then
    raise exception 'This worker transplant result must be recorded on the farm day it occurs.' using errcode='22023';
  end if;
  if p_planted_amount is null or p_planted_amount<=0 then raise exception 'Actual planted count must be greater than zero.' using errcode='22023'; end if;
  if p_destination_object_id is null then raise exception 'Actual transplant destination is required.' using errcode='22023'; end if;
  if p_all_remaining_transplanted is null then raise exception 'State whether all remaining starts were transplanted.' using errcode='22023'; end if;
  if v_key is null or length(v_key)<8 or length(v_key)>120 then raise exception 'A transplant result idempotency key of 8 to 120 characters is required.' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if v_task.status='done' then
    return jsonb_build_object(
      'contractVersion','crop_requirement_transplant_result_v1','taskId',v_task.id,'state','already_recorded','deduplicated',true,
      'plantingClaimId',v_task.metadata#>>'{planting_log,planting_claim_id}',
      'sourceRequirementInstanceId',v_task.metadata->>'source_requirement_instance_id'
    );
  end if;
  if v_task.status not in ('open','blocked') or v_task.action_key<>'transplant'
     or coalesce(v_task.metadata->>'task_style','')<>'requirement_execution_transplant' then
    raise exception 'Task is not an active requirement-derived crop transplant execution.' using errcode='22023';
  end if;

  select * into v_actor from atlas.farm_memberships
  where id=p_actor_membership_id and farm_id=v_task.farm_id and active=true;
  if v_actor.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_actor.id<>v_task.assigned_membership_id and v_actor.role not in ('owner','manager') then
    raise exception 'Only the assigned worker or farm management may record this transplant result.' using errcode='42501';
  end if;

  begin
    select * into v_req from atlas.state_consequence_instances
    where id=(v_task.metadata->>'source_requirement_instance_id')::uuid
    for update;
  exception when others then
    raise exception 'Task is missing its source requirement identity.' using errcode='22023';
  end;
  if v_req.id is null or v_req.consequence_role<>'operation_requirement' or v_req.action_key<>'transplant' then
    raise exception 'Valid open transplant requirement is required.' using errcode='22023';
  end if;

  select * into v_source_cycle from atlas.crop_cycles where id=v_req.subject_id for update;
  if v_source_cycle.id is null or v_req.subject_kind<>'crop_cycle' then raise exception 'Source crop cycle not found.' using errcode='P0002'; end if;

  if not exists(
    select 1 from atlas.crop_destination_claims c
    where c.crop_cycle_id=v_source_cycle.id and c.destination_object_id=p_destination_object_id and c.status='active'
  ) then
    raise exception 'Result destination is not an active canonical destination claim for this crop.' using errcode='22023';
  end if;

  select label into v_destination_label from atlas.growing_objects
  where id=p_destination_object_id and farm_id=v_task.farm_id;
  if v_destination_label is null then raise exception 'Destination object not found in this farm.' using errcode='22023'; end if;

  v_warrant:=atlas.crop_operation_execution_warrant_v1(v_source_cycle.id,'transplant',v_req.id);
  if not coalesce((v_warrant->>'executionReady')::boolean,false) then
    raise exception 'Transplant result rejected because the execution warrant is not ready.' using errcode='55000';
  end if;

  v_transition:=atlas.record_task_transition_v1_internal(
    v_task.id,
    'checklist_done',
    left(v_key||':task-result',160),
    null,
    coalesce(nullif(btrim(p_note),''),'Transplanted '||p_planted_amount::text||' plants to '||v_destination_label||'.'),
    'structured_crop_requirement_transplant_result',
    'transplant',
    'crop_cycle',
    jsonb_build_object(
      'completion_source','structured_crop_requirement_transplant_result',
      'plantedAmount',p_planted_amount,
      'plantedObjectId',p_destination_object_id,
      'plantedLocation',v_destination_label,
      'allRemainingTransplanted',p_all_remaining_transplanted,
      'sourceRequirementInstanceId',v_req.id,
      'sourceCropCycleId',v_source_cycle.id
    ),
    null
  );

  select * into v_task from atlas.tasks where id=p_task_id;
  begin v_claim_id:=nullif(v_task.metadata#>>'{planting_log,planting_claim_id}','')::uuid; exception when others then v_claim_id:=null; end;
  begin v_content_id:=nullif(v_task.metadata#>>'{planting_log,object_content_id}','')::uuid; exception when others then v_content_id:=null; end;
  begin v_field_log_id:=nullif(v_task.metadata#>>'{planting_log,field_log_id}','')::uuid; exception when others then v_field_log_id:=null; end;

  if v_claim_id is null or v_content_id is null then
    raise exception 'Structured transplant result did not produce canonical planting evidence.' using errcode='55000';
  end if;

  perform atlas.sync_crop_cycle_registry_v1(v_task.farm_id,p_destination_object_id);
  select id into v_destination_cycle_id
  from atlas.crop_cycles
  where object_content_id=v_content_id
  order by created_at desc,id
  limit 1;

  if v_destination_cycle_id is not null then
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
    values(v_task.id,v_destination_cycle_id,'creates','confirmed','crop_requirement_transplant_result_v1',jsonb_build_object(
      'sourceRequirementInstanceId',v_req.id,'sourceCropCycleId',v_source_cycle.id,'plantingClaimId',v_claim_id
    ))
    on conflict(task_id,crop_cycle_id,role) do update
      set source=excluded.source,metadata=atlas.task_crop_cycles.metadata||excluded.metadata;
  end if;

  if p_all_remaining_transplanted then
    update atlas.crop_cycles
    set cycle_state='transplanted_out',
        lifecycle_status='complete',
        coverage_kind='seedlings_remaining',
        coverage_amount=0,
        coverage_unit='plants',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'transplanted_date',p_planted_date,
          'plants_transplanted',p_planted_amount,
          'planting_claim_id',v_claim_id,
          'destination_object_id',p_destination_object_id,
          'destination_crop_cycle_id',v_destination_cycle_id,
          'source_task_id',v_task.id,
          'all_remaining_transplanted',true,
          'source_requirement_instance_id',v_req.id,
          'result_source','crop_requirement_transplant_result_v1'
        )),
        updated_at=now()
    where id=v_source_cycle.id;
  else
    update atlas.crop_cycles
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'last_partial_transplant_date',p_planted_date,
          'last_partial_transplant_count',p_planted_amount,
          'last_partial_transplant_claim_id',v_claim_id,
          'last_partial_destination_object_id',p_destination_object_id,
          'last_partial_destination_crop_cycle_id',v_destination_cycle_id,
          'remaining_quantity_state','unknown_until_observed',
          'all_remaining_transplanted',false,
          'source_requirement_instance_id',v_req.id,
          'result_source','crop_requirement_transplant_result_v1'
        )),
        updated_at=now()
    where id=v_source_cycle.id;
  end if;

  v_source_reconcile:=atlas.reconcile_crop_cycle_requirement_state_v1(v_source_cycle.id);
  select status into v_source_requirement_status from atlas.state_consequence_instances where id=v_req.id;

  if v_source_requirement_status='open' then
    v_next_execution:=atlas.ensure_requirement_execution_v1(v_req.id,v_today);
  else
    v_next_execution:=jsonb_build_object('state','source_requirement_resolved','requirementInstanceId',v_req.id);
  end if;

  if v_destination_cycle_id is not null then
    v_destination_snapshot:=atlas.crop_cycle_requirement_snapshot_v1(v_destination_cycle_id,v_today);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','crop_requirement_transplant_result_v1',
    'state','recorded',
    'taskId',v_task.id,
    'actorMembershipId',v_actor.id,
    'sourceRequirementInstanceId',v_req.id,
    'sourceRequirementStatus',v_source_requirement_status,
    'sourceCropCycleId',v_source_cycle.id,
    'destinationObjectId',p_destination_object_id,
    'destinationLabel',v_destination_label,
    'destinationCropCycleId',v_destination_cycle_id,
    'plantingClaimId',v_claim_id,
    'fieldLogId',v_field_log_id,
    'plantsTransplanted',p_planted_amount,
    'allRemainingTransplanted',p_all_remaining_transplanted,
    'transition',v_transition,
    'sourceReconcile',v_source_reconcile,
    'nextExecution',v_next_execution,
    'destinationRequirementSnapshot',v_destination_snapshot,
    'truthBoundary',jsonb_build_object(
      'actualCountIsWitnessedResult',true,
      'destinationClaimIsValidatedBeforeResult',true,
      'sourceRequirementClockWasNotRewritten',true,
      'partialTransferDoesNotInventRemainingCount',true,
      'allRemainingFlagControlsSourceCycleClosure',true,
      'destinationCycleIsDerivedFromCanonicalPlantingEvidence',true,
      'nextBiologicalContinuationIsEvaluated',true
    )
  ));
end;
$function$;

revoke all on function atlas.record_crop_requirement_transplant_result_v1(uuid,uuid,date,numeric,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function atlas.record_crop_requirement_transplant_result_v1(uuid,uuid,date,numeric,uuid,boolean,text,text) to service_role;

comment on function atlas.record_crop_requirement_transplant_result_v1(uuid,uuid,date,numeric,uuid,boolean,text,text) is
'P8 structured result for requirement-derived crop transplant execution. Records actual planted count/location through the canonical task planting result, closes or preserves the source seedling cycle according to explicit all-remaining evidence, and evaluates the destination body next.';
