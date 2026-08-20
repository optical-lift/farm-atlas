create or replace function atlas.ensure_crop_harvest_requirement_execution_v1(p_requirement_instance_id uuid,p_as_of_date date default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date); v_req atlas.state_consequence_instances%rowtype;
  v_cycle atlas.crop_cycles%rowtype; v_availability atlas.crop_harvest_availability%rowtype; v_event atlas.crop_harvest_events%rowtype;
  v_warrant jsonb; v_assignee jsonb; v_membership_id uuid; v_existing_membership uuid; v_result jsonb; v_task_id uuid; v_occurrence_id uuid;
begin
  select * into v_req from atlas.state_consequence_instances where id=p_requirement_instance_id for update;
  if v_req.id is null then raise exception 'Requirement instance not found.' using errcode='P0002'; end if;
  if v_req.status<>'open' or v_req.consequence_role<>'operation_requirement' or v_req.subject_kind<>'crop_cycle' or v_req.action_key<>'harvest' then
    return jsonb_build_object('contractVersion','ensure_crop_harvest_requirement_execution_v1','state','not_open_harvest_requirement','requirementInstanceId',v_req.id); end if;
  select * into v_cycle from atlas.crop_cycles where id=v_req.subject_id;
  select * into v_availability from atlas.crop_harvest_availability where crop_cycle_id=v_cycle.id;
  v_warrant:=atlas.crop_operation_execution_warrant_v1(v_cycle.id,'harvest',v_req.id);
  if not coalesce((v_warrant->>'executionReady')::boolean,false) then return jsonb_build_object('contractVersion','ensure_crop_harvest_requirement_execution_v1',
    'state','warrant_not_ready','requirementInstanceId',v_req.id,'warrant',v_warrant); end if;
  if v_availability.source_event_id is not null then
    select * into v_event from atlas.crop_harvest_events where id=v_availability.source_event_id;
    if v_event.task_id is not null then
      select t.assigned_membership_id into v_existing_membership from atlas.tasks t where t.id=v_event.task_id;
      if not exists(select 1 from atlas.farm_memberships fm where fm.id=v_existing_membership and fm.farm_id=v_req.farm_id and fm.active and fm.role='farm_hand') then v_existing_membership:=null; end if;
    end if;
  end if;
  if v_existing_membership is not null then v_membership_id:=v_existing_membership;
  else
    v_assignee:=atlas.requirement_execution_assignee_v1(v_req.id);
    if coalesce(v_assignee->>'state','')<>'resolved' then return jsonb_build_object('contractVersion','ensure_crop_harvest_requirement_execution_v1',
      'state','executor_routing_required','requirementInstanceId',v_req.id,'assignee',v_assignee,'warrant',v_warrant); end if;
    v_membership_id=(v_assignee->>'membershipId')::uuid;
  end if;
  v_result:=atlas.ensure_crop_harvest_task_v1(v_cycle.id,v_availability.source_event_id,v_day,v_membership_id);
  begin v_task_id:=nullif(v_result->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is null then select current_harvest_task_id,current_harvest_occurrence_id into v_task_id,v_occurrence_id from atlas.crop_harvest_availability where crop_cycle_id=v_cycle.id;
  else select planned_occurrence_id into v_occurrence_id from atlas.tasks where id=v_task_id; end if;
  if v_task_id is not null then
    update atlas.tasks set work_lane='required',commitment_kind='persistent',sky_deferral_mode='never',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('task_style','requirement_execution_harvest',
        'source_requirement_instance_id',v_req.id,'source_requirement_action','harvest','requirement_onset_date',v_req.requirement_onset_date,
        'requirement_known_active_by',v_req.requirement_known_active_by,'requirement_time_class',v_req.requirement_time_class,'requirement_released_at',v_req.released_at,
        'requirement_statement',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label)||' needs harvested.',
        'execution_statement','Harvestability is established. Record actual physical output through the existing Harvest result flow.',
        'due_date_semantics','execution_release_date_not_requirement_onset','work_lane','required','commitment_kind','persistent','date_commitment','persistent',
        'commercial_target_state',atlas.crop_harvest_commercial_target_state_v1(v_cycle.id)->>'state','commercial_target_blocks_execution',false,
        'truthBoundary',jsonb_build_object('taskIsExecutionCarrierNotRequirement',true,'taskDueDateDoesNotResetRequirementClock',true,
          'buyerUnknownDoesNotBlockHarvest',true,'harvestResultUsesExistingPhysicalOutputMembrane',true,'harvestDoesNotCreateReadyInventory',true))),updated_at=now()
    where id=v_task_id;
  end if;
  if v_occurrence_id is not null then update atlas.planned_work_occurrences set work_lane='required',commitment_kind='persistent',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('sourceRequirementInstanceId',v_req.id,'requirementClockPreserved',true),updated_at=now() where id=v_occurrence_id; end if;
  return jsonb_build_object('contractVersion','ensure_crop_harvest_requirement_execution_v1','state',case when v_task_id is null then coalesce(v_result->>'state','planned') else 'execution_released' end,
    'requirementInstanceId',v_req.id,'taskId',v_task_id,'occurrenceId',v_occurrence_id,'warrant',v_warrant,'harvestTaskResult',v_result,
    'truthBoundary',jsonb_build_object('existingHarvestEngineReused',true,'commercialGapIsNonBlocking',true,'requirementClockPreserved',true));
