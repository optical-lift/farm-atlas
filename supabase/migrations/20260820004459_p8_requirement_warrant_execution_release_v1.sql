-- P8 — Requirement warrant -> physical execution release.
-- Source history is written at the final corrected v1 shape; the two following
-- migration versions are retained as parity markers for live hotfixes.

create or replace function atlas.requirement_execution_assignee_v1(
  p_requirement_instance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_req atlas.state_consequence_instances%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_count integer:=0;
begin
  select * into v_req from atlas.state_consequence_instances where id=p_requirement_instance_id;
  if v_req.id is null then raise exception 'Requirement instance not found.' using errcode='P0002'; end if;

  if v_req.subject_kind='crop_cycle' then
    select * into v_cycle from atlas.crop_cycles where id=v_req.subject_id;
  end if;

  if v_cycle.source_task_id is not null then
    select fm.* into v_membership
    from atlas.tasks t
    join atlas.farm_memberships fm on fm.id=t.assigned_membership_id
    where t.id=v_cycle.source_task_id
      and fm.farm_id=v_req.farm_id and fm.active=true and fm.role='farm_hand'
    limit 1;
  end if;

  if v_membership.id is null then
    select count(*)::integer into v_count
    from atlas.farm_memberships fm
    where fm.farm_id=v_req.farm_id and fm.active=true and fm.role='farm_hand';

    if v_count=1 then
      select fm.* into v_membership
      from atlas.farm_memberships fm
      where fm.farm_id=v_req.farm_id and fm.active=true and fm.role='farm_hand'
      limit 1;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','requirement_execution_assignee_v1',
    'requirementInstanceId',v_req.id,
    'state',case when v_membership.id is not null then 'resolved' when v_count>1 then 'ambiguous' else 'unresolved' end,
    'membershipId',v_membership.id,
    'userId',v_membership.user_id,
    'role',v_membership.role,
    'workerKey',v_membership.worker_key,
    'resolutionSource',case
      when v_membership.id is not null and v_cycle.source_task_id is not null
        and exists(select 1 from atlas.tasks t where t.id=v_cycle.source_task_id and t.assigned_membership_id=v_membership.id)
        then 'subject_source_task_execution_custody'
      when v_membership.id is not null then 'single_active_farm_hand'
      when v_count>1 then 'multiple_active_farm_hands_require_routing'
      else 'no_active_farm_hand'
    end,
    'truthBoundary',jsonb_build_object(
      'executorIsNotGuessedWhenAmbiguous',true,
      'sourceExecutionCustodyPrecedesFallback',true,
      'ownerDecisionCustodyDoesNotBecomeWorkerExecutionCustody',true
    )
  ));
end;
$function$;

revoke all on function atlas.requirement_execution_assignee_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.requirement_execution_assignee_v1(uuid) to service_role;

