-- P2: Requirement Expression, narrow crop specimen.
-- Requirement existence is independent of execution warrant.

alter table atlas.state_consequence_instances
  add column if not exists consequence_role text not null default 'state_consequence',
  add column if not exists source_requirement_instance_id uuid null,
  add column if not exists requirement_onset_date date null,
  add column if not exists requirement_known_active_by date null,
  add column if not exists requirement_time_class text null,
  add column if not exists epistemic_basis jsonb not null default '{}'::jsonb;

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_consequence_role_check;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_consequence_role_check
  check (consequence_role in ('state_consequence','operation_requirement','truth_acquisition','repair_or_resolution','preparation'));

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_requirement_time_class_check;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_requirement_time_class_check
  check (requirement_time_class is null or requirement_time_class in ('exact','bounded','known_active_by','reconstructed_onset_unknown'));

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_epistemic_basis_object_check;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_epistemic_basis_object_check
  check (jsonb_typeof(epistemic_basis)='object');

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_source_requirement_fk;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_source_requirement_fk
  foreign key (source_requirement_instance_id)
  references atlas.state_consequence_instances(id)
  on delete set null;

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_source_requirement_not_self_check;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_source_requirement_not_self_check
  check (source_requirement_instance_id is null or source_requirement_instance_id<>id);

create index if not exists state_consequence_instances_source_requirement_idx
  on atlas.state_consequence_instances(source_requirement_instance_id)
  where source_requirement_instance_id is not null;

create index if not exists state_consequence_instances_role_subject_idx
  on atlas.state_consequence_instances(consequence_role,subject_kind,subject_id,status,priority);

comment on column atlas.state_consequence_instances.consequence_role is
'Constitutional role of the consequence. operation_requirement states what reality requires; truth_acquisition obtains missing warrant; repair/preparation remain distinct continuations.';
comment on column atlas.state_consequence_instances.source_requirement_instance_id is
'When this consequence exists to acquire truth or resolve a gap for another requirement, this links it causally to the source operation requirement.';
comment on column atlas.state_consequence_instances.requirement_onset_date is
'Actual requirement onset only when Atlas has warrant to state it. NULL preserves unknown historical onset.';
comment on column atlas.state_consequence_instances.requirement_known_active_by is
'Latest date by which evidence establishes the requirement was already active. This is not silently promoted to exact onset.';
comment on column atlas.state_consequence_instances.requirement_time_class is
'Epistemic precision of requirement time. known_active_by means the requirement was certainly active by that date but may have begun earlier.';

