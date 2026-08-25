create or replace function atlas.task_prerequisite_gate_evaluation_v1(
  p_downstream_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_requirements jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_hidden boolean := false;
  v_waiting_text text;
begin
  select * into v_task
  from atlas.tasks
  where id = p_downstream_task_id;

  if v_task.id is null then
    return jsonb_build_object(
      'contractVersion','task_prerequisite_gate_evaluation_v1',
      'taskId',p_downstream_task_id,
      'state','missing',
      'satisfied',false,
      'ready',false,
      'requirementCount',0,
      'requirements','[]'::jsonb,
      'truthBoundary',jsonb_build_object(
        'readOnly',true,
        'evidenceRemainsTaskPrerequisiteOwned',true,
        'evaluationDoesNotMutateTask',true,
        'evaluationDoesNotExecuteEffect',true
      )
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'requirementKey','task_prerequisite:'||prerequisite.id::text,
      'satisfied',source.status = prerequisite.required_status,
      'provider','atlas.task_prerequisites',
      'providerState',source.status,
      'evidence',jsonb_strip_nulls(jsonb_build_object(
        'prerequisiteId',prerequisite.id,
        'prerequisiteTaskId',prerequisite.prerequisite_task_id,
        'downstreamTaskId',prerequisite.downstream_task_id,
        'requiredStatus',prerequisite.required_status,
        'sourceStatus',source.status,
        'holdMode',prerequisite.hold_mode,
        'sequenceOrder',prerequisite.sequence_order,
        'satisfiedAt',prerequisite.satisfied_at
      ))
    ) order by prerequisite.sequence_order, prerequisite.id
  ),'[]'::jsonb)
  into v_requirements
  from atlas.task_prerequisites prerequisite
  join atlas.tasks source on source.id = prerequisite.prerequisite_task_id
  where prerequisite.downstream_task_id = p_downstream_task_id
    and prerequisite.active;

  v_ready := atlas.task_prerequisites_ready_v1(p_downstream_task_id);

  select exists (
    select 1
    from atlas.task_prerequisites prerequisite
    join atlas.tasks source on source.id = prerequisite.prerequisite_task_id
    where prerequisite.downstream_task_id = p_downstream_task_id
      and prerequisite.active
      and prerequisite.hold_mode = 'deferred_hidden'
      and source.status <> prerequisite.required_status
  ) into v_hidden;

  if not v_ready then
    v_waiting_text := atlas.task_prerequisite_waiting_text_v1(p_downstream_task_id);
  end if;

  return jsonb_build_object(
    'contractVersion','task_prerequisite_gate_evaluation_v1',
    'taskId',p_downstream_task_id,
    'state',case when v_ready then 'satisfied' else 'open' end,
    'satisfied',v_ready,
    'ready',v_ready,
    'hidden',v_hidden,
    'waitingText',v_waiting_text,
    'requirementCount',jsonb_array_length(v_requirements),
    'requirements',v_requirements,
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'evidenceRemainsTaskPrerequisiteOwned',true,
      'evaluationDoesNotMutateTask',true,
      'evaluationDoesNotExecuteEffect',true
    )
  );
end;
$function$;

revoke execute on function atlas.task_prerequisite_gate_evaluation_v1(uuid)
from public, anon, authenticated, service_role;

