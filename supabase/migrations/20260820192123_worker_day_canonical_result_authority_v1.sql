create or replace function atlas.worker_task_requires_structured_result_v1(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_metadata jsonb;
  v_route text;
  v_created_from text;
  v_joined text;
  v_quick text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return true; end if;

  v_metadata:=coalesce(v_task.metadata,'{}'::jsonb);
  v_route:=lower(btrim(coalesce(v_metadata->>'work_route','')));
  v_created_from:=lower(btrim(coalesce(v_metadata->>'created_from','')));
  v_joined:=lower(concat_ws(' ',v_task.task_type,v_task.action_key,v_task.generated_from,v_route,v_created_from));
  v_quick:=lower(btrim(coalesce(v_metadata->>'quick_complete_allowed','')));

  if v_quick in ('true','yes','1') then return false; end if;
  if v_quick in ('false','no','0') then return true; end if;

  if lower(btrim(coalesce(v_metadata->>'structured_result_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'result_capture_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'planting_log_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'requires_result',''))) in ('true','yes','1')
     or nullif(btrim(coalesce(v_metadata->>'capture_kind','')),'') is not null
  then return true; end if;

  if v_route in ('crop_cycle','seed','plant','harvest')
     or v_created_from='crop_cycle_triggered_sequence'
     or v_metadata ? 'crop_cycle_id'
     or v_metadata ? 'crop_cycle_key'
     or v_metadata ? 'crop_profile_stable_key'
     or lower(coalesce(v_task.action_key,'')) in ('sow','seed_sowing','plant','transplant','harvest')
     or v_joined ~ '(germination|harvest|transplant|planting|readiness|production)'
  then return true; end if;

  return false;
end;
$$;

revoke all on function atlas.worker_task_requires_structured_result_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.worker_task_requires_structured_result_v1(uuid) to service_role;

create or replace function atlas.worker_state_transition_card_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean;
  v_is_germination boolean:=false;
  v_is_direct_sow_seed boolean:=false;
  v_requires_structured boolean:=true;
  v_result_contract jsonb;
begin
  v_card:=atlas.worker_state_transition_card_pre_or4_v2(
    p_farm_id,p_membership_id,p_task_id,p_service_date
  );
  v_card:=atlas.worker_state_transition_selection_bridge_v1(
    p_farm_id,p_membership_id,p_task_id,p_service_date,v_card
  );

  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination:=atlas.is_germination_task_v1(v_task);
    v_is_direct_sow_seed:=coalesce(v_task.metadata->>'seed_governance_required','false')='true'
      and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
      and (coalesce(v_task.action_key,'')='sow' or coalesce(v_task.metadata->>'work_route','')='sow');
    v_requires_structured:=atlas.worker_task_requires_structured_result_v1(v_task.id);
  end if;
  v_authorized:=coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day';

  v_result_contract:=case
    when not v_authorized then jsonb_build_object(
      'state','operation_result_not_authorized','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','No result may be returned for an operation Reality Expression has not authorized.'
    )
    when v_is_germination then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','worker_record_state_transition_result_v1','domainAdapter','germination_observation_v2',
      'choices',jsonb_build_array('not_yet','beginning','germinated','failed_or_uncertain','problem_found'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('germinated',jsonb_build_array('resultPayload.spacingOutcome'),'spacingOutcomeChoices',jsonb_build_array('thin','on_target','patch')),
      'optionalFields',jsonb_build_array('quantity','unit','note','resultPayload.targetSpacingInches'),
      'doneInvariant','Germinated closes the task only inside the same transaction that records the operation actual and reclassifies the canonical crop-cycle state.',
      'observationInvariant','The worker returns the physical observation; Atlas derives task status, rhythm satisfaction, continuation, and any handoff from that observation.'
    )
    when v_is_direct_sow_seed then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','record_direct_sow_seed_result_for_member_v1','domainAdapter','direct_sow_seed_v1',
      'choices',jsonb_build_array('depleted','exact_remaining','some_left_unknown'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('exact_remaining',jsonb_build_array('remainingQuantity')),
      'optionalFields',jsonb_build_array('note'),
      'doneInvariant','The sowing task closes only after the seed remainder event is recorded and the canonical seed state is reclassified in the same transaction.',
      'observationInvariant','Report only what is physically known after sowing: none left, an exact remaining count, or some left but unmeasured. Atlas must not infer an exact balance from task completion.'
    )
    when v_requires_structured then jsonb_build_object(
      'state','structured_result_adapter_required','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','This authorized operation needs a domain result adapter before generic Done is allowed.'
    )
    else jsonb_build_object(
      'state','quick_complete_v1_available','contractVersion','worker_quick_complete_v1',
      'choices',jsonb_build_array('done'),'requiredFields',jsonb_build_array('idempotencyKey'),'optionalFields',jsonb_build_array('note'),
      'transition','done',
      'principle','This authorized operation may close through the canonical task transition because no additional domain witness fields are required.'
    )
  end;

  v_card:=jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card:=jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,quickCompleteAuthority}',to_jsonb('canonical_result_return'::text),true);
  return v_card;
end;
$$;

create or replace function atlas.worker_day_operational_task_cards_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_service_date date,
  p_task_ids uuid[]
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cards jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_card jsonb;
  v_task_id uuid;
  v_readiness jsonb;
  v_status text;
  v_transition_card jsonb;
  v_result_state text;
  v_metadata jsonb;
begin
  v_cards:=atlas.worker_day_operational_task_cards_v2(
    p_farm_id,p_membership_id,p_service_date,p_task_ids
  );

  for v_card in select value from jsonb_array_elements(v_cards)
  loop
    v_task_id:=nullif(v_card->>'task_id','')::uuid;
    v_status:=coalesce(v_card->>'status','');
    v_readiness:=atlas.task_execution_readiness_v1(v_task_id);

    if v_status='done' or coalesce((v_readiness->>'ready')::boolean,false) then
      v_transition_card:=case when v_status='done' then null else atlas.worker_state_transition_card_v2(
        p_farm_id,p_membership_id,v_task_id,p_service_date
      ) end;
      v_result_state:=coalesce(v_transition_card #>> '{resultReturn,state}','');
      v_metadata:=coalesce(v_card->'metadata','{}'::jsonb)
        || jsonb_build_object(
          'quick_complete_allowed',v_result_state='quick_complete_v1_available',
          'structured_result_required',v_result_state in ('structured_result_v1_available','structured_result_adapter_required'),
          'worker_result_return_state',nullif(v_result_state,''),
          'worker_transition_state',nullif(v_transition_card #>> '{transition,state}',''),
          'worker_result_authority','worker_state_transition_card_v2'
        );

      v_result:=v_result || jsonb_build_array(
        v_card
        || jsonb_build_object(
          'metadata',v_metadata,
          'worker_transition_card',v_transition_card,
          'resource_requirements',atlas.task_resource_requirement_packet_v1(v_task_id),
          'execution_readiness',v_readiness,
          'state_consequence_gate',v_readiness->'stateConsequenceGate',
          'preparation_required',coalesce((v_readiness->>'preparationRequired')::boolean,false)
        )
      );
    end if;
  end loop;

  return v_result;
end;
$$;