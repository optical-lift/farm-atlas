create or replace function atlas.truth_acquisition_worker_observation_support_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_task atlas.tasks%rowtype;
  v_worker atlas.farm_memberships%rowtype;
  v_worker_count integer:=0;
  v_declared_knower text;
  v_adapter text;
  v_search_adapter text;
  v_observation_key text;
  v_prompt text;
  v_public_sig text:='atlas.record_worker_truth_observation_v1(uuid, uuid, text, text, numeric, text, text, text)';
  v_domain_sig text:='atlas.record_crop_observation_for_member_v1(uuid, text, uuid, text, date, text, numeric, text, jsonb, text)';
  v_public_rpc atlas.authenticated_rpc_registry%rowtype;
  v_domain_rpc atlas.authenticated_rpc_registry%rowtype;
  v_public_oid oid;
  v_domain_oid oid;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_declared_knower:=coalesce(nullif(v_policy.metadata->>'knowerClass',''),nullif(v_policy.action_spec->>'knowerClass',''));
  v_adapter:=coalesce(nullif(v_policy.metadata->>'workerObservationAdapter',''),nullif(v_policy.action_spec->>'workerObservationAdapter',''));
  v_search_adapter:=coalesce(nullif(v_policy.metadata->>'searchAdapter',''),nullif(v_policy.action_spec->>'searchAdapter',''));
  v_observation_key:=coalesce(nullif(v_policy.metadata->>'workerObservationKey',''),nullif(v_policy.action_spec->>'workerObservationKey',''));
  v_prompt:=coalesce(nullif(v_policy.metadata->>'workerObservationPrompt',''),nullif(v_policy.action_spec->>'actionLabel',''),'Observe the missing fact');

  if v_declared_knower<>'worker_observable' then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,'available',false,'state','not_declared_worker_observable');
  end if;
  if v_adapter<>'crop_observation_v1' or v_search_adapter<>'crop_latest_observation_v1' or v_instance.subject_kind<>'crop_cycle' or v_observation_key is null then
    return jsonb_build_object(
      'contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,
      'available',false,'state','adapter_contract_unresolved','adapter',v_adapter,'searchAdapter',v_search_adapter,'observationKey',v_observation_key,
      'truthBoundary',jsonb_build_object('workerObservableDoesNotImplyExecutableWorkerPath',true)
    );
  end if;
  if not exists(select 1 from atlas.crop_observation_types where observation_key=v_observation_key and active) then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,'available',false,'state','observation_type_unresolved','observationKey',v_observation_key);
  end if;

  v_public_oid:=to_regprocedure(v_public_sig)::oid;
  v_domain_oid:=to_regprocedure(v_domain_sig)::oid;
  select * into v_public_rpc from atlas.authenticated_rpc_registry where signature=v_public_sig;
  select * into v_domain_rpc from atlas.authenticated_rpc_registry where signature=v_domain_sig;
  if v_public_oid is null or v_domain_oid is null
     or v_public_rpc.signature is null or v_public_rpc.review_status<>'active' or not v_public_rpc.authenticated_execute_expected or v_public_rpc.anonymous_execute_expected
     or v_domain_rpc.signature is null or v_domain_rpc.review_status<>'active' or not v_domain_rpc.authenticated_execute_expected or v_domain_rpc.anonymous_execute_expected then
    return jsonb_build_object(
      'contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,
      'available',false,'state','writer_contract_unavailable','publicWriter',v_public_sig,'domainWriter',v_domain_sig,
      'truthBoundary',jsonb_build_object('workerPathRequiresGovernedCanonicalWriter',true)
    );
  end if;

  select * into v_cycle from atlas.crop_cycles where id=v_instance.subject_id and farm_id=v_instance.farm_id and lifecycle_status='active';
  if v_cycle.id is null then return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,'available',false,'state','subject_unavailable'); end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id and farm_id=v_instance.farm_id;
  if v_object.id is null then return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,'available',false,'state','object_unresolved'); end if;

  if v_instance.carrier_task_id is not null then
    select t.* into v_task
    from atlas.tasks t
    join atlas.farm_memberships fm on fm.id=t.assigned_membership_id and fm.active and fm.role='farm_hand' and fm.farm_id=t.farm_id
    where t.id=v_instance.carrier_task_id and t.farm_id=v_instance.farm_id and t.status in ('open','blocked');
    if v_task.id is not null then
      select * into v_worker from atlas.farm_memberships where id=v_task.assigned_membership_id;
    end if;
  end if;

  if v_worker.id is null then
    select count(*)::integer into v_worker_count from atlas.farm_memberships where farm_id=v_instance.farm_id and active and role='farm_hand';
    if v_worker_count=1 then
      select * into v_worker from atlas.farm_memberships where farm_id=v_instance.farm_id and active and role='farm_hand' order by created_at,id limit 1;
    else
      return jsonb_build_object(
        'contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,
        'available',false,'state','observer_unresolved','eligibleWorkerCount',v_worker_count,
        'truthBoundary',jsonb_build_object('doesNotChooseArbitraryWorker',true,'existingAssignedCarrierMayResolveObserver',true)
      );
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_worker_observation_support_v1','instanceId',v_instance.id,
    'available',true,'state','ready','adapter',v_adapter,'searchAdapter',v_search_adapter,'observationKey',v_observation_key,'prompt',v_prompt,
    'workerMembershipId',v_worker.id,'workerUserId',v_worker.user_id,
    'cropCycleId',v_cycle.id,'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'publicWriterSignature',v_public_sig,'domainWriterSignature',v_domain_sig,
    'truthBoundary',jsonb_build_object(
      'observationIsLegitimateWork',true,'taskCarrierIsNotTruth',true,'workerPathRequiresGovernedCanonicalWriter',true,
      'workerNotChosenArbitrarily',true,'workerObservableDoesNotCreateAuthority',true
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
  v_worker_response jsonb;
  v_worker_support jsonb;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;
  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);
  v_owner_response:=v_instance.epistemic_basis->'ownerKnowledgeResponse';
  v_worker_response:=v_instance.epistemic_basis->'workerObservationResponse';

  if v_search->>'verdict'='authoritative_answer_found' then
    v_knower_class:='already_known'; v_acquisition_surface:='none';
  elsif v_search->>'verdict'='contradictory_answers_found' then
    v_knower_class:='contradictory'; v_acquisition_surface:='owner_review';
  elsif v_owner_response->>'kind'='i_do_not_know'
        and coalesce((v_owner_response->>'releaseGeneration')::integer,-1)=v_instance.release_generation then
    v_knower_class:='actually_unknown'; v_acquisition_surface:='unresolved_unknown';
  elsif v_worker_response->>'kind'='cannot_establish'
        and coalesce((v_worker_response->>'releaseGeneration')::integer,-1)=v_instance.release_generation then
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
      v_worker_support:=atlas.truth_acquisition_worker_observation_support_v1(v_instance.id);
      v_acquisition_surface:=case when coalesce((v_worker_support->>'available')::boolean,false) then 'worker_observation' else 'unresolved_unknown' end;
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
    'contractVersion','truth_acquisition_knower_v1','instanceId',v_instance.id,'search',v_search,
    'knowerClass',v_knower_class,'acquisitionSurface',v_acquisition_surface,'jurisdiction',v_jurisdiction,
    'askOwner',(v_acquisition_surface='atlas_needs_from_you'),'ownerKnowledgeResponse',v_owner_response,'workerObservationResponse',v_worker_response,
    'workerObservationSupport',v_worker_support,
    'truthBoundary',jsonb_build_object(
      'knowerClassificationDoesNotCreateFact',true,'ownerQuestionRequiresSearchFirst',true,
      'ownerDoesNotKnowDoesNotResolveFact',true,'workerCannotEstablishDoesNotResolveFact',true,
      'workerObservationRequiresWorkerObservableClass',true,'workerObservationRequiresExecutableSupport',true,
      'externalInformationDoesNotBecomeInternalDecision',true
    )
  );