end;$function$;
revoke all on function atlas.ensure_crop_harvest_requirement_execution_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.ensure_crop_harvest_requirement_execution_v1(uuid,date) to service_role;

create or replace function atlas.reconcile_crop_harvest_requirement_and_execution_v1(p_crop_cycle_id uuid,p_as_of_date date default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare v_reconcile jsonb; v_req_id uuid; v_execution jsonb;
begin
  v_reconcile:=atlas.reconcile_crop_cycle_requirement_state_v1(p_crop_cycle_id);
  select id into v_req_id from atlas.state_consequence_instances where subject_kind='crop_cycle' and subject_id=p_crop_cycle_id
    and consequence_role='operation_requirement' and action_key='harvest' and status='open' order by released_at desc,id limit 1;
  if v_req_id is not null then v_execution:=atlas.ensure_requirement_execution_v1(v_req_id,p_as_of_date); end if;
  return jsonb_strip_nulls(jsonb_build_object('contractVersion','reconcile_crop_harvest_requirement_and_execution_v1','cropCycleId',p_crop_cycle_id,
    'requirementReconcile',v_reconcile,'requirementInstanceId',v_req_id,'execution',v_execution));
end;$function$;
revoke all on function atlas.reconcile_crop_harvest_requirement_and_execution_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_harvest_requirement_and_execution_v1(uuid,date) to service_role;

create or replace function atlas.ensure_harvest_commercial_target_task_v1(p_instance_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype; v_req atlas.state_consequence_instances%rowtype; v_cycle atlas.crop_cycles%rowtype;
  v_jurisdiction jsonb; v_membership_id uuid; v_user_id uuid; v_subject text; v_occurrence_id uuid; v_materialized jsonb; v_task_id uuid; v_existing atlas.tasks%rowtype;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'Truth acquisition instance not found.' using errcode='P0002'; end if;
  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' or v_instance.action_key<>'choose_harvest_disposition' then return jsonb_build_object('state','not_open_harvest_commercial_target','instanceId',v_instance.id); end if;
  select * into v_req from atlas.state_consequence_instances where id=v_instance.source_requirement_instance_id;
  select * into v_cycle from atlas.crop_cycles where id=v_instance.subject_id;
  if v_req.id is null or v_cycle.id is null then return jsonb_build_object('state','source_requirement_or_crop_missing','instanceId',v_instance.id); end if;
  if v_instance.carrier_task_id is not null then select * into v_existing from atlas.tasks where id=v_instance.carrier_task_id;
    if v_existing.id is not null and v_existing.status in ('open','blocked') then return jsonb_build_object('contractVersion','ensure_harvest_commercial_target_task_v1','state','carrier_ready','instanceId',v_instance.id,'taskId',v_existing.id,'created',false); end if; end if;
  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);
  begin v_membership_id:=nullif(v_jurisdiction->>'membershipId','')::uuid; exception when others then v_membership_id:=null; end;
  begin v_user_id:=nullif(v_jurisdiction->>'userId','')::uuid; exception when others then v_user_id:=null; end;
  if v_membership_id is null then return jsonb_build_object('state','jurisdiction_unresolved','instanceId',v_instance.id,'jurisdiction',v_jurisdiction); end if;
  v_subject:=coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop');
  v_occurrence_id:=atlas.plan_work_occurrence_v1(p_farm_id=>v_instance.farm_id,p_definition_key=>'truth-acquisition:crop-harvest-commercial-target',
    p_policy_key=>'truth-acquisition:crop-harvest-commercial-target:one-active',p_occurrence_key=>'truth-acquisition:'||v_instance.id::text||':carrier:'||v_instance.release_generation::text,
    p_title=>v_subject||' needs harvested — decide where it is going',p_task_type=>'harvest_disposition_decision',
    p_due_date=>coalesce(v_req.requirement_known_active_by,(now() at time zone 'America/Chicago')::date),p_source_kind=>'state_consequence_truth_acquisition',p_source_id=>v_instance.id,
    p_gate_type=>'immediate',p_horizon_days=>0,p_maximum_active_instances=>1,
    p_task_payload=>jsonb_build_object('title',v_subject||' needs harvested — decide where it is going','task_type','harvest_disposition_decision','priority','high',
      'due_date',coalesce(v_req.requirement_known_active_by,(now() at time zone 'America/Chicago')::date),'action_key','choose_harvest_disposition','work_class','farm_admin',
      'work_lane','required','commitment_kind','persistent','task_scope','farm_operation','origin_kind','generated','visibility_scope','owner',
      'assigned_membership_id',v_membership_id,'assigned_user_id',v_user_id,
      'metadata',jsonb_build_object('task_style','truth_acquisition_harvest_commercial_target','state_consequence_instance_id',v_instance.id,
        'source_requirement_instance_id',v_req.id,'source_requirement_action','harvest','gap_kind','commercial_target_required','jurisdiction','owner',
        'requirement_known_active_by',v_req.requirement_known_active_by,'requirement_onset_date',v_req.requirement_onset_date,'requirement_time_class',v_req.requirement_time_class,
        'inherited_urgency',true,'work_lane','required','commitment_kind','persistent','date_commitment','persistent','display_action','Decide where this harvest is going',
        'display_subject',v_subject,'display_detail',v_subject||' needs harvested. Atlas does not have a committed commercial target yet.',
        'requirement_statement',v_subject||' needs harvested.','missing_truth_statement','Atlas does not have a committed buyer/channel target for this harvest yet.',
        'execution_statement','Harvest may proceed on biological timing. This decision governs commercial disposition, not whether the crop needs harvested.',
        'commercial_target_blocks_harvest',false,'truthBoundary',jsonb_build_object('taskIsCarrierNotRequirement',true,'taskCompletionDoesNotEstablishCommercialTruth',true,
          'commercialTruthComesFromIndependentDemandEvidence',true,'buyerUnknownDoesNotBlockHarvestExecution',true))),
    p_gate_config=>jsonb_build_object('automatic',true,'source_kind','state_consequence_truth_acquisition'),
    p_not_before_date=>coalesce(v_req.requirement_known_active_by,(now() at time zone 'America/Chicago')::date),
    p_metadata=>jsonb_build_object('stateConsequenceInstanceId',v_instance.id,'sourceRequirementInstanceId',v_req.id,'gapKind','commercial_target_required'));
  v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,(now() at time zone 'America/Chicago')::date);
  begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is not null then update atlas.state_consequence_instances set carrier_task_id=v_task_id,
    epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object('carrierTaskId',v_task_id,'carrierJurisdiction','owner','carrierReconciledBy','ensure_harvest_commercial_target_task_v1'),updated_at=now() where id=v_instance.id; end if;
  return jsonb_build_object('contractVersion','ensure_harvest_commercial_target_task_v1','state',case when v_task_id is null then 'carrier_planned' else 'carrier_ready' end,
    'instanceId',v_instance.id,'sourceRequirementInstanceId',v_req.id,'taskId',v_task_id,'occurrenceId',v_occurrence_id,'created',v_task_id is not null,
    'truthBoundary',jsonb_build_object('commercialDecisionDoesNotBlockHarvest',true,'taskIsCarrierNotTruthAuthority',true));