create or replace function atlas.crop_cycle_requirement_snapshot_v1(
  p_crop_cycle_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_day date:=coalesce(p_as_of_date,current_date);
  v_destination jsonb;
  v_profile_exists boolean:=false;
  v_transplant_required boolean:=false;
  v_first_witness_date date;
  v_hardening_started date;
  v_time_class text;
  v_onset date;
  v_known_active_by date;
begin
  if p_crop_cycle_id is null then raise exception 'Crop cycle is required.' using errcode='22023'; end if;
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_profile_exists:=v_cycle.crop_profile_id is not null and exists(select 1 from atlas.crop_profiles cp where cp.id=v_cycle.crop_profile_id);
  v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);

  begin
    v_hardening_started:=nullif(v_cycle.metadata->>'hardening_started_date','')::date;
  exception when others then
    v_hardening_started:=null;
  end;

  begin
    v_first_witness_date:=nullif(v_cycle.metadata->>'current_state_witness_date','')::date;
  exception when others then
    v_first_witness_date:=null;
  end;
  v_first_witness_date:=coalesce(v_first_witness_date,(v_cycle.created_at at time zone 'America/Chicago')::date);

  v_transplant_required:=coalesce(v_cycle.lifecycle_status,'active')='active'
    and v_cycle.cycle_state='hardening_off'
    and v_cycle.planted_date is null;

  if v_transplant_required then
    -- Hardening start is evidence that the transition process existed, not proof of the exact
    -- moment transplant became due. Preserve exact onset as unknown and keep the first current
    -- state witness as the latest date by which the requirement was already active.
    v_onset:=null;
    v_known_active_by:=v_first_witness_date;
    v_time_class:='known_active_by';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','crop_cycle_requirement_snapshot_v1',
    'subjectKind','crop_cycle',
    'subjectId',v_cycle.id,
    'farmId',v_cycle.farm_id,
    'cropCycleKey',v_cycle.crop_cycle_key,
    'cropLabel',v_cycle.crop_label,
    'variety',v_cycle.variety,
    'lifecycleStatus',v_cycle.lifecycle_status,
    'cycleState',v_cycle.cycle_state,
    'plantedDate',v_cycle.planted_date,
    'profilePresent',v_profile_exists,
    'cropProfileId',v_cycle.crop_profile_id,
    'currentLocation',v_cycle.metadata->>'current_location',
    'containerKind',v_cycle.metadata->>'container_kind',
    'hardeningStartedDate',v_hardening_started,
    'firstCurrentStateWitnessDate',v_first_witness_date,
    'transplantResponseRequired',v_transplant_required,
    'requirementOperationKey',case when v_transplant_required then 'transplant' end,
    'requirementState',case when v_transplant_required then 'due' end,
    'requirementOnsetDate',v_onset,
    'requirementKnownActiveBy',v_known_active_by,
    'requirementTimeClass',v_time_class,
    'requirementEpistemicBasis',case when v_transplant_required then jsonb_build_object(
      'basis','current_canonical_state',
      'witnessState','hardening_off',
      'firstCurrentStateWitnessDate',v_first_witness_date,
      'hardeningStartedDate',v_hardening_started,
      'exactRequirementOnsetEstablished',false,
      'profileRequiredToRecognizeCurrentNeed',false,
      'openTaskRequiredToRecognizeCurrentNeed',false,
      'principle','Current living state may establish a required response even when historical timing/model detail is incomplete.'
    ) else '{}'::jsonb end,
    'destinationCoverageState',v_destination->>'coverageState',
    'destinationReleaseAllowed',coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false),
    'destination',v_destination,
    'asOfDate',v_day,
    'truthBoundary',jsonb_build_object(
      'missingProfileDoesNotEraseCurrentRequirement',true,
      'openTaskDoesNotAutomaticallyCoverEveryRequirement',true,
      'hardeningStartIsNotAutomaticallyExactTransplantDueDate',true,
      'unknownDestinationDoesNotEraseTransplantRequirement',true,
      'requirementClockAndExecutionWarrantAreIndependent',true
    )
  ));
end;
$function$;

revoke all on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) to service_role;

alter function atlas.state_consequence_snapshot_v1(text,uuid)
  rename to state_consequence_snapshot_pre_p2_v1;