create or replace function atlas.ensure_requirement_execution_v1(
  p_requirement_instance_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_req atlas.state_consequence_instances%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_warrant jsonb;
  v_assignee jsonb;
  v_membership_id uuid;
  v_user_id uuid;
  v_subject text;
  v_existing_task uuid;
  v_existing_occurrence uuid;
  v_execution_index integer:=1;
  v_occurrence_id uuid;
  v_materialized jsonb;
  v_task_id uuid;
  v_relation jsonb;
  v_destination_objects jsonb:='[]'::jsonb;
  v_destination_count integer:=0;
  v_single_destination uuid;
  v_destination_labels text;
  v_requirement_date date;
begin
  select * into v_req
  from atlas.state_consequence_instances
  where id=p_requirement_instance_id
  for update;

  if v_req.id is null then raise exception 'Requirement instance not found.' using errcode='P0002'; end if;
  if v_req.status<>'open' or v_req.consequence_role<>'operation_requirement' then
    return jsonb_build_object('contractVersion','ensure_requirement_execution_v1','state','requirement_not_open','requirementInstanceId',v_req.id);
  end if;

  if v_req.subject_kind<>'crop_cycle' or v_req.action_key<>'transplant' then
    return jsonb_build_object(
      'contractVersion','ensure_requirement_execution_v1','state','no_operation_adapter',
      'requirementInstanceId',v_req.id,'subjectKind',v_req.subject_kind,'actionKey',v_req.action_key
    );
  end if;

  select * into v_cycle from atlas.crop_cycles where id=v_req.subject_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found for requirement.' using errcode='P0002'; end if;

  v_warrant:=atlas.crop_operation_execution_warrant_v1(v_cycle.id,'transplant',v_req.id);
  if not coalesce((v_warrant->>'executionReady')::boolean,false) then
    return jsonb_build_object(
      'contractVersion','ensure_requirement_execution_v1','state','warrant_not_ready',
      'requirementInstanceId',v_req.id,'warrant',v_warrant
    );
  end if;

  select t.id,t.planned_occurrence_id
  into v_existing_task,v_existing_occurrence
  from atlas.tasks t
  join atlas.task_crop_cycles tc on tc.task_id=t.id and tc.crop_cycle_id=v_cycle.id
  where t.status in ('open','blocked')
    and t.action_key='transplant'
    and nullif(t.metadata->>'source_requirement_instance_id','')=v_req.id::text
  order by t.created_at,t.id
  limit 1;

  if v_existing_task is not null then
    return jsonb_build_object(
      'contractVersion','ensure_requirement_execution_v1','state','execution_already_released',
      'requirementInstanceId',v_req.id,'taskId',v_existing_task,'occurrenceId',v_existing_occurrence,
      'warrant',v_warrant
    );
  end if;

  v_assignee:=atlas.requirement_execution_assignee_v1(v_req.id);
  if coalesce(v_assignee->>'state','')<>'resolved' then
    return jsonb_build_object(
      'contractVersion','ensure_requirement_execution_v1','state','executor_routing_required',
      'requirementInstanceId',v_req.id,'assignee',v_assignee,'warrant',v_warrant
    );
  end if;
  v_membership_id:=(v_assignee->>'membershipId')::uuid;
  v_user_id:=(v_assignee->>'userId')::uuid;

  select
    coalesce(jsonb_agg(jsonb_build_object('object_id',q.destination_object_id,'role','transplant_destination') order by q.label,q.destination_object_id),'[]'::jsonb),
    count(*)::integer,
    (array_agg(q.destination_object_id order by q.destination_object_id))[1],
    string_agg(q.label,', ' order by q.label)
  into v_destination_objects,v_destination_count,v_single_destination,v_destination_labels
  from (
    select distinct c.destination_object_id,go.label
    from atlas.crop_destination_claims c
    join atlas.growing_objects go on go.id=c.destination_object_id and go.farm_id=c.farm_id
    where c.crop_cycle_id=v_cycle.id and c.status='active'
  ) q;

  if v_destination_count<1 then
    return jsonb_build_object(
      'contractVersion','ensure_requirement_execution_v1','state','destination_claim_missing_after_ready_warrant',
      'requirementInstanceId',v_req.id,'warrant',v_warrant
    );
  end if;
  if v_destination_count<>1 then v_single_destination:=null; end if;

  select count(*)::integer+1 into v_execution_index
  from atlas.tasks t
  join atlas.task_crop_cycles tc on tc.task_id=t.id and tc.crop_cycle_id=v_cycle.id
  where t.action_key='transplant'
    and nullif(t.metadata->>'source_requirement_instance_id','')=v_req.id::text;

  v_subject:=coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop');
  v_requirement_date:=coalesce(v_req.requirement_onset_date,v_req.requirement_known_active_by);

  v_relation:=jsonb_build_object(
    'task_crop_cycles',jsonb_build_array(jsonb_build_object(
      'crop_cycle_id',v_cycle.id,'role','affects','confidence','confirmed','source','requirement_execution_v1',
      'metadata',jsonb_build_object('sourceRequirementInstanceId',v_req.id)
    )),
    'task_objects',v_destination_objects
  );

  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_req.farm_id,
    p_definition_key=>'requirement-operation:crop-cycle:transplant',
    p_policy_key=>'requirement-operation:crop-cycle:transplant:one-active',
    p_occurrence_key=>'requirement:'||v_req.id::text||':execution:'||v_execution_index::text,
    p_title=>'Transplant — '||v_subject,
    p_task_type=>'transplanting',
    p_due_date=>v_day,
    p_source_kind=>'state_consequence_requirement',
    p_source_id=>v_req.id,
    p_gate_type=>'immediate',
    p_horizon_days=>0,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_strip_nulls(jsonb_build_object(
      'title','Transplant — '||v_subject,
      'task_type','transplanting',
      'priority','high',
      'due_date',v_day,
      'action_key','transplant',
      'work_class','crop_cycle',
      'work_lane','required',
      'commitment_kind','persistent',
      'task_scope','farm_operation',
      'origin_kind','generated',
      'visibility_scope','assigned_worker',
      'assigned_membership_id',v_membership_id,
      'assigned_user_id',v_user_id,
      'metadata',jsonb_strip_nulls(jsonb_build_object(
        'task_style','requirement_execution_transplant',
        'source_requirement_instance_id',v_req.id,
        'source_requirement_action','transplant',
        'source_crop_cycle_id',v_cycle.id,
        'requirement_onset_date',v_req.requirement_onset_date,
        'requirement_known_active_by',v_req.requirement_known_active_by,
        'requirement_time_class',v_req.requirement_time_class,
        'requirement_released_at',v_req.released_at,
        'requirement_statement',v_subject||' needs planted.',
        'execution_statement','Destination warrant is established; perform the transplant and record the actual planted count.',
        'display_action','Transplant',
        'display_subject',v_subject,
        'display_detail',case when v_destination_labels is null then 'Approved destination' else v_destination_labels end,
        'destination_object_count',v_destination_count,
        'planting_log_required',true,
        'planting_log_crop_label',v_cycle.crop_label,
        'planting_log_variety',v_cycle.variety,
        'planting_log_unit','plants',
        'planting_method','transplant',
        'planting_log_object_required',true,
        'planting_log_default_object_id',v_single_destination,
        'structured_result_required',true,
        'structured_result_contract','crop_requirement_transplant_result_v1',
        'result_requires_actual_count',true,
        'result_requires_all_remaining_flag',true,
        'due_date_semantics','execution_release_date_not_requirement_onset',
        'work_window_key','morning',
        'worker_execution_released',true,
        'executor_resolution',v_assignee,
        'truthBoundary',jsonb_build_object(
          'taskIsExecutionCarrierNotRequirement',true,
          'taskDueDateDoesNotResetRequirementClock',true,
          'destinationDecisionDoesNotEqualTransplantResult',true,
          'actualPlantedCountMustBeWitnessed',true,
          'missingProfileDoesNotSuppressCurrentExecution',true
        )
      ))
    )),
    p_relation_payload=>v_relation,
    p_gate_config=>jsonb_build_object('automatic',true,'source_kind','state_consequence_requirement','requiresReadyWarrant',true),
    p_not_before_date=>v_day,
    p_metadata=>jsonb_strip_nulls(jsonb_build_object(
      'sourceRequirementInstanceId',v_req.id,
      'sourceCropCycleId',v_cycle.id,
      'operationKey','transplant',
      'requirementOnsetDate',v_req.requirement_onset_date,
      'requirementKnownActiveBy',v_req.requirement_known_active_by,
      'requirementTimeClass',v_req.requirement_time_class,
      'executionIndex',v_execution_index,
      'requirementDate',v_requirement_date,
      'requirementDateIsNotOccurrenceDueDate',true
    ))
  );

  update atlas.planned_work_occurrences
  set work_lane='required',commitment_kind='persistent',effort_units=1,
      task_payload=coalesce(task_payload,'{}'::jsonb)||jsonb_build_object(
        'work_lane','required','commitment_kind','persistent',
        'metadata',coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
          'work_lane','required','commitment_kind','persistent','date_commitment','persistent'
        )
      ),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'workLane','required','commitmentKind','persistent','requirementClockPreserved',true
      ),
      updated_at=now()
  where id=v_occurrence_id;

  v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,v_day);
  begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;

  return jsonb_build_object(
    'contractVersion','ensure_requirement_execution_v1',
    'state',case when v_task_id is null then coalesce(v_materialized->>'state','planned') else 'execution_released' end,
    'requirementInstanceId',v_req.id,
    'occurrenceId',v_occurrence_id,
    'taskId',v_task_id,
    'assignee',v_assignee,
    'warrant',v_warrant,
    'materialization',v_materialized,
    'truthBoundary',jsonb_build_object(
      'requirementClockPreserved',true,
      'executionReleasedOnlyAfterReadyWarrant',true,
      'executorNotGuessedWhenAmbiguous',true,
      'physicalResultStillRequired',true
    )
  );
