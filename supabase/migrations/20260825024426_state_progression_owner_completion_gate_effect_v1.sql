create or replace function atlas.apply_owner_completion_gated_release_effect_v1(
  p_boundary_event_id uuid,
  p_completed_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
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
     or v_boundary.requirement_set_key<>'owner_completion_gated_predecessor_completion_v1'
     or v_boundary.boundary_kind<>'closed'
     or v_boundary.from_state<>'open'
     or v_boundary.to_state<>'satisfied'
     or v_boundary.source_kind<>'task' then
    raise exception 'Boundary event does not authorize an owner completion-gated release effect.' using errcode='23514';
  end if;

  select * into v_item
  from atlas.task_release_queue_items
  where id=v_boundary.subject_id
  for update;

  if v_item.id is null
     or v_item.queue_key not in ('owner_social_content_queue','owner_venue_marketing_queue')
     or v_item.task_id is distinct from v_boundary.source_id then
    raise exception 'Boundary subject does not match the owner completion-gated queue item.' using errcode='23514';
  end if;

  if v_item.state='completed' then
    if nullif(v_item.metadata->>'completion_boundary_event_id','')::uuid is distinct from v_boundary.id then
      raise exception 'Owner queue item was completed by a different boundary.' using errcode='23514';
    end if;
    return jsonb_build_object(
      'contractVersion','owner_completion_gated_release_effect_v1',
      'applied',false,
      'state','already_applied',
      'boundaryEventId',v_boundary.id,
      'queueItemId',v_item.id,
      'releasedTaskId',nullif(v_item.metadata->>'released_successor_task_id','')::uuid
    );
  end if;

  if v_item.state<>'active' then
    raise exception 'Owner completion-gated effect requires the boundary subject to be active.' using errcode='23514';
  end if;

  select * into v_task
  from atlas.tasks
  where id=v_item.task_id;

  if v_task.id is null or v_task.status<>'done' then
    raise exception 'Owner completion-gated predecessor completion is not authoritative.' using errcode='23514';
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
        'effect_contract','owner_completion_gated_release_effect_v1'
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
    'contractVersion','owner_completion_gated_release_effect_v1',
    'applied',true,
    'state',case when v_released_task_id is null then 'boundary_applied_no_release' else 'successor_released' end,
    'boundaryEventId',v_boundary.id,
    'queueItemId',v_item.id,
    'nextQueueItemId',v_next.id,
    'releasedTaskId',v_released_task_id
  );
end;
$function$;

revoke execute on function atlas.apply_owner_completion_gated_release_effect_v1(uuid,date) from public, anon, authenticated, service_role;

create or replace function atlas.advance_owner_completion_gated_queue_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_item atlas.task_release_queue_items%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_boundary_id uuid;
  v_evaluated_at timestamptz;
  v_completed_date date;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  select qi.* into v_item
  from atlas.task_release_queue_items qi
  where qi.task_id=new.id
    and qi.state='active'
    and qi.queue_key in ('owner_social_content_queue','owner_venue_marketing_queue')
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
    'owner_completion_gated_predecessor_completion_v1',
    'owner-completion-gated:'||v_item.id::text||':predecessor-completed',
    v_before,
    v_after,
    v_evaluated_at,
    'task',
    new.id,
    jsonb_build_object(
      'queueKey',v_item.queue_key,
      'effectConsumer','apply_owner_completion_gated_release_effect_v1'
    )
  );

  if v_boundary_id is null then
    raise exception 'Owner completion-gated predecessor completion did not cross an open-to-satisfied boundary.' using errcode='23514';
  end if;

  v_completed_date:=(v_evaluated_at at time zone 'America/Chicago')::date;
  perform atlas.apply_owner_completion_gated_release_effect_v1(v_boundary_id,v_completed_date);

  return new;
end;
$function$;

revoke execute on function atlas.advance_owner_completion_gated_queue_v1() from public, anon, authenticated, service_role;