create or replace function atlas.state_consequence_snapshot_v1(
  p_subject_kind text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if p_subject_kind='crop_cycle' then
    return atlas.crop_cycle_requirement_snapshot_v1(p_subject_id,(now() at time zone 'America/Chicago')::date);
  end if;
  return atlas.state_consequence_snapshot_pre_p2_v1(p_subject_kind,p_subject_id);
end;
$function$;

revoke all on function atlas.state_consequence_snapshot_pre_p2_v1(text,uuid) from public,anon,authenticated;
revoke all on function atlas.state_consequence_snapshot_v1(text,uuid) from public,anon,authenticated;
grant execute on function atlas.state_consequence_snapshot_pre_p2_v1(text,uuid) to service_role;
grant execute on function atlas.state_consequence_snapshot_v1(text,uuid) to service_role;

create or replace function atlas.classify_state_consequence_instance_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_policy atlas.state_consequence_policies%rowtype;
  v_role text;
  v_parent_policy_key text;
  v_parent_id uuid;
begin
  select * into v_policy from atlas.state_consequence_policies where id=new.policy_id;
  if v_policy.id is null then return new; end if;

  v_role:=coalesce(nullif(v_policy.metadata->>'consequenceRole',''),'state_consequence');
  if v_role not in ('state_consequence','operation_requirement','truth_acquisition','repair_or_resolution','preparation') then
    raise exception 'Unsupported consequenceRole on policy %: %',v_policy.stable_key,v_role using errcode='22023';
  end if;
  new.consequence_role:=v_role;

  if v_role='operation_requirement' then
    begin new.requirement_onset_date:=nullif(new.state_snapshot->>'requirementOnsetDate','')::date;
    exception when others then new.requirement_onset_date:=null; end;
    begin new.requirement_known_active_by:=nullif(new.state_snapshot->>'requirementKnownActiveBy','')::date;
    exception when others then new.requirement_known_active_by:=null; end;
    new.requirement_time_class:=nullif(new.state_snapshot->>'requirementTimeClass','');
    new.epistemic_basis:=case when jsonb_typeof(new.state_snapshot->'requirementEpistemicBasis')='object'
      then new.state_snapshot->'requirementEpistemicBasis' else '{}'::jsonb end;
    new.source_requirement_instance_id:=null;
  else
    new.requirement_onset_date:=null;
    new.requirement_known_active_by:=null;
    new.requirement_time_class:=null;
    new.epistemic_basis:=case when jsonb_typeof(v_policy.metadata->'epistemicBasis')='object'
      then v_policy.metadata->'epistemicBasis' else '{}'::jsonb end;

    v_parent_policy_key:=nullif(v_policy.metadata->>'sourceRequirementPolicyKey','');
    if v_parent_policy_key is not null then
      select i.id into v_parent_id
      from atlas.state_consequence_instances i
      join atlas.state_consequence_policies p on p.id=i.policy_id
      where i.subject_kind=new.subject_kind
        and i.subject_id=new.subject_id
        and i.status='open'
        and p.stable_key=v_parent_policy_key
      order by i.released_at desc,i.id
      limit 1;
      new.source_requirement_instance_id:=v_parent_id;
    else
      new.source_requirement_instance_id:=null;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function atlas.classify_state_consequence_instance_v1() from public,anon,authenticated;
grant execute on function atlas.classify_state_consequence_instance_v1() to service_role;

drop trigger if exists classify_state_consequence_instance_v1 on atlas.state_consequence_instances;
create trigger classify_state_consequence_instance_v1
before insert or update of policy_id,subject_kind,subject_id,state_snapshot
on atlas.state_consequence_instances
for each row execute function atlas.classify_state_consequence_instance_v1();

insert into atlas.state_consequence_policies(
  stable_key,subject_kind,subject_selector,state_match,consequence_kind,action_key,audience,priority,action_spec,metadata
) values
(
  'crop-hardening-off-transplant-response-required',
  'crop_cycle','{}'::jsonb,jsonb_build_object('transplantResponseRequired',true),
  'biological_operation_requirement','transplant','farm_operations',10,
  jsonb_build_object(
    'state','operation_required',
    'action','transplant',
    'actionLabel','Plant crop',
    'surfaceGrammar','reality_first',
    'principle','The living body may require transplant before destination or other execution warrant is complete.'
  ),
  jsonb_build_object(
    'contract','requirement_truth_acquisition_execution_p2',
    'consequenceRole','operation_requirement',
    'requirementDomain','crop_biology',
    'executionTaskMayNotExistYet',true,
    'missingProfileDoesNotSuppress',true,
    'openTaskDoesNotSuppress',true
  )
),
(
  'crop-transplant-destination-truth-required',
  'crop_cycle','{}'::jsonb,jsonb_build_object('transplantResponseRequired',true,'destinationCoverageState','missing'),
  'planning_resolution','choose_transplant_destination','farm_operations_management',20,
  jsonb_build_object(
    'state','truth_acquisition_required',
    'action','choose_transplant_destination',
    'actionLabel','Choose where to plant it',
    'factNeeded','lawful transplant destination',
    'jurisdiction','owner_or_manager',
    'blocksExecution',true,
    'doesNotEraseRequirement',true
  ),
  jsonb_build_object(
    'contract','requirement_truth_acquisition_execution_p2',
    'consequenceRole','truth_acquisition',
    'sourceRequirementPolicyKey','crop-hardening-off-transplant-response-required',
    'gapKind','destination_required',
    'jurisdiction','owner_or_manager',
    'inheritsRequirementUrgency',true
  )
)
on conflict(stable_key) do update set
  subject_kind=excluded.subject_kind,
  subject_selector=excluded.subject_selector,
  state_match=excluded.state_match,
  consequence_kind=excluded.consequence_kind,
  action_key=excluded.action_key,
  audience=excluded.audience,
  priority=excluded.priority,
  action_spec=excluded.action_spec,
  active=true,
  metadata=excluded.metadata,
  updated_at=now();

create or replace function atlas.crop_operation_execution_warrant_v1(
  p_crop_cycle_id uuid,
  p_operation_key text,
  p_requirement_instance_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_requirement atlas.state_consequence_instances%rowtype;
  v_destination jsonb;
  v_gaps jsonb:='[]'::jsonb;
  v_nonblocking jsonb:='[]'::jsonb;
  v_operation text:=lower(btrim(coalesce(p_operation_key,'')));
  v_ready boolean:=false;
  v_warrant text;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_operation='' then raise exception 'Operation key is required.' using errcode='22023'; end if;

  if p_requirement_instance_id is not null then
    select * into v_requirement
    from atlas.state_consequence_instances i
    where i.id=p_requirement_instance_id
      and i.subject_kind='crop_cycle'
      and i.subject_id=v_cycle.id
      and i.consequence_role='operation_requirement'
      and i.action_key=v_operation
      and i.status='open';
  else
    select * into v_requirement
    from atlas.state_consequence_instances i
    where i.subject_kind='crop_cycle'
      and i.subject_id=v_cycle.id
      and i.consequence_role='operation_requirement'
      and i.action_key=v_operation
      and i.status='open'
    order by i.priority,i.released_at,i.id
    limit 1;
  end if;

  if v_requirement.id is null then
    return jsonb_build_object(
      'contractVersion','crop_operation_execution_warrant_v1',
      'cropCycleId',v_cycle.id,'operationKey',v_operation,
      'requirementExists',false,'executionReady',false,'warrant','requirement_not_established',
      'gaps','[]'::jsonb,
      'truthBoundary',jsonb_build_object('absenceOfRequirementIsNotExecutionReadiness',true)
    );
  end if;

  if v_operation='transplant' then
    v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);
    if coalesce(v_destination->>'coverageState','missing')='missing' then
      v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
        'kind','destination_required',
        'factNeeded','lawful transplant destination',
        'jurisdiction','owner_or_manager',
        'evidenceToClose','an evidence-backed active crop destination claim',
        'blocksExecution',true,
        'sourceRequirementInstanceId',v_requirement.id,
        'sourceRequirementAction',v_requirement.action_key
      ));
    elsif not coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false) then
      v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
        'kind','destination_coverage_required',
        'factNeeded','sufficient destination coverage for the moving cohort',
        'jurisdiction','owner_or_manager',
        'evidenceToClose','destination claim coverage sufficient under crop_destination_claim_coverage_v1',
        'blocksExecution',true,
        'sourceRequirementInstanceId',v_requirement.id
      ));
    end if;

    if v_cycle.crop_profile_id is null then
      v_nonblocking:=v_nonblocking||jsonb_build_array(jsonb_build_object(
        'kind','crop_profile_source_missing',
        'blocksExecution',false,
        'reason','The current hardening-off witness is sufficient to preserve the transplant requirement; profile repair remains separate model coverage.'
      ));
    end if;
  else
    return jsonb_build_object(
      'contractVersion','crop_operation_execution_warrant_v1',
      'cropCycleId',v_cycle.id,'operationKey',v_operation,
      'requirementExists',true,'requirementInstanceId',v_requirement.id,
      'executionReady',false,'warrant','unsupported_operation_adapter',
      'gaps',jsonb_build_array(jsonb_build_object('kind','operation_warrant_adapter_required','blocksExecution',true))
    );
  end if;

  v_ready:=jsonb_array_length(v_gaps)=0;
  v_warrant:=case when v_ready then 'ready' else 'missing_truth' end;

  return jsonb_build_object(
    'contractVersion','crop_operation_execution_warrant_v1',
    'cropCycleId',v_cycle.id,
    'operationKey',v_operation,
    'requirementExists',true,
    'requirementInstanceId',v_requirement.id,
    'requirementKnownActiveBy',v_requirement.requirement_known_active_by,
    'requirementOnsetDate',v_requirement.requirement_onset_date,
    'requirementTimeClass',v_requirement.requirement_time_class,
    'executionReady',v_ready,
    'warrant',v_warrant,
    'gaps',v_gaps,
    'nonBlockingUnknowns',v_nonblocking,
    'destination',v_destination,
    'truthBoundary',jsonb_build_object(
      'requirementExistsIndependentlyOfExecutionWarrant',true,
      'missingDestinationBlocksExecutionNotRequirement',true,
      'missingProfileDoesNotAutomaticallyBlockCurrentTransplantResponse',true,
      'warrantResolutionDoesNotResetRequirementTime',true
    )
  );
