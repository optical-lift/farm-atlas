create or replace function atlas.task_is_networking_work_v1(p_task atlas.tasks)
returns boolean
language sql
immutable
as $function$
  select
    lower(coalesce(p_task.task_type,''))='network'
    or lower(coalesce(p_task.action_key,''))='network'
    or lower(coalesce(p_task.work_class,''))='network'
    or lower(coalesce(p_task.metadata->>'work_route',''))='network'
    or lower(coalesce(p_task.metadata->>'work_rhythm',''))='network'
    or lower(coalesce(p_task.metadata->>'collection_zone',''))='network'
    or lower(coalesce(p_task.metadata->>'collection_label','')) like 'network%';
$function$;

create or replace function atlas.gate_farm_hand_networking_for_owner_confirmation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_target_role text;
  v_restore jsonb;
begin
  if new.status not in ('open','blocked') or not atlas.task_is_networking_work_v1(new) then
    return new;
  end if;

  if coalesce(new.metadata->>'network_owner_confirmation_state','')='approved' then
    return new;
  end if;

  if new.assigned_membership_id is not null then
    select fm.role into v_target_role
    from atlas.farm_memberships fm
    where fm.id=new.assigned_membership_id
      and fm.farm_id=new.farm_id
      and fm.active=true;
  end if;

  if coalesce(v_target_role,'')<>'farm_hand'
     and not (
       lower(coalesce(new.visibility_scope,''))='assigned_worker'
       and lower(coalesce(new.metadata->>'assignee_key','')) in ('anna','farm_hand')
     ) then
    return new;
  end if;

  v_restore:=new.metadata->'network_owner_confirmation_restore';
  if v_restore is null or jsonb_typeof(v_restore)<>'object' then
    v_restore:=jsonb_strip_nulls(jsonb_build_object(
      'status',new.status,
      'due_date',new.due_date,
      'assigned_membership_id',new.assigned_membership_id,
      'assigned_user_id',new.assigned_user_id,
      'visibility_scope',new.visibility_scope,
      'blocker_text',new.blocker_text,
      'assigned_to',new.metadata->'assigned_to',
      'assignee_key',new.metadata->'assignee_key',
      'executor_membership_id',new.metadata->'executor_membership_id',
      'executor_worker_key',new.metadata->'executor_worker_key',
      'executor_role',new.metadata->'executor_role',
      'executor_label',new.metadata->'executor_label'
    ));
  end if;

  new.status:='blocked';
  new.blocker_text:='Waiting for Owner confirmation before networking work is sent to the Farm Hand.';
  new.assigned_membership_id:=null;
  new.assigned_user_id:=null;
  new.visibility_scope:='management';
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)
    - 'assigned_to' - 'assignee_key' - 'executor_membership_id' - 'executor_worker_key' - 'executor_role' - 'executor_label')
    || jsonb_build_object(
      'network_owner_confirmation_required',true,
      'network_owner_confirmation_state','pending',
      'network_owner_confirmation_restore',v_restore,
      'network_owner_confirmation_requested_at',coalesce(new.metadata->'network_owner_confirmation_requested_at',to_jsonb(now())),
      'network_owner_confirmation_rule','farm_hand_networking_requires_owner_confirmation_v1'
    );
  return new;
end;
$function$;

drop trigger if exists aa_gate_farm_hand_networking_for_owner_confirmation_v1 on atlas.tasks;
create trigger aa_gate_farm_hand_networking_for_owner_confirmation_v1
before insert or update on atlas.tasks
for each row execute function atlas.gate_farm_hand_networking_for_owner_confirmation_v1();

create or replace function atlas.ensure_network_owner_confirmation_decision_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_creator uuid;
begin
  if not atlas.task_is_networking_work_v1(new)
     or coalesce(new.metadata->>'network_owner_confirmation_state','')<>'pending'
     or new.status not in ('open','blocked') then
    return new;
  end if;

  select fm.id into v_creator
  from atlas.farm_memberships fm
  where fm.farm_id=new.farm_id and fm.active=true and fm.role='owner'
  order by fm.created_at
  limit 1;

  insert into atlas.work_reservoir_decisions(
    farm_id,task_id,state,reason,suggested_action,task_snapshot,created_by_membership_id
  ) values (
    new.farm_id,new.id,'open',
    'Owner confirmation is required before networking work may be sent to the Farm Hand.',
    'review',
    jsonb_build_object(
      'decisionSubtype','network_owner_confirmation',
      'prompt','Send this networking task to Anna?',
      'taskId',new.id,
      'title',new.title,
      'dueDate',new.due_date,
      'taskType',new.task_type,
      'actionKey',new.action_key,
      'workClass',new.work_class,
      'networkContext',jsonb_strip_nulls(jsonb_build_object(
        'workRhythm',new.metadata->>'work_rhythm',
        'collectionLabel',new.metadata->>'collection_label',
        'displaySubject',new.metadata->>'display_subject',
        'networkShiftReason',new.metadata->>'network_shift_reason'
      )),
      'confirmationRequired',true
    ),
    v_creator
  )
  on conflict (task_id) do update
  set state='open',
      reason=excluded.reason,
      suggested_action='review',
      resolved_action=null,
      target_date=null,
      resolution_note=null,
      resolved_by_membership_id=null,
      resolved_at=null,
      task_snapshot=excluded.task_snapshot;

  return new;
