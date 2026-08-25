create or replace function atlas.apply_pot_up_serial_release_effect_v1(
  p_boundary_event_id uuid,
  p_completed_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_boundary atlas.requirement_boundary_events%rowtype;
  v_item atlas.task_release_queue_items%rowtype;
  v_next atlas.task_release_queue_items%rowtype;
  v_task atlas.tasks%rowtype;
  v_completed_at timestamptz;
  v_completed_date date;
  v_released_task_id uuid;
begin
  if p_boundary_event_id is null then
    raise exception 'A requirement boundary event is required.' using errcode='22023';
  end if;

  select * into v_boundary
  from atlas.requirement_boundary_events
  where id=p_boundary_event_id;

  if v_boundary.id is null
     or v_boundary.subject_kind<>'task_release_queue_item'
     or v_boundary.requirement_set_key<>'pot_up_serial_predecessor_completion_v1'
     or v_boundary.boundary_kind<>'closed'
     or v_boundary.from_state<>'open'
     or v_boundary.to_state<>'satisfied'
     or v_boundary.source_kind<>'task' then
    raise exception 'Boundary event does not authorize the pot-up serial release effect.' using errcode='23514';
  end if;

  select * into v_item
  from atlas.task_release_queue_items
  where id=v_boundary.subject_id
  for update;

  if v_item.id is null
     or coalesce(v_item.metadata->>'queue_kind','')<>'pot_up_serial'
     or v_item.task_id is distinct from v_boundary.source_id then
    raise exception 'Boundary subject does not match the active pot-up queue item.' using errcode='23514';
  end if;

  if v_item.state='completed' then
    if nullif(v_item.metadata->>'completion_boundary_event_id','')::uuid is distinct from v_boundary.id then
      raise exception 'Pot-up queue item was completed by a different boundary.' using errcode='23514';
    end if;
    return jsonb_build_object(
      'contractVersion','pot_up_serial_release_effect_v1',
      'applied',false,
      'state','already_applied',
      'boundaryEventId',v_boundary.id,
      'queueItemId',v_item.id,
      'releasedTaskId',nullif(v_item.metadata->>'released_successor_task_id','')::uuid
    );
  end if;

  if v_item.state<>'active' then
    raise exception 'Pot-up serial effect requires the boundary subject to be active.' using errcode='23514';
  end if;

  select * into v_task
  from atlas.tasks
  where id=v_item.task_id;

  if v_task.id is null or v_task.status<>'done' then
    raise exception 'Pot-up serial predecessor completion is not authoritative.' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.farm_id::text||':'||v_item.queue_key,0));

  v_completed_at:=coalesce(v_task.completed_at,v_boundary.evaluated_at,now());
  v_completed_date:=coalesce(p_completed_date,(v_completed_at at time zone 'America/Chicago')::date);

  select qi.* into v_next
  from atlas.task_release_queue_items qi
  where qi.farm_id=v_item.farm_id
    and qi.queue_key=v_item.queue_key
    and qi.state='queued'
  order by qi.position
  for update
  limit 1;

  update atlas.task_release_queue_items
  set state='completed',
      completed_at=v_completed_at,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'completed_task_id',v_task.id,
        'completed_at',v_completed_at,
        'completion_gate_advanced',true,
        'completion_boundary_event_id',v_boundary.id,
        'effect_contract','pot_up_serial_release_effect_v1'
      )
  where id=v_item.id;

  if v_next.id is not null then
    update atlas.task_release_queue_items
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'release_boundary_event_id',v_boundary.id,
          'release_requirement_set_key',v_boundary.requirement_set_key,
          'release_authorized_from_queue_item_id',v_item.id
        ),
        updated_at=now()
    where id=v_next.id;

    update atlas.planned_work_occurrences
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'release_boundary_event_id',v_boundary.id,
          'release_requirement_set_key',v_boundary.requirement_set_key,
          'release_authorized_from_queue_item_id',v_item.id
        ),
        task_payload=jsonb_set(
          coalesce(task_payload,'{}'::jsonb),
          '{metadata}',
          coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
            'release_boundary_event_id',v_boundary.id,
            'release_requirement_set_key',v_boundary.requirement_set_key,
            'release_authorized_from_queue_item_id',v_item.id
          ),
          true
        ),
        updated_at=now()
    where id=v_next.planned_occurrence_id;
  end if;

  v_released_task_id:=atlas.release_next_task_in_queue_v1(
    v_item.farm_id,
    v_item.queue_key,
    v_completed_date
  );

  if v_released_task_id is not null then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'release_boundary_event_id',v_boundary.id,
          'release_requirement_set_key',v_boundary.requirement_set_key,
          'release_authorized_from_queue_item_id',v_item.id
        ),
        updated_at=now()
    where id=v_released_task_id;

    update atlas.task_release_queue_items
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'released_successor_task_id',v_released_task_id
        ),
        updated_at=now()
    where id=v_item.id;
  end if;

  return jsonb_build_object(
    'contractVersion','pot_up_serial_release_effect_v1',
    'applied',true,
    'state',case when v_released_task_id is null then 'boundary_applied_no_release' else 'successor_released' end,
    'boundaryEventId',v_boundary.id,
    'queueItemId',v_item.id,
    'nextQueueItemId',v_next.id,
    'releasedTaskId',v_released_task_id
  );
