create or replace function atlas.ensure_truth_acquisition_observation_carrier_v1(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_adapter jsonb;
  v_task_id uuid;
  v_cue_id uuid;
  v_synced_cue_id uuid;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then
    return jsonb_build_object('instanceId',v_instance.id,'state','not_open_truth_acquisition','created',false);
  end if;

  v_adapter:=atlas.truth_acquisition_observation_adapter_v1(v_instance.id);
  if not coalesce((v_adapter->>'available')::boolean,false) then
    return jsonb_build_object('instanceId',v_instance.id,'state','adapter_unavailable','created',false,'adapter',v_adapter);
  end if;
  begin v_task_id:=nullif(v_adapter->>'carrierTaskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is null then
    return jsonb_build_object('instanceId',v_instance.id,'state','assigned_carrier_unavailable','created',false,'adapter',v_adapter);
  end if;

  if v_adapter->>'resultContractKind'='field_transplant_readiness_gate_v1' then
    v_synced_cue_id:=atlas.sync_transplant_readiness_day_cue_v1(v_task_id);
  end if;
  v_adapter:=atlas.truth_acquisition_observation_adapter_v1(v_instance.id);
  begin v_cue_id:=nullif(v_adapter->>'workerDayCueId','')::uuid; exception when others then v_cue_id:=null; end;
  if v_cue_id is null then
    v_cue_id:=v_synced_cue_id;
  end if;
  if v_cue_id is null then
    return jsonb_build_object('instanceId',v_instance.id,'state','worker_cue_unavailable','created',false,'adapter',v_adapter);
  end if;

  update atlas.state_consequence_instances
  set carrier_task_id=v_task_id,
      epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
        'observationAdapterKey',v_adapter->>'adapterKey',
        'observationCarrierTaskId',v_task_id,
        'observationWorkerDayCueId',v_cue_id,
        'observationAssignedMembershipId',v_adapter->>'assignedMembershipId',
        'observationCarrierReconciledBy','ensure_truth_acquisition_observation_carrier_v1'
      ),
      updated_at=now()
  where id=v_instance.id;

  return jsonb_build_object(
    'contractVersion','ensure_truth_acquisition_observation_carrier_v1',
    'instanceId',v_instance.id,
    'state','worker_observation_carrier_ready',
    'taskId',v_task_id,
    'workerDayCueId',v_cue_id,
    'assignedMembershipId',v_adapter->>'assignedMembershipId',
    'adapter',v_adapter,
    'created',false,
    'truthBoundary',jsonb_build_object(
      'existingAssignedObservationPathReused',true,
      'workerNotAssignedByKnowerClassificationAlone',true,
      'taskIsCarrierNotTruth',true
    )
  );
end;
$function$;

revoke all on function atlas.ensure_truth_acquisition_observation_carrier_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_truth_acquisition_observation_carrier_v1(uuid) to service_role;