end;
$function$;

drop trigger if exists zz_ensure_network_owner_confirmation_decision_v1 on atlas.tasks;
create trigger zz_ensure_network_owner_confirmation_decision_v1
after insert or update on atlas.tasks
for each row execute function atlas.ensure_network_owner_confirmation_decision_v1();

create or replace function atlas.resolve_work_reservoir_decision_v1(
  p_decision_id uuid,
  p_action text,
  p_target_date date default null::date,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_decision atlas.work_reservoir_decisions%rowtype;
  v_task atlas.tasks%rowtype;
  v_membership_id uuid;
  v_occurrence_snapshot jsonb:=null;
  v_network_confirmation boolean:=false;
  v_restore jsonb;
  v_restore_membership_id uuid;
  v_restore_user_id uuid;
  v_restore_due_date date;
  v_restore_visibility text;
  v_restore_status text;
  v_restore_blocker text;
begin
  select * into v_decision
  from atlas.work_reservoir_decisions
  where id=p_decision_id
  for update;
  if v_decision.id is null or v_decision.state<>'open' then
    raise exception 'Open reservoir decision not found.' using errcode='P0002';
  end if;
  if not atlas.is_farm_manager_or_owner(v_decision.farm_id) then
    raise exception 'Only farm management may resolve reservoir decisions.' using errcode='42501';
  end if;
  if p_action not in ('keep_now','choose_date','return_to_reservoir','archive') then
    raise exception 'Unsupported reservoir decision action.' using errcode='22023';
  end if;
  if p_action='choose_date' and p_target_date is null then
    raise exception 'choose_date requires a target date.' using errcode='22023';
  end if;

  v_membership_id:=atlas.current_membership_id(v_decision.farm_id);
  select * into v_task from atlas.tasks where id=v_decision.task_id for update;
  if v_task.id is null then raise exception 'Decision task not found.' using errcode='P0002'; end if;
  if v_task.planned_occurrence_id is not null then
    select to_jsonb(occurrence) into v_occurrence_snapshot
    from atlas.planned_work_occurrences occurrence
    where occurrence.id=v_task.planned_occurrence_id;
  end if;

  v_network_confirmation:=coalesce(v_decision.task_snapshot->>'decisionSubtype','')='network_owner_confirmation';

  if v_network_confirmation and p_action in ('keep_now','choose_date') then
    v_restore:=v_task.metadata->'network_owner_confirmation_restore';
    if v_restore is null or jsonb_typeof(v_restore)<>'object' then
      raise exception 'Networking confirmation restore state is missing.' using errcode='55000';
    end if;
    v_restore_membership_id:=nullif(v_restore->>'assigned_membership_id','')::uuid;
    v_restore_user_id:=nullif(v_restore->>'assigned_user_id','')::uuid;
    v_restore_due_date:=nullif(v_restore->>'due_date','')::date;
    v_restore_visibility:=coalesce(nullif(v_restore->>'visibility_scope',''),'assigned_worker');
    v_restore_status:=case when coalesce(v_restore->>'status','open') in ('open','blocked') then v_restore->>'status' else 'open' end;
    v_restore_blocker:=nullif(v_restore->>'blocker_text','');

    if v_restore_membership_id is null then
      raise exception 'Networking confirmation has no Farm Hand assignment to restore.' using errcode='55000';
    end if;

    update atlas.tasks
    set status=case when v_restore_status='blocked' and v_restore_blocker is not null then 'blocked' else 'open' end,
        blocker_text=v_restore_blocker,
        due_date=case when p_action='choose_date' then p_target_date else v_restore_due_date end,
        assigned_membership_id=v_restore_membership_id,
        assigned_user_id=v_restore_user_id,
        visibility_scope=v_restore_visibility,
        metadata=(coalesce(metadata,'{}'::jsonb)
          - 'network_owner_confirmation_requested_at')
          || jsonb_strip_nulls(jsonb_build_object(
            'network_owner_confirmation_required',true,
            'network_owner_confirmation_state','approved',
            'network_owner_confirmation_approved_at',now(),
            'network_owner_confirmation_approved_by_membership_id',v_membership_id,
            'network_owner_confirmation_action',p_action,
            'network_owner_confirmation_target_date',case when p_action='choose_date' then p_target_date else null end,
            'assigned_to',v_restore->'assigned_to',
            'assignee_key',v_restore->'assignee_key',
            'executor_membership_id',v_restore->'executor_membership_id',
            'executor_worker_key',v_restore->'executor_worker_key',
            'executor_role',v_restore->'executor_role',
            'executor_label',v_restore->'executor_label',
            'reservoirDecisionResolvedAt',now(),
            'reservoirDecisionAction',p_action
          )),
        updated_at=now()
    where id=v_task.id;

    if p_action='choose_date' and v_task.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences
      set planned_due_date=p_target_date,
          not_before_date=p_target_date,
          task_payload=task_payload||jsonb_build_object('due_date',p_target_date),
          metadata=metadata||jsonb_build_object(
            'networkOwnerConfirmationApprovedAt',now(),
            'networkOwnerConfirmationAction',p_action,
            'networkOwnerConfirmationTargetDate',p_target_date
          ),
          updated_at=now()
      where id=v_task.planned_occurrence_id;
    end if;

  elsif p_action='keep_now' then
    update atlas.tasks
    set metadata=(metadata-'reservoirDecisionState'-'reservoirDecisionQueuedAt'-'reservoirDecisionReason')
        ||jsonb_build_object('reservoirDecisionResolvedAt',now(),'reservoirDecisionAction',p_action),
        updated_at=now()
    where id=v_task.id;

  elsif p_action='choose_date' then
    update atlas.tasks
    set due_date=p_target_date,
        metadata=(metadata-'reservoirDecisionState'-'reservoirDecisionQueuedAt'-'reservoirDecisionReason')
          ||jsonb_build_object('reservoirDecisionResolvedAt',now(),'reservoirDecisionAction',p_action,'reservoirDecisionTargetDate',p_target_date),
        updated_at=now()
    where id=v_task.id;
    update atlas.planned_work_occurrences
    set planned_due_date=p_target_date,not_before_date=p_target_date,
        task_payload=task_payload||jsonb_build_object('due_date',p_target_date),
        metadata=metadata||jsonb_build_object('reservoirDecisionResolvedAt',now(),'reservoirDecisionAction',p_action,'reservoirDecisionTargetDate',p_target_date),
        updated_at=now()
    where id=v_task.planned_occurrence_id;

  elsif p_action='return_to_reservoir' then
    if v_task.planned_occurrence_id is not null then
      insert into atlas.work_reservoir_retractions(farm_id,occurrence_id,retired_task_id,reason,snapshot)
      values(v_task.farm_id,v_task.planned_occurrence_id,v_task.id,
        coalesce(nullif(btrim(p_note),''),'Owner returned untouched work to the reservoir.'),
        jsonb_build_object('task',to_jsonb(v_task),'occurrence',v_occurrence_snapshot,'decisionId',v_decision.id));
      update atlas.planned_work_occurrences
      set state='planned',planned_due_date=coalesce(p_target_date,planned_due_date,v_task.due_date),
          not_before_date=coalesce(p_target_date,planned_due_date,v_task.due_date),released_at=null,released_task_id=null,
          metadata=metadata||jsonb_build_object('returnedToReservoirAt',now(),'returnedToReservoirDecisionId',v_decision.id),updated_at=now()
      where id=v_task.planned_occurrence_id;
    end if;
    update atlas.tasks
    set status='archived',metadata=(metadata-'reservoirDecisionState'-'reservoirDecisionQueuedAt'-'reservoirDecisionReason')
      ||jsonb_build_object('returnedToReservoirAt',now(),'returnedToReservoirDecisionId',v_decision.id),updated_at=now()
    where id=v_task.id;

  elsif p_action='archive' then
    update atlas.planned_work_occurrences
    set state='cancelled',metadata=metadata||jsonb_build_object('cancelledByReservoirDecisionAt',now(),'reservoirDecisionId',v_decision.id),updated_at=now()
    where id=v_task.planned_occurrence_id and state not in ('completed','superseded');
    update atlas.tasks
    set status='archived',metadata=(metadata-'reservoirDecisionState'-'reservoirDecisionQueuedAt'-'reservoirDecisionReason')
      ||jsonb_build_object('archivedByReservoirDecisionAt',now(),'reservoirDecisionId',v_decision.id),updated_at=now()
    where id=v_task.id;
  end if;

  update atlas.work_reservoir_decisions
  set state='resolved',resolved_action=p_action,target_date=p_target_date,
      resolution_note=nullif(btrim(p_note),''),resolved_by_membership_id=v_membership_id,resolved_at=now()
  where id=v_decision.id;

  return jsonb_build_object('ok',true,'decisionId',v_decision.id,'taskId',v_task.id,'action',p_action,'targetDate',p_target_date,'networkConfirmation',v_network_confirmation);
end;
$function$;