end;
$$;

revoke execute on function atlas.apply_pot_up_serial_release_effect_v1(uuid,date) from public, anon, authenticated, service_role;

create or replace function atlas.advance_pot_up_serial_queue_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_item atlas.task_release_queue_items%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_boundary_id uuid;
  v_evaluated_at timestamptz;
  v_completed_date date;
begin
  if new.status<>'done' or old.status='done' then
    return new;
  end if;

  select qi.* into v_item
  from atlas.task_release_queue_items qi
  where qi.task_id=new.id
    and qi.state='active'
    and coalesce(qi.metadata->>'queue_kind','')='pot_up_serial'
  for update;

  if not found then
    return new;
  end if;

  v_evaluated_at:=coalesce(new.completed_at,new.updated_at,now());

  v_before:=atlas.requirement_set_evaluate_v1(jsonb_build_array(jsonb_build_object(
    'requirementKey','predecessor_task_completed',
    'satisfied',old.status='done',
    'provider','atlas.tasks.status',
    'providerState',old.status,
    'evidence',jsonb_build_object('taskId',old.id,'status',old.status,'completedAt',old.completed_at)
  )));

  v_after:=atlas.requirement_set_evaluate_v1(jsonb_build_array(jsonb_build_object(
    'requirementKey','predecessor_task_completed',
    'satisfied',new.status='done',
    'provider','atlas.tasks.status',
    'providerState',new.status,
    'evidence',jsonb_build_object('taskId',new.id,'status',new.status,'completedAt',new.completed_at)
  )));

  v_boundary_id:=atlas.record_requirement_boundary_v1(
    'task_release_queue_item',
    v_item.id,
    'pot_up_serial_predecessor_completion_v1',
    'pot-up-serial:'||v_item.id::text||':predecessor-completed',
    v_before,
    v_after,
    v_evaluated_at,
    'task',
    new.id,
    jsonb_build_object(
      'queueKey',v_item.queue_key,
      'queueKind','pot_up_serial',
      'effectConsumer','apply_pot_up_serial_release_effect_v1'
    )
  );

  if v_boundary_id is null then
    raise exception 'Pot-up predecessor completion did not cross an open-to-satisfied boundary.' using errcode='23514';
  end if;

  v_completed_date:=(v_evaluated_at at time zone 'America/Chicago')::date;
  perform atlas.apply_pot_up_serial_release_effect_v1(v_boundary_id,v_completed_date);

  return new;
end;
$$;

revoke execute on function atlas.advance_pot_up_serial_queue_v1() from public, anon, authenticated, service_role;