end;
$function$;

revoke all on function atlas.crop_operation_execution_warrant_v1(uuid,text,uuid) from public,anon,authenticated;
grant execute on function atlas.crop_operation_execution_warrant_v1(uuid,text,uuid) to service_role;

create or replace function atlas.crop_cycle_requirement_expression_v1(
  p_crop_cycle_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_snapshot jsonb;
  v_requirements jsonb:='[]'::jsonb;
  v_acquisition jsonb:='[]'::jsonb;
  v_primary uuid;
  v_warrant jsonb;
begin
  v_snapshot:=atlas.crop_cycle_requirement_snapshot_v1(p_crop_cycle_id,p_as_of_date);

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'instanceId',i.id,'policyKey',p.stable_key,'role',i.consequence_role,'actionKey',i.action_key,
    'consequenceKind',i.consequence_kind,'audience',i.audience,'priority',i.priority,
    'requirementOnsetDate',i.requirement_onset_date,'requirementKnownActiveBy',i.requirement_known_active_by,
    'requirementTimeClass',i.requirement_time_class,'epistemicBasis',i.epistemic_basis,
    'releasedAt',i.released_at,'payload',i.consequence_payload
  )) order by i.priority,i.released_at,i.id),'[]'::jsonb),
  (array_agg(i.id order by i.priority,i.released_at,i.id))[1]
  into v_requirements,v_primary
  from atlas.state_consequence_instances i
  join atlas.state_consequence_policies p on p.id=i.policy_id
  where i.subject_kind='crop_cycle' and i.subject_id=p_crop_cycle_id
    and i.status='open' and i.consequence_role='operation_requirement';

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'instanceId',i.id,'policyKey',p.stable_key,'role',i.consequence_role,'actionKey',i.action_key,
    'consequenceKind',i.consequence_kind,'audience',i.audience,'priority',i.priority,
    'sourceRequirementInstanceId',i.source_requirement_instance_id,
    'releasedAt',i.released_at,'payload',i.consequence_payload
  )) order by i.priority,i.released_at,i.id),'[]'::jsonb)
  into v_acquisition
  from atlas.state_consequence_instances i
  join atlas.state_consequence_policies p on p.id=i.policy_id
  where i.subject_kind='crop_cycle' and i.subject_id=p_crop_cycle_id
    and i.status='open' and i.consequence_role='truth_acquisition';

  if v_primary is not null then
    v_warrant:=atlas.crop_operation_execution_warrant_v1(p_crop_cycle_id,'transplant',v_primary);
  else
    v_warrant:=jsonb_build_object('requirementExists',false,'executionReady',false,'warrant','requirement_not_established');
  end if;

  return jsonb_build_object(
    'contractVersion','crop_cycle_requirement_expression_v1',
    'cropCycleId',p_crop_cycle_id,
    'snapshot',v_snapshot,
    'requirements',v_requirements,
    'truthAcquisition',v_acquisition,
    'executionWarrant',v_warrant,
    'truthBoundary',jsonb_build_object(
      'requirementIsNotTask',true,
      'gapIsNotRequirement',true,
      'warrantIsNotRequirement',true,
      'workerPlacementComesAfterWarrant',true
    )
  );
