-- P3/P4: Truth-gap classification and human acquisition routing.
-- A consequential gap gets one causal carrier owned by the person who can close it.
-- The carrier inherits urgency from the source requirement; it does not replace that requirement.

alter table atlas.state_consequence_instances
  add column if not exists carrier_task_id uuid null;

alter table atlas.state_consequence_instances
  drop constraint if exists state_consequence_instances_carrier_task_fk;
alter table atlas.state_consequence_instances
  add constraint state_consequence_instances_carrier_task_fk
  foreign key (carrier_task_id)
  references atlas.tasks(id)
  on delete set null;

create index if not exists state_consequence_instances_carrier_task_idx
  on atlas.state_consequence_instances(carrier_task_id)
  where carrier_task_id is not null;

comment on column atlas.state_consequence_instances.carrier_task_id is
'Optional human-work carrier for a state consequence. The task is not the requirement; it carries the fitting human move caused by the consequence.';

create or replace function atlas.truth_acquisition_jurisdiction_v1(
  p_instance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_jurisdiction text;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_jurisdiction:=coalesce(
    nullif(v_policy.metadata->>'jurisdiction',''),
    nullif(v_policy.action_spec->>'jurisdiction',''),
    case v_instance.audience
      when 'farm_operations_management' then 'manager'
      when 'owner' then 'owner'
      else 'farm_operations'
    end
  );

  -- Spatial destination choices currently belong to the farm Owner unless a future
  -- explicit authority-allocation policy names another custodian. This avoids giving
  -- a manager or worker an ownership decision merely because the gap is operational.
  if v_instance.subject_kind='crop_cycle'
     and v_instance.action_key='choose_transplant_destination'
     and v_jurisdiction in ('owner_or_manager','farm_operations_management','manager','owner') then
    v_jurisdiction:='owner';
  end if;

  if v_jurisdiction='owner' then
    select * into v_membership
    from atlas.farm_memberships fm
    where fm.farm_id=v_instance.farm_id and fm.active and fm.role='owner'
    order by fm.created_at,fm.id
    limit 1;
  elsif v_jurisdiction='manager' then
    select * into v_membership
    from atlas.farm_memberships fm
    where fm.farm_id=v_instance.farm_id and fm.active and fm.role='manager'
    order by fm.created_at,fm.id
    limit 1;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','truth_acquisition_jurisdiction_v1',
    'instanceId',v_instance.id,
    'jurisdiction',v_jurisdiction,
    'membershipId',v_membership.id,
    'userId',v_membership.user_id,
    'role',v_membership.role,
    'resolvedToPerson',(v_membership.id is not null),
    'truthBoundary',jsonb_build_object(
      'jurisdictionIsNotExecutionAssignment',true,
      'workerDoesNotReceiveOwnerDecision',true,
      'taskCarrierDoesNotBecomeRequirementAuthority',true
    )
  ));
end;
$function$;

revoke all on function atlas.truth_acquisition_jurisdiction_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.truth_acquisition_jurisdiction_v1(uuid) to service_role;

