create table if not exists atlas.truth_acquisition_observation_adapters (
  stable_key text primary key,
  subject_kind text not null,
  action_key text not null,
  result_contract_kind text not null,
  public_writer_signature text not null,
  canonical_apply_signature text not null,
  carrier_task_type text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject_kind,action_key)
);

revoke all on atlas.truth_acquisition_observation_adapters from public,anon,authenticated;
grant select,insert,update,delete on atlas.truth_acquisition_observation_adapters to service_role;

insert into atlas.truth_acquisition_observation_adapters(
  stable_key,subject_kind,action_key,result_contract_kind,
  public_writer_signature,canonical_apply_signature,carrier_task_type,active,metadata
) values (
  'crop-field-transplant-readiness-v1',
  'crop_cycle','transplant_readiness','field_transplant_readiness_gate_v1',
  'atlas.worker_resolve_day_cue_api_v1(uuid, jsonb)',
  'atlas.apply_worker_day_field_transplant_readiness_v1(uuid, jsonb)',
  'transplant_readiness',true,
  jsonb_build_object(
    'truthKind','worker_observation',
    'carrierMode','worker_day_cue',
    'canonicalState','crop_cycles.cycle_state + crop_cycles.metadata.latest_field_transplant_readiness_observation',
    'workerMustBeAssigned',true,
    'taskIsCarrierNotTruth',true
  )
)
on conflict (stable_key) do update set
  subject_kind=excluded.subject_kind,
  action_key=excluded.action_key,
  result_contract_kind=excluded.result_contract_kind,
  public_writer_signature=excluded.public_writer_signature,
  canonical_apply_signature=excluded.canonical_apply_signature,
  carrier_task_type=excluded.carrier_task_type,
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

create or replace function atlas.truth_acquisition_observation_adapter_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_adapter atlas.truth_acquisition_observation_adapters%rowtype;
  v_public_oid oid;
  v_apply_oid oid;
  v_rpc atlas.authenticated_rpc_registry%rowtype;
  v_task atlas.tasks%rowtype;
  v_cue atlas.worker_day_cues%rowtype;
  v_adapter_key text;
  v_executable boolean:=false;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_adapter_key:=coalesce(nullif(v_policy.metadata->>'observationAdapterKey',''),nullif(v_policy.action_spec->>'observationAdapterKey',''));
  if v_adapter_key is not null then
    select * into v_adapter from atlas.truth_acquisition_observation_adapters where stable_key=v_adapter_key and active;
  else
    select * into v_adapter
    from atlas.truth_acquisition_observation_adapters
    where subject_kind=v_instance.subject_kind and action_key=v_instance.action_key and active
    order by stable_key limit 1;
  end if;

  if v_adapter.stable_key is null then
    return jsonb_build_object(
      'contractVersion','truth_acquisition_observation_adapter_v1',
      'instanceId',v_instance.id,
      'available',false,
      'reason','no_registered_observation_adapter',
      'truthBoundary',jsonb_build_object('workerObservableDoesNotImplyExecutableWorkerPath',true)
    );
  end if;

  v_public_oid:=to_regprocedure(v_adapter.public_writer_signature)::oid;
  v_apply_oid:=to_regprocedure(v_adapter.canonical_apply_signature)::oid;
  select * into v_rpc from atlas.authenticated_rpc_registry where signature=v_adapter.public_writer_signature;
  v_executable:=v_public_oid is not null
    and v_apply_oid is not null
    and v_rpc.signature is not null
    and v_rpc.review_status='active'
    and v_rpc.authenticated_execute_expected
    and not v_rpc.anonymous_execute_expected;

  if v_instance.carrier_task_id is not null then
    select * into v_task from atlas.tasks where id=v_instance.carrier_task_id;
  end if;
  if v_task.id is null and v_instance.subject_kind='crop_cycle' and v_adapter.carrier_task_type='transplant_readiness' then
    select t.* into v_task
    from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
    where tc.crop_cycle_id=v_instance.subject_id
      and t.status in ('open','blocked')
      and t.task_type=v_adapter.carrier_task_type
      and t.assigned_membership_id is not null
    order by t.due_date nulls last,t.created_at,t.id
    limit 1;
  end if;
  if v_task.id is not null then
    select cue.* into v_cue
    from atlas.worker_day_cues cue
    where cue.farm_id=v_instance.farm_id
      and cue.membership_id=v_task.assigned_membership_id
      and cue.status not in ('resolved','dismissed')
      and cue.result_contract->>'kind'=v_adapter.result_contract_kind
      and cue.result_contract->>'taskId'=v_task.id::text
    order by cue.service_date,cue.created_at,cue.id
    limit 1;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','truth_acquisition_observation_adapter_v1',
    'instanceId',v_instance.id,
    'available',v_executable,
    'adapterKey',v_adapter.stable_key,
    'resultContractKind',v_adapter.result_contract_kind,
    'publicWriterSignature',v_adapter.public_writer_signature,
    'canonicalApplySignature',v_adapter.canonical_apply_signature,
    'carrierTaskType',v_adapter.carrier_task_type,
    'carrierTaskId',v_task.id,
    'assignedMembershipId',v_task.assigned_membership_id,
    'workerDayCueId',v_cue.id,
    'carrierReady',(v_task.id is not null and v_task.assigned_membership_id is not null and v_cue.id is not null),
    'truthBoundary',jsonb_build_object(
      'adapterRegistrationDoesNotCreateObservation',true,
      'taskIsCarrierNotTruth',true,
      'workerPathRequiresGovernedWriter',true,
      'workerPathRequiresAssignedCarrier',true
    )
  ));