end;$function$;
revoke all on function atlas.ensure_harvest_commercial_target_task_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_harvest_commercial_target_task_v1(uuid) to service_role;

do $patch_truth_carrier$ declare v_def text; v_old text; v_new text; begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='atlas' and p.proname='ensure_truth_acquisition_task_v1';
 v_old:=$old$  if v_instance.subject_kind<>'crop_cycle' or v_instance.action_key<>'choose_transplant_destination' then
    return jsonb_build_object($old$;
 v_new:=$new$  if v_instance.subject_kind='crop_cycle' and v_instance.action_key='choose_harvest_disposition' then
    return atlas.ensure_harvest_commercial_target_task_v1(v_instance.id);
  end if;

  if v_instance.subject_kind<>'crop_cycle' or v_instance.action_key<>'choose_transplant_destination' then
    return jsonb_build_object($new$;
 if v_def is null or strpos(v_def,v_old)=0 then raise exception 'ensure_truth_acquisition_task_v1 P9 patch point not found'; end if; execute replace(v_def,v_old,v_new); end $patch_truth_carrier$;

do $patch_execution$ declare v_def text; v_old text; v_new text; begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='atlas' and p.proname='ensure_requirement_execution_v1';
 v_old:=$old$  if v_req.subject_kind<>'crop_cycle' or v_req.action_key<>'transplant' then
    return jsonb_build_object($old$;
 v_new:=$new$  if v_req.subject_kind='crop_cycle' and v_req.action_key='harvest' then
    return atlas.ensure_crop_harvest_requirement_execution_v1(v_req.id,v_day);
  end if;

  if v_req.subject_kind<>'crop_cycle' or v_req.action_key<>'transplant' then
    return jsonb_build_object($new$;
 if v_def is null or strpos(v_def,v_old)=0 then raise exception 'ensure_requirement_execution_v1 P9 patch point not found'; end if; execute replace(v_def,v_old,v_new); end $patch_execution$;

do $patch_harvest_watch$ declare v_def text; begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='atlas' and p.proname='record_harvest_watch_observation_core_v1';
 if v_def is null or strpos(v_def,'v_harvest:=atlas.ensure_crop_harvest_task_v1(v_cycle.id,v_event.id,v_today,v_task.assigned_membership_id);')=0 then raise exception 'harvest watch P9 patch point not found'; end if;
 execute replace(v_def,'v_harvest:=atlas.ensure_crop_harvest_task_v1(v_cycle.id,v_event.id,v_today,v_task.assigned_membership_id);','v_harvest:=atlas.reconcile_crop_harvest_requirement_and_execution_v1(v_cycle.id,v_today);'); end $patch_harvest_watch$;

do $patch_parent_history$ declare v_def text; v_old text; v_new text; begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='atlas' and p.proname='classify_state_consequence_instance_v1';
 v_old:=$old$      new.source_requirement_instance_id:=v_parent_id;
    else
      new.source_requirement_instance_id:=null;
    end if;$old$;
 v_new:=$new$      new.source_requirement_instance_id:=coalesce(v_parent_id,case when tg_op='UPDATE' then old.source_requirement_instance_id end);
    else
      new.source_requirement_instance_id:=case when tg_op='UPDATE' then old.source_requirement_instance_id else null end;
    end if;$new$;
 if v_def is null or strpos(v_def,v_old)=0 then raise exception 'classify consequence P9 patch point not found'; end if; execute replace(v_def,v_old,v_new); end $patch_parent_history$;

create or replace function atlas.reconcile_harvest_availability_requirement_v1() returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.source_event_id is distinct from old.source_event_id then
   if new.status='harvestable' then perform atlas.reconcile_crop_harvest_requirement_and_execution_v1(new.crop_cycle_id,coalesce(new.observed_date,(now() at time zone 'America/Chicago')::date));
   else perform atlas.reconcile_crop_cycle_requirement_state_v1(new.crop_cycle_id); end if;
 end if; return new;
end;$function$;
revoke all on function atlas.reconcile_harvest_availability_requirement_v1() from public,anon,authenticated; grant execute on function atlas.reconcile_harvest_availability_requirement_v1() to service_role;
drop trigger if exists p9_harvest_availability_requirement on atlas.crop_harvest_availability;
create trigger p9_harvest_availability_requirement after insert or update of status,source_event_id on atlas.crop_harvest_availability for each row execute function atlas.reconcile_harvest_availability_requirement_v1();