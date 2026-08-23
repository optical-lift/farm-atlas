create or replace function atlas.ensure_truth_acquisition_worker_observation_v1(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_requirement atlas.state_consequence_instances%rowtype;
  v_plan jsonb;
  v_task atlas.tasks%rowtype;
  v_occurrence_id uuid;
  v_materialized jsonb;
  v_task_id uuid;
  v_due date;
  v_subject text;
  v_prompt text;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then return jsonb_build_object('instanceId',v_instance.id,'state','not_open','created',false); end if;

  v_plan:=atlas.truth_acquisition_worker_observation_plan_v1(v_instance.id);
  if not coalesce((v_plan->>'ready')::boolean,false) then return v_plan||jsonb_build_object('created',false); end if;

  if v_instance.carrier_task_id is not null then
    select * into v_task from atlas.tasks where id=v_instance.carrier_task_id and status in ('open','blocked');
    if v_task.id is not null and v_task.assigned_membership_id=(v_plan->>'workerMembershipId')::uuid then
      return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','carrier_ready','taskId',v_task.id,'created',false,'plan',v_plan);
    end if;
  end if;

  if v_instance.source_requirement_instance_id is not null then select * into v_requirement from atlas.state_consequence_instances where id=v_instance.source_requirement_instance_id; end if;
  v_due:=coalesce(v_requirement.requirement_known_active_by,v_requirement.requirement_onset_date,(now() at time zone 'America/Chicago')::date);
  v_subject:=coalesce((select coalesce(nullif(variety,''),nullif(crop_label,''),'Crop') from atlas.crop_cycles where id=v_instance.subject_id),'Crop');
  v_prompt:=v_plan->>'prompt';

  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    v_instance.farm_id,
    'truth-observation:'||v_instance.id::text,
    'truth-observation:'||v_instance.id::text,
    'truth-observation:'||v_instance.id::text||':'||v_instance.release_generation::text,
    v_prompt||' — '||v_subject,
    'truth_acquisition_observation',
    v_due,
    'state_consequence',
    v_instance.id,
    'immediate',0,1,
    jsonb_build_object(
      'title',v_prompt||' — '||v_subject,
      'task_type','truth_acquisition_observation','priority','high','action_key','inspect','work_class','crop_cycle',
      'visibility_scope','assigned_worker','assigned_membership_id',v_plan->>'workerMembershipId','assigned_user_id',v_plan->>'workerUserId',
      'note',v_prompt||'. Record what you actually observe; do not infer the missing fact.',
      'metadata',jsonb_build_object(
        'task_style','truth_acquisition_observation','truth_acquisition_instance_id',v_instance.id,
        'source_requirement_instance_id',v_instance.source_requirement_instance_id,
        'worker_observation_adapter',v_plan->>'adapter','worker_observation_key',v_plan->>'observationKey',
        'crop_cycle_id',v_instance.subject_id,'object_id',v_plan->>'objectId','display_action',v_prompt,
        'display_subject',v_subject,'display_location',v_plan->>'objectLabel','structured_result_required',true,
        'result_endpoint','record_worker_truth_observation_v1','observation_action_semantics','inspect'
      )
    ),
    jsonb_build_object('crop_cycle_ids',jsonb_build_array(v_instance.subject_id)),
    '{}'::jsonb,null,
    jsonb_build_object('truthAcquisitionInstanceId',v_instance.id,'contract','truth_acquisition_worker_observation_v1')
  );
  update atlas.planned_work_occurrences set work_lane='required',commitment_kind='persistent',effort_units=0.25,updated_at=now() where id=v_occurrence_id;
  v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,(now() at time zone 'America/Chicago')::date);
  begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is null then return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','planned_not_released','occurrenceId',v_occurrence_id,'materialization',v_materialized,'created',false,'plan',v_plan); end if;

  update atlas.tasks set sky_deferral_mode='never',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('worker_truth_observation_contract','record_worker_truth_observation_v1'),updated_at=now() where id=v_task_id;
  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task_id,v_instance.subject_id,'observes','confirmed','truth_acquisition_worker_observation_v1',jsonb_build_object('instanceId',v_instance.id)) on conflict do nothing;
  update atlas.state_consequence_instances set carrier_task_id=v_task_id,epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object('workerObservationPlan',v_plan,'carrierTaskId',v_task_id,'carrierReconciledBy','ensure_truth_acquisition_worker_observation_v1'),updated_at=now() where id=v_instance.id;

  return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','carrier_ready','taskId',v_task_id,'occurrenceId',v_occurrence_id,'created',true,'plan',v_plan,'truthBoundary',jsonb_build_object('workerReceivesRealObservationAction',true,'taskDoesNotResolveFactByCompletionAlone',true,'operationClassComesFromCanonicalInspectTaxonomy',true));
end;
$function$;