end;
$function$;

revoke all on function atlas.ensure_requirement_execution_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.ensure_requirement_execution_v1(uuid,date) to service_role;

create or replace function atlas.reconcile_resolved_truth_acquisition_to_execution_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_transition jsonb;
  v_execution jsonb;
begin
  if new.consequence_role<>'truth_acquisition'
     or new.status<>'resolved'
     or old.status='resolved'
     or new.source_requirement_instance_id is null then
    return new;
  end if;

  if new.carrier_task_id is not null
     and exists(select 1 from atlas.tasks t where t.id=new.carrier_task_id and t.status in ('open','blocked')) then
    v_transition:=atlas.record_task_transition_v1_internal(
      new.carrier_task_id,
      'done',
      left('truth-acquisition-resolved:'||new.id::text||':'||new.release_generation::text,160),
      null,
      'Resolved by canonical evidence. The source requirement remains governed independently.',
      'canonical_truth_acquisition_resolution',
      'truth_acquisition',
      new.action_key,
      jsonb_build_object(
        'completion_source','canonical_truth_acquisition_resolution',
        'state_consequence_instance_id',new.id,
        'source_requirement_instance_id',new.source_requirement_instance_id,
        'canonical_evidence_resolved_at',new.resolved_at
      ),
      null
    );
  end if;

  v_execution:=atlas.ensure_requirement_execution_v1(
    new.source_requirement_instance_id,
    (now() at time zone 'America/Chicago')::date
  );

  update atlas.state_consequence_instances
  set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
        'resolutionContinuation',v_execution,
        'resolutionContinuationCheckedAt',now()
      ),
      updated_at=now()
  where id=new.id;

  return new;
end;
$function$;

revoke all on function atlas.reconcile_resolved_truth_acquisition_to_execution_v1() from public,anon,authenticated;
grant execute on function atlas.reconcile_resolved_truth_acquisition_to_execution_v1() to service_role;

drop trigger if exists p8_resolved_truth_acquisition_to_execution on atlas.state_consequence_instances;
create trigger p8_resolved_truth_acquisition_to_execution
after update of status on atlas.state_consequence_instances
for each row execute function atlas.reconcile_resolved_truth_acquisition_to_execution_v1();

comment on function atlas.ensure_requirement_execution_v1(uuid,date) is
'P8 warrant-ready operation release adapter. First governed operation is crop-cycle transplant. Uses the universal occurrence engine, preserves requirement time, fails closed on ambiguous worker custody, and requires a structured physical result.';
comment on function atlas.reconcile_resolved_truth_acquisition_to_execution_v1() is
'P8 handoff from resolved truth acquisition to source-requirement warrant re-evaluation and physical execution release. Canonical evidence closes the acquisition carrier; the carrier itself is not truth authority.';