end;
$function$;

create or replace function atlas.truth_acquisition_worker_observation_plan_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_support jsonb;
  v_search jsonb;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  if v_search->>'verdict'='authoritative_answer_found' then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','already_known','ready',false,'search',v_search);
  end if;
  v_support:=atlas.truth_acquisition_worker_observation_support_v1(v_instance.id);
  return jsonb_build_object(
    'contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,
    'state',case when coalesce((v_support->>'available')::boolean,false) then 'ready' else coalesce(v_support->>'state','unavailable') end,
    'ready',coalesce((v_support->>'available')::boolean,false),
    'adapter',v_support->>'adapter','observationKey',v_support->>'observationKey','prompt',v_support->>'prompt',
    'workerMembershipId',v_support->>'workerMembershipId','workerUserId',v_support->>'workerUserId',
    'cropCycleId',v_support->>'cropCycleId','objectId',v_support->>'objectId','objectKey',v_support->>'objectKey','objectLabel',v_support->>'objectLabel',
    'support',v_support
  );
end;
$function$;

-- The 21:41 registry/carrier prototype is preserved in migration history but removed
-- from the current surface now that the generalized 21:42 bridge owns Worker acquisition.
drop function if exists atlas.ensure_truth_acquisition_observation_carrier_v1(uuid);
drop function if exists atlas.truth_acquisition_observation_adapter_v1(uuid);
drop table if exists atlas.truth_acquisition_observation_adapters;

revoke all on function atlas.truth_acquisition_worker_observation_support_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_knower_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_worker_observation_plan_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.truth_acquisition_worker_observation_support_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_knower_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_worker_observation_plan_v1(uuid) to service_role;

comment on function atlas.truth_acquisition_worker_observation_support_v1(uuid) is
'Tranche 1E fail-closed support proof. A worker-observable classification becomes a Worker acquisition surface only when the policy names a supported canonical observation/search adapter, the observation type exists, governed writers are active, the subject/object resolve, and a worker can be lawfully routed without arbitrary choice.';