create or replace function atlas.ensure_truth_acquisition_task_v1(
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_requirement atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_task atlas.tasks%rowtype;
  v_jurisdiction jsonb;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_ensure jsonb;
  v_task_id uuid;
  v_known_active_by date;
  v_inherited_due date;
  v_subject text;
  v_detail text;
begin
  select * into v_instance
  from atlas.state_consequence_instances
  where id=p_instance_id
  for update;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;

  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then
    return jsonb_build_object('instanceId',v_instance.id,'state','not_open_truth_acquisition','created',false);
  end if;

  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;
  if v_instance.source_requirement_instance_id is not null then
    select * into v_requirement
    from atlas.state_consequence_instances
    where id=v_instance.source_requirement_instance_id;
  end if;

  if v_instance.subject_kind<>'crop_cycle' or v_instance.action_key<>'choose_transplant_destination' then
    return jsonb_build_object(
      'instanceId',v_instance.id,'state','no_task_adapter','created',false,
      'reason','This truth-acquisition consequence has no governed task-carrier adapter yet.'
    );
  end if;

  select * into v_cycle from atlas.crop_cycles where id=v_instance.subject_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found for truth acquisition.' using errcode='P0002'; end if;

  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);
  begin v_owner_membership_id:=nullif(v_jurisdiction->>'membershipId','')::uuid; exception when others then v_owner_membership_id:=null; end;
  begin v_owner_user_id:=nullif(v_jurisdiction->>'userId','')::uuid; exception when others then v_owner_user_id:=null; end;
  if v_owner_membership_id is null then
    return jsonb_build_object(
      'instanceId',v_instance.id,'state','jurisdiction_unresolved','created',false,
      'jurisdiction',v_jurisdiction
    );
  end if;

  if v_instance.carrier_task_id is not null then
    select * into v_task from atlas.tasks where id=v_instance.carrier_task_id;
    if v_task.id is not null and v_task.status in ('open','blocked') then
      v_task_id:=v_task.id;
    end if;
  end if;

  if v_task_id is null then
    select t.* into v_task
    from atlas.task_crop_cycles tc
    join atlas.tasks t on t.id=tc.task_id
    where tc.crop_cycle_id=v_cycle.id
      and t.status in ('open','blocked')
      and t.task_type='spatial_destination_resolution'
    order by case when t.generated_from='crop_cycle_destination' then 0 else 1 end,t.created_at,t.id
    limit 1;
    if v_task.id is not null then v_task_id:=v_task.id; end if;
  end if;

  if v_task_id is null then
    v_ensure:=atlas.ensure_crop_destination_resolution_v1(v_cycle.id);
    begin v_task_id:=nullif(v_ensure->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
    if v_task_id is null then
      begin v_task_id:=nullif(v_ensure->>'releasedTaskId','')::uuid; exception when others then v_task_id:=null; end;
    end if;
    if v_task_id is null and nullif(v_ensure->>'occurrenceId','') is not null then
      select released_task_id into v_task_id
      from atlas.planned_work_occurrences
      where id=(v_ensure->>'occurrenceId')::uuid;
    end if;
  end if;

  if v_task_id is null then
    return jsonb_build_object(
      'instanceId',v_instance.id,'state','carrier_unresolved','created',false,
      'ensureResult',v_ensure,'jurisdiction',v_jurisdiction
    );
  end if;

  select * into v_task from atlas.tasks where id=v_task_id for update;
  if v_task.id is null then raise exception 'Resolved truth-acquisition carrier task was not found.' using errcode='P0002'; end if;

  v_known_active_by:=v_requirement.requirement_known_active_by;
  v_inherited_due:=case
    when v_known_active_by is null then v_task.due_date
    when v_task.due_date is null then v_known_active_by
    else least(v_task.due_date,v_known_active_by)
  end;
  v_subject:=coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop');
  v_detail:=v_subject||' needs planted. Atlas does not know where it goes yet.';

  update atlas.tasks
  set title=v_subject||' needs planted — choose where it goes',
      priority='high',
      due_date=v_inherited_due,
      assigned_membership_id=v_owner_membership_id,
      assigned_user_id=v_owner_user_id,
      visibility_scope='owner',
      work_lane='required',
      commitment_kind='persistent',
      sky_deferral_mode='never',
      action_key='choose_transplant_destination',
      operation_class=coalesce(nullif(operation_class,''),'inspect_assess'),
      note=v_detail||' Choosing the destination closes the missing-truth gap; it does not itself record the transplant.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
        'task_style','truth_acquisition_destination',
        'state_consequence_instance_id',v_instance.id,
        'source_requirement_instance_id',v_requirement.id,
        'source_requirement_action',v_requirement.action_key,
        'gap_kind',coalesce(v_policy.metadata->>'gapKind','destination_required'),
        'jurisdiction','owner',
        'requirement_known_active_by',v_known_active_by,
        'requirement_onset_date',v_requirement.requirement_onset_date,
        'requirement_time_class',v_requirement.requirement_time_class,
        'inherited_urgency',true,
        'due_date_semantics',case when v_known_active_by is not null then 'requirement_known_active_by_latest_proven_need_date' else 'existing_task_due_date' end,
        'display_action','Choose where to plant it',
        'display_subject',v_subject,
        'display_detail',v_detail,
        'requirement_statement',v_subject||' needs planted.',
        'missing_truth_statement','Atlas does not know where it goes yet.',
        'execution_statement','Transplant remains unreleased until destination warrant clears.',
        'worker_execution_released',false,
        'principal_escalation_created',false
      )),
      updated_at=now()
  where id=v_task.id
  returning * into v_task;

  update atlas.state_consequence_instances
  set carrier_task_id=v_task.id,
      epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
        'carrierTaskId',v_task.id,
        'carrierAssignedMembershipId',v_owner_membership_id,
        'carrierJurisdiction','owner',
        'carrierReconciledBy','ensure_truth_acquisition_task_v1'
      ),
      updated_at=now()
  where id=v_instance.id;

  return jsonb_build_object(
    'contractVersion','ensure_truth_acquisition_task_v1',
    'instanceId',v_instance.id,
    'sourceRequirementInstanceId',v_requirement.id,
    'state','carrier_ready',
    'taskId',v_task.id,
    'assignedMembershipId',v_owner_membership_id,
    'assignedUserId',v_owner_user_id,
    'dueDate',v_task.due_date,
    'created',false,
    'adoptedExistingCarrier',true,
    'truthBoundary',jsonb_build_object(
      'taskIsCarrierNotRequirement',true,
      'destinationDecisionDoesNotRecordTransplant',true,
      'urgencyInheritedFromSourceRequirement',true,
      'workerExecutionRemainsUnreleased',true
    )
  );