create or replace function atlas.apply_task_prerequisite_gate_effect_v1(
  p_downstream_task_id uuid,
  p_evaluation jsonb,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_restore jsonb;
  v_hidden boolean;
  v_waiting_text text;
  v_assigned_membership_id uuid;
  v_assigned_user_id uuid;
  v_visibility_scope text;
  v_status text;
  v_blocker_text text;
  v_metadata jsonb;
  v_state text;
  v_satisfied boolean;
begin
  if p_evaluation is null or jsonb_typeof(p_evaluation) <> 'object' then
    raise exception 'Prerequisite effect requires an evaluation object.' using errcode='22023';
  end if;
  if p_evaluation->>'contractVersion' <> 'task_prerequisite_gate_evaluation_v1' then
    raise exception 'Prerequisite effect requires the canonical prerequisite evaluation contract.' using errcode='23514';
  end if;
  if p_evaluation->>'taskId' is distinct from p_downstream_task_id::text then
    raise exception 'Prerequisite evaluation does not belong to this downstream task.' using errcode='23514';
  end if;

  v_state := p_evaluation->>'state';
  if v_state not in ('open','satisfied') then
    raise exception 'Prerequisite effect requires an open or satisfied evaluation.' using errcode='23514';
  end if;
  if jsonb_typeof(p_evaluation->'satisfied') <> 'boolean' then
    raise exception 'Prerequisite evaluation requires boolean satisfied.' using errcode='23514';
  end if;
  v_satisfied := (p_evaluation->>'satisfied')::boolean;
  if v_satisfied <> (v_state='satisfied') then
    raise exception 'Prerequisite evaluation state and satisfied flag disagree.' using errcode='23514';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_downstream_task_id
  for update;

  if v_task.id is null then
    return jsonb_build_object('taskId',p_downstream_task_id,'state','missing');
  end if;

  if v_task.status not in ('open','blocked') then
    return jsonb_build_object('taskId',v_task.id,'state','terminal','status',v_task.status);
  end if;

  v_restore := v_task.metadata -> 'prerequisite_gate_restore';
  if v_restore is null or jsonb_typeof(v_restore) <> 'object' then
    v_restore := jsonb_build_object(
      'status', v_task.status,
      'due_date', v_task.due_date,
      'assigned_membership_id', v_task.assigned_membership_id,
      'assigned_user_id', v_task.assigned_user_id,
      'visibility_scope', v_task.visibility_scope,
      'blocker_text', v_task.blocker_text,
      'assigned_to', v_task.metadata -> 'assigned_to',
      'assignee_key', v_task.metadata -> 'assignee_key'
    );
  end if;

  if v_state='open' then
    v_hidden := coalesce((p_evaluation->>'hidden')::boolean,false);
    v_waiting_text := coalesce(
      nullif(p_evaluation->>'waitingText',''),
      atlas.task_prerequisite_waiting_text_v1(v_task.id)
    );

    v_metadata := (
      coalesce(v_task.metadata, '{}'::jsonb)
      - 'assigned_to'
      - 'assignee_key'
      - 'executor_membership_id'
      - 'executor_worker_key'
      - 'executor_role'
      - 'executor_label'
    ) || jsonb_build_object(
      'prerequisite_gate_restore', v_restore,
      'prerequisite_gate_state', case when v_hidden then 'deferred_hidden' else 'blocked_visible' end,
      'prerequisite_gate_updated_at', p_as_of
    );

    update atlas.tasks
    set status = 'blocked',
        blocker_text = v_waiting_text,
        assigned_membership_id = case when v_hidden then null else v_task.assigned_membership_id end,
        assigned_user_id = case when v_hidden then null else v_task.assigned_user_id end,
        visibility_scope = case when v_hidden then 'management' else v_task.visibility_scope end,
        metadata = v_metadata,
        updated_at = p_as_of
    where id = v_task.id;

    return jsonb_build_object(
      'taskId',v_task.id,
      'state',case when v_hidden then 'deferred_hidden' else 'blocked_visible' end,
      'blockerText',v_waiting_text
    );
  end if;

  v_assigned_membership_id := case
    when nullif(v_restore ->> 'assigned_membership_id', '') is null then null
    else (v_restore ->> 'assigned_membership_id')::uuid
  end;
  v_assigned_user_id := case
    when nullif(v_restore ->> 'assigned_user_id', '') is null then null
    else (v_restore ->> 'assigned_user_id')::uuid
  end;
  v_visibility_scope := coalesce(nullif(v_restore ->> 'visibility_scope', ''), v_task.visibility_scope);
  v_status := case
    when coalesce(v_restore ->> 'status', 'open') in ('open','blocked') then v_restore ->> 'status'
    else 'open'
  end;
  v_blocker_text := nullif(v_restore ->> 'blocker_text', '');

  v_metadata := (
    coalesce(v_task.metadata, '{}'::jsonb)
    - 'assigned_to'
    - 'assignee_key'
    - 'executor_membership_id'
    - 'executor_worker_key'
    - 'executor_role'
    - 'executor_label'
  ) || jsonb_strip_nulls(jsonb_build_object(
    'assigned_to', v_restore -> 'assigned_to',
    'assignee_key', v_restore -> 'assignee_key',
    'prerequisite_gate_restore', v_restore,
    'prerequisite_gate_state', 'ready',
    'prerequisite_gate_satisfied_at', p_as_of,
    'prerequisite_gate_updated_at', p_as_of
  ));

  update atlas.tasks
  set status = v_status,
      blocker_text = v_blocker_text,
      assigned_membership_id = v_assigned_membership_id,
      assigned_user_id = v_assigned_user_id,
      visibility_scope = v_visibility_scope,
      metadata = v_metadata,
      updated_at = p_as_of
  where id = v_task.id;

  return jsonb_build_object('taskId',v_task.id,'state','ready','status',v_status);
end;
$function$;

revoke execute on function atlas.apply_task_prerequisite_gate_effect_v1(uuid,jsonb,timestamptz)
from public, anon, authenticated, service_role;

create or replace function atlas.reconcile_task_prerequisite_gate_v1(
  p_downstream_task_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task_id uuid;
  v_evaluation jsonb;
begin
  select id into v_task_id
  from atlas.tasks
  where id = p_downstream_task_id
  for update;

  if v_task_id is null then
    return jsonb_build_object('taskId',p_downstream_task_id,'state','missing');
  end if;

  update atlas.task_prerequisites prerequisite
  set satisfied_at = case
        when source.status = prerequisite.required_status then coalesce(prerequisite.satisfied_at, p_as_of)
        else null
      end,
      updated_at = p_as_of
  from atlas.tasks source
  where prerequisite.downstream_task_id = p_downstream_task_id
    and prerequisite.active
    and source.id = prerequisite.prerequisite_task_id
    and prerequisite.satisfied_at is distinct from case
      when source.status = prerequisite.required_status then coalesce(prerequisite.satisfied_at, p_as_of)
      else null
    end;

  v_evaluation := atlas.task_prerequisite_gate_evaluation_v1(p_downstream_task_id);

  return atlas.apply_task_prerequisite_gate_effect_v1(
    p_downstream_task_id,
    v_evaluation,
    p_as_of
  );
end;
$function$;