end;
$function$;

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
  v_sync jsonb;
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
    v_sync:=atlas.sync_transplant_readiness_day_cue_v1(v_task_id);
  end if;
  v_adapter:=atlas.truth_acquisition_observation_adapter_v1(v_instance.id);
  begin v_cue_id:=nullif(v_adapter->>'workerDayCueId','')::uuid; exception when others then v_cue_id:=null; end;
  if v_cue_id is null then
    return jsonb_build_object('instanceId',v_instance.id,'state','worker_cue_unavailable','created',false,'adapter',v_adapter,'sync',v_sync);
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

create or replace function atlas.truth_acquisition_knower_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_search jsonb;
  v_jurisdiction jsonb;
  v_knower_class text;
  v_acquisition_surface text;
  v_owner_response jsonb;
  v_observation_adapter jsonb;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;
  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);
  v_owner_response:=v_instance.epistemic_basis->'ownerKnowledgeResponse';

  if v_search->>'verdict'='authoritative_answer_found' then
    v_knower_class:='already_known'; v_acquisition_surface:='none';
  elsif v_search->>'verdict'='contradictory_answers_found' then
    v_knower_class:='contradictory'; v_acquisition_surface:='owner_review';
  elsif v_owner_response->>'kind'='i_do_not_know'
        and coalesce((v_owner_response->>'releaseGeneration')::integer,-1)=v_instance.release_generation then
    v_knower_class:='actually_unknown'; v_acquisition_surface:='unresolved_unknown';
  else
    v_knower_class:=coalesce(nullif(v_policy.metadata->>'knowerClass',''),nullif(v_policy.action_spec->>'knowerClass',''),case
      when v_jurisdiction->>'jurisdiction'='owner' then 'owner_known'
      when v_jurisdiction->>'jurisdiction'='manager' then 'management_known'
      when v_jurisdiction->>'jurisdiction' in ('farm_operations','worker') then 'worker_observable'
      when v_jurisdiction->>'jurisdiction' in ('external','external_information') then 'external_information_required'
      else 'actually_unknown'
    end);
    if v_knower_class='worker_observable' then
      v_observation_adapter:=atlas.truth_acquisition_observation_adapter_v1(v_instance.id);
      v_acquisition_surface:=case when coalesce((v_observation_adapter->>'available')::boolean,false) then 'worker_observation' else 'unresolved_unknown' end;
    else
      v_acquisition_surface:=case v_knower_class
        when 'owner_known' then 'atlas_needs_from_you'
        when 'management_known' then 'management_acquisition'
        when 'external_information_required' then 'external_research_handoff'
        when 'contradictory' then 'owner_review'
        else 'unresolved_unknown'
      end;
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_knower_v1',
    'instanceId',v_instance.id,
    'search',v_search,
    'knowerClass',v_knower_class,
    'acquisitionSurface',v_acquisition_surface,
    'jurisdiction',v_jurisdiction,
    'askOwner',(v_acquisition_surface='atlas_needs_from_you'),
    'ownerKnowledgeResponse',v_owner_response,
    'workerObservationAdapter',v_observation_adapter,
    'truthBoundary',jsonb_build_object(
      'knowerClassificationDoesNotCreateFact',true,
      'ownerQuestionRequiresSearchFirst',true,
      'ownerDoesNotKnowDoesNotResolveFact',true,
      'workerObservationRequiresRegisteredExecutableAdapter',true,
      'workerObservationRequiresWorkerObservableClass',true,
      'externalInformationDoesNotBecomeInternalDecision',true
    )
  );
end;
$function$;

create or replace function atlas.sync_truth_acquisition_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_knower jsonb;
begin
  if new.status='open' and new.consequence_role='truth_acquisition' then
    v_knower:=atlas.truth_acquisition_knower_v1(new.id);
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'knowledgeAcquisitionSearch',v_knower->'search',
      'knowerClass',v_knower->>'knowerClass',
      'acquisitionSurface',v_knower->>'acquisitionSurface',
      'classifiedBy','truth_acquisition_knower_v1'
    ),updated_at=now()
    where id=new.id;

    if v_knower->>'acquisitionSurface' in ('atlas_needs_from_you','management_acquisition') then
      perform atlas.ensure_truth_acquisition_task_v1(new.id);
    elsif v_knower->>'acquisitionSurface'='worker_observation' then
      perform atlas.ensure_truth_acquisition_observation_carrier_v1(new.id);
    end if;
  end if;
  return new;
exception when others then
  return new;
end;
$function$;

revoke all on function atlas.truth_acquisition_observation_adapter_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.ensure_truth_acquisition_observation_carrier_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_knower_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.sync_truth_acquisition_carrier_v1() from public,anon,authenticated;
grant execute on function atlas.truth_acquisition_observation_adapter_v1(uuid) to service_role;
grant execute on function atlas.ensure_truth_acquisition_observation_carrier_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_knower_v1(uuid) to service_role;
grant execute on function atlas.sync_truth_acquisition_carrier_v1() to service_role;

comment on table atlas.truth_acquisition_observation_adapters is
'Tranche 1E registry of lawful Worker-observation acquisition adapters. Registration proves an executable observation path exists; it does not create an observation or assign authority.';
comment on function atlas.truth_acquisition_observation_adapter_v1(uuid) is
'Tranche 1E adapter proof. Worker-observable routing is available only when the governed public writer and canonical apply function exist; assigned carrier/cue readiness is reported separately.';
comment on function atlas.ensure_truth_acquisition_observation_carrier_v1(uuid) is
'Tranche 1E carrier adapter. Reuses an already-assigned canonical observation task and typed Worker Day cue; knower classification alone never assigns a worker.';