end;
$function$;

revoke all on function atlas.ensure_truth_acquisition_task_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_truth_acquisition_task_v1(uuid) to service_role;

create or replace function atlas.sync_truth_acquisition_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.status='open' and new.consequence_role='truth_acquisition' then
    perform atlas.ensure_truth_acquisition_task_v1(new.id);
  end if;
  return new;
exception when others then
  -- Requirement/gap truth must survive even if the UI/task carrier needs repair.
  return new;
end;
$function$;

revoke all on function atlas.sync_truth_acquisition_carrier_v1() from public,anon,authenticated;
grant execute on function atlas.sync_truth_acquisition_carrier_v1() to service_role;

drop trigger if exists p3_p4_sync_truth_acquisition_carrier on atlas.state_consequence_instances;
create trigger p3_p4_sync_truth_acquisition_carrier
after insert or update of status,consequence_role,source_requirement_instance_id
on atlas.state_consequence_instances
for each row execute function atlas.sync_truth_acquisition_carrier_v1();

-- The transplant-destination acquisition belongs to the Owner in the current authority model.
update atlas.state_consequence_policies
set audience='owner',
    metadata=metadata||jsonb_build_object(
      'jurisdiction','owner',
      'routingContract','truth_acquisition_jurisdiction_v1',
      'carrierContract','ensure_truth_acquisition_task_v1'
    ),
    updated_at=now()
where stable_key='crop-transplant-destination-truth-required';

-- Backfill open crop destination truth-acquisition instances by adopting existing carriers.
do $p3_p4_backfill$
declare v record;
begin
  for v in
    select id from atlas.state_consequence_instances
    where status='open'
      and consequence_role='truth_acquisition'
      and subject_kind='crop_cycle'
      and action_key='choose_transplant_destination'
  loop
    perform atlas.ensure_truth_acquisition_task_v1(v.id);
  end loop;
end
$p3_p4_backfill$;

comment on function atlas.truth_acquisition_jurisdiction_v1(uuid) is
'P3/P4 jurisdiction resolver. Missing truth is routed to the person whose authority can establish it; crop transplant destination currently resolves to the active farm Owner.';
comment on function atlas.ensure_truth_acquisition_task_v1(uuid) is
'P3/P4 carrier reconciler. Adopts an existing destination-resolution task when possible, links it causally to the source requirement, inherits requirement urgency, and never releases the downstream worker transplant by itself.';