create or replace function atlas.release_next_task_in_queue_v1(
  p_farm_id uuid,
  p_queue_key text,
  p_completed_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_next_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_completed_date date:=coalesce(p_completed_date,(now() at time zone 'America/Chicago')::date);
  v_occurrence_id uuid;
  v_task_id uuid;
  v_release_timing text;
  v_approval_required boolean:=false;
  v_approved_date date;
  v_is_pot_up_serial boolean:=false;
  v_is_owner_completion_gated boolean:=false;
  v_expected_requirement_set_key text;
  v_boundary_id uuid;
  v_authorized_from_item_id uuid;
  v_authorizer atlas.task_release_queue_items%rowtype;
  v_boundary atlas.requirement_boundary_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_queue_key,0));

  if exists(
    select 1
    from atlas.task_release_queue_items qi
    left join atlas.tasks task on task.id=qi.task_id
    left join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
    where qi.farm_id=p_farm_id
      and qi.queue_key=p_queue_key
      and qi.initial_batch
      and qi.state<>'completed'
      and coalesce(task.status,'open')<>'done'
      and coalesce(occurrence.state,'released')<>'completed'
  ) then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  select qi.* into v_next_item
  from atlas.task_release_queue_items qi
  where qi.farm_id=p_farm_id
    and qi.queue_key=p_queue_key
    and qi.state='queued'
  order by qi.position
  for update
  limit 1;

  if not found then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  v_is_pot_up_serial:=coalesce(v_next_item.metadata->>'queue_kind','')='pot_up_serial';
  v_is_owner_completion_gated:=p_queue_key in ('owner_social_content_queue','owner_venue_marketing_queue');

  if v_is_pot_up_serial or v_is_owner_completion_gated then
    v_expected_requirement_set_key:=case
      when v_is_pot_up_serial then 'pot_up_serial_predecessor_completion_v1'
      else 'owner_completion_gated_predecessor_completion_v1'
    end;

    begin
      v_boundary_id:=nullif(v_next_item.metadata->>'release_boundary_event_id','')::uuid;
      v_authorized_from_item_id:=nullif(v_next_item.metadata->>'release_authorized_from_queue_item_id','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Completion-gated release provenance is malformed.' using errcode='23514';
    end;

    if v_boundary_id is null
       or v_authorized_from_item_id is null
       or coalesce(v_next_item.metadata->>'release_requirement_set_key','')<>v_expected_requirement_set_key then
      raise exception 'Completion-gated release requires an authorizing State Progression boundary.' using errcode='23514';
    end if;

    select qi.* into v_authorizer
    from atlas.task_release_queue_items qi
    where qi.id=v_authorized_from_item_id
      and qi.farm_id=v_next_item.farm_id
      and qi.queue_key=v_next_item.queue_key
      and qi.id=(
        select previous.id
        from atlas.task_release_queue_items previous
        where previous.farm_id=v_next_item.farm_id
          and previous.queue_key=v_next_item.queue_key
          and previous.position<v_next_item.position
        order by previous.position desc
        limit 1
      );

    if v_authorizer.id is null
       or v_authorizer.state<>'completed'
       or coalesce(v_authorizer.metadata->>'completion_boundary_event_id','')<>v_boundary_id::text then
      raise exception 'Completion-gated release is not authorized by the immediately preceding completed queue item.' using errcode='23514';
    end if;

    select b.* into v_boundary
    from atlas.requirement_boundary_events b
    where b.id=v_boundary_id;

    if v_boundary.id is null
       or v_boundary.subject_kind<>'task_release_queue_item'
       or v_boundary.subject_id is distinct from v_authorizer.id
       or v_boundary.requirement_set_key<>v_expected_requirement_set_key
       or v_boundary.boundary_kind<>'closed'
       or v_boundary.from_state<>'open'
       or v_boundary.to_state<>'satisfied'
       or v_boundary.source_kind<>'task'
       or v_boundary.source_id is distinct from v_authorizer.task_id then
      raise exception 'Completion-gated release boundary does not match its predecessor evidence.' using errcode='23514';
    end if;
  end if;

  v_approval_required:=coalesce((v_next_item.metadata->>'owner_schedule_approval_required')::boolean,false);
  v_approved_date:=nullif(v_next_item.metadata->>'owner_schedule_approved_date','')::date;

  if v_approval_required and v_approved_date is null then
    update atlas.task_release_queue_items
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'owner_schedule_approval_required',true,
          'awaiting_owner_schedule_approval',true,
          'awaiting_owner_schedule_approval_at',now()
        ),
        updated_at=now()
    where id=v_next_item.id;
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  v_occurrence_id:=coalesce(
    v_next_item.planned_occurrence_id,
    (select task.planned_occurrence_id from atlas.tasks task where task.id=v_next_item.task_id)
  );
  if v_occurrence_id is null then
    raise exception 'Queued item % has no planned occurrence and cannot be released safely.',v_next_item.id using errcode='23514';
  end if;

  v_release_timing:=coalesce(nullif(v_next_item.metadata->>'release_timing',''),'next_workday');
  if v_release_timing='same_day' then
    v_due_date:=v_completed_date;
  else
    v_due_date:=v_completed_date+1;
    if extract(dow from v_due_date)=0 then v_due_date:=v_due_date+1; end if;
  end if;

  if v_approved_date is not null then
    v_due_date:=greatest(v_due_date,v_approved_date);
  end if;
  if extract(dow from v_due_date)=0 then v_due_date:=v_due_date+1; end if;

  update atlas.planned_work_occurrences
  set planned_due_date=v_due_date,
      not_before_date=v_due_date,
      gate_satisfied_at=now(),
      state=case when state in ('released','completed') then state else 'eligible' end,
      work_lane=case when v_is_pot_up_serial then 'process_continuation' else work_lane end,
      commitment_kind=case when v_is_pot_up_serial then 'dependency' else commitment_kind end,
      task_payload=case when v_is_pot_up_serial then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(task_payload,'{}'::jsonb),
              '{work_lane}',to_jsonb('process_continuation'::text),true
            ),
            '{commitment_kind}',to_jsonb('dependency'::text),true
          ),
          '{metadata}',
          coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
            'work_lane','process_continuation',
            'commitment_kind','dependency',
            'classification_correction_reason','Completion-gated serial pot-up work is process continuation and cannot be treated as discretionary backlog.',
            'classification_correction_source','release_next_task_in_queue_v1'
          ),
          true
        )
      else task_payload end,
      metadata=(coalesce(metadata,'{}'::jsonb)-'budgetBlocked')||jsonb_build_object(
        'release_queue_key',p_queue_key,
        'release_queue_position',v_next_item.position,
        'released_after_previous_completion',true,
        'released_for_date',v_due_date,
        'queue_gate_satisfied_at',now(),
        'queue_release_timing',v_release_timing,
        'serial_process_continuation',v_is_pot_up_serial
      ),
      updated_at=now()
  where id=v_occurrence_id;

  if v_is_pot_up_serial then
    perform atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,v_due_date);
  else
    perform atlas.release_eligible_work_v1(p_farm_id,v_due_date,1);
  end if;

  select released_task_id into v_task_id
  from atlas.planned_work_occurrences
  where id=v_occurrence_id;

  if v_task_id is not null
     and exists(select 1 from atlas.tasks where id=v_task_id and status in ('open','blocked')) then
    update atlas.task_release_queue_items
    set task_id=v_task_id,
        planned_occurrence_id=v_occurrence_id,
        state='active',
        activated_at=now(),
        updated_at=now(),
        metadata=(coalesce(metadata,'{}'::jsonb)-'awaiting_owner_schedule_approval'-'awaiting_owner_schedule_approval_at'-'release_waiting_on_capacity')||jsonb_build_object(
          'owner_schedule_approval_required',v_approval_required,
          'released_after_completion',true,
          'released_for_date',v_due_date,
          'released_at',now(),
          'release_timing',v_release_timing,
          'release_architecture',case
            when v_is_pot_up_serial then 'boundary_authorized_process_continuation_v1'
            when v_is_owner_completion_gated then 'boundary_authorized_completion_gated_release_v1'
            else 'planned_occurrence_gate'
          end
        )
    where id=v_next_item.id;
  else
    update atlas.task_release_queue_items
    set planned_occurrence_id=v_occurrence_id,
        task_id=null,
        state='queued',
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'owner_schedule_approval_required',v_approval_required,
          'release_attempted_at',now(),
          'release_waiting_on_capacity',true,
          'release_timing',v_release_timing,
          'release_architecture',case
            when v_is_pot_up_serial then 'boundary_authorized_process_continuation_v1'
            when v_is_owner_completion_gated then 'boundary_authorized_completion_gated_release_v1'
            else 'planned_occurrence_gate'
          end
        )
    where id=v_next_item.id;
    v_task_id:=null;
  end if;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
  return v_task_id;
end;
$function$;

revoke execute on function atlas.release_next_task_in_queue_v1(uuid,text,date) from public, anon, authenticated, service_role;