end;
$function$;

revoke all on function atlas.crop_cycle_requirement_expression_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.crop_cycle_requirement_expression_v1(uuid,date) to service_role;

create or replace function atlas.reconcile_crop_cycle_requirement_state_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_result jsonb;
begin
  v_result:=atlas.reconcile_state_consequences_v1('crop_cycle',p_crop_cycle_id);
  update atlas.state_consequence_instances child
  set source_requirement_instance_id=parent.id,
      epistemic_basis=coalesce(child.epistemic_basis,'{}'::jsonb)||jsonb_build_object(
        'sourceRequirementInstanceId',parent.id,
        'causalLinkEstablishedBy','reconcile_crop_cycle_requirement_state_v1'
      ),
      updated_at=now()
  from atlas.state_consequence_policies child_policy,
       atlas.state_consequence_policies parent_policy,
       atlas.state_consequence_instances parent
  where child.subject_kind='crop_cycle'
    and child.subject_id=p_crop_cycle_id
    and child.status='open'
    and child.consequence_role='truth_acquisition'
    and child_policy.id=child.policy_id
    and nullif(child_policy.metadata->>'sourceRequirementPolicyKey','')=parent_policy.stable_key
    and parent.policy_id=parent_policy.id
    and parent.subject_kind=child.subject_kind
    and parent.subject_id=child.subject_id
    and parent.status='open'
    and parent.consequence_role='operation_requirement'
    and child.source_requirement_instance_id is distinct from parent.id;

  return atlas.crop_cycle_requirement_expression_v1(p_crop_cycle_id,(now() at time zone 'America/Chicago')::date);
end;
$function$;

revoke all on function atlas.reconcile_crop_cycle_requirement_state_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_cycle_requirement_state_v1(uuid) to service_role;

create or replace function atlas.reconcile_crop_cycle_requirement_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.reconcile_crop_cycle_requirement_state_v1(new.id);
  return new;
end;
$function$;
revoke all on function atlas.reconcile_crop_cycle_requirement_trigger_v1() from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_cycle_requirement_trigger_v1() to service_role;

drop trigger if exists p2_reconcile_crop_cycle_requirement on atlas.crop_cycles;
create trigger p2_reconcile_crop_cycle_requirement
after insert or update of cycle_state,lifecycle_status,planted_date,crop_profile_id,metadata
on atlas.crop_cycles
for each row execute function atlas.reconcile_crop_cycle_requirement_trigger_v1();

create or replace function atlas.reconcile_crop_destination_requirement_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_crop_cycle_id uuid:=case when tg_op='DELETE' then old.crop_cycle_id else new.crop_cycle_id end;
begin
  if v_crop_cycle_id is not null then perform atlas.reconcile_crop_cycle_requirement_state_v1(v_crop_cycle_id); end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function atlas.reconcile_crop_destination_requirement_trigger_v1() from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_destination_requirement_trigger_v1() to service_role;

drop trigger if exists p2_reconcile_crop_destination_requirement on atlas.crop_destination_claims;
create trigger p2_reconcile_crop_destination_requirement
after insert or update or delete on atlas.crop_destination_claims
for each row execute function atlas.reconcile_crop_destination_requirement_trigger_v1();

do $p2_backfill$
declare v record;
begin
  for v in
    select id from atlas.crop_cycles
    where lifecycle_status='active' and cycle_state='hardening_off' and planted_date is null
  loop
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v.id);
  end loop;
end
$p2_backfill$;

comment on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) is
'P2 Requirement Expression specimen. Current hardening-off state may establish a transplant response requirement without a crop profile or pre-existing task; exact historical onset remains unknown unless separately evidenced.';
comment on function atlas.crop_operation_execution_warrant_v1(uuid,text,uuid) is
'P2 subject-level execution warrant. Evaluates whether an already-established crop operation requirement may execute; missing destination blocks execution but never erases the source requirement.';
comment on function atlas.crop_cycle_requirement_expression_v1(uuid,date) is
'P2 combined read model for crop requirement, truth-acquisition consequences, and execution warrant. Requirement, gap, and warrant remain differentiated.';