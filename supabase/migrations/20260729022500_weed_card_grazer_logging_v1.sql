-- A Weed Card pass records farm evidence without automatically closing today's served task.
-- The worker explicitly ends today's serving with finish_weed_card_day_v1, unless the bed reaches clear.

create or replace function atlas.record_weed_card_pass_v1(
  p_task_id uuid,
  p_minutes integer,
  p_condition_after text,
  p_work_date date,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_role text;
  v_membership_id uuid;
  v_local_date date := timezone('America/Chicago',now())::date;
  v_session_id uuid;
  v_existing atlas.weed_sessions%rowtype;
  v_minutes integer := coalesce(p_minutes,0);
  v_before_condition text;
  v_transition jsonb;
  v_pressure text;
  v_return_days integer;
  v_start_condition text;
  v_original_action_key text;
  v_original_metadata jsonb;
begin
  if p_task_id is null or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'Task and idempotency key are required.' using errcode='22023';
  end if;
  if v_minutes<0 or v_minutes>480 then
    raise exception 'Minutes must be between 0 and 480.' using errcode='22023';
  end if;
  if atlas.weed_condition_rank_v1(p_condition_after)<0 then
    raise exception 'Unsupported weed condition.' using errcode='22023';
  end if;
  if p_work_date is null or p_work_date<v_local_date-1 or p_work_date>v_local_date+1 then
    raise exception 'Work date is outside the accepted logging window.' using errcode='22023';
  end if;

  select * into v_existing from atlas.weed_sessions where idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'sessionId',v_existing.id,'taskId',v_existing.task_id,'nextTaskId',v_existing.next_task_id,
      'cardId',v_existing.weed_card_id,'passId',v_existing.weed_pass_id,
      'minutes',v_existing.minutes,'minutesKnown',v_existing.minutes_known,
      'conditionAfter',v_existing.condition_after,'passClosed',v_existing.condition_after='clear',
      'taskClosed',v_existing.condition_after='clear','deduplicated',true
    );
  end if;

  select t.* into v_task from atlas.tasks t where t.id=p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if v_task.status<>'open' then raise exception 'This daily Weed Card task is no longer open.' using errcode='22023'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id=v_membership_id)
  then
    raise exception 'This Weed Card is not assigned to the signed-in farm member.' using errcode='42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id=c.object_id
  where x.task_id=p_task_id
  limit 1 for update of c;
  if v_card.id is null then raise exception 'No Weed Card is linked to this task.' using errcode='P0002'; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id=v_card.id and p.status='active'
  for update;

  if v_pass.id is null then
    v_start_condition := case lower(coalesce(v_task.metadata->>'condition',''))
      when 'heavy' then 'heavy'
      when 'high' then 'heavy'
      when 'moderate' then 'medium_pressure'
      when 'medium' then 'medium_pressure'
      when 'light' then 'row_readable'
      when 'low' then 'row_readable'
      when 'clear' then 'clear'
      when 'maintained' then 'clear'
      else v_card.current_condition
    end;

    insert into atlas.weed_passes(
      weed_card_id,status,opened_at,starting_condition,current_condition,target_condition,metadata
    ) values (
      v_card.id,'active',now(),v_start_condition,v_start_condition,v_card.target_condition,
      jsonb_build_object('opened_from_task_id',v_task.id,'source','weed_card_pass_v1')
    ) returning * into v_pass;

    update atlas.weed_cards
    set current_condition=v_start_condition,next_review_on=null,updated_at=now()
    where id=v_card.id;
  end if;

  v_before_condition := v_pass.current_condition;
  if atlas.weed_condition_rank_v1(p_condition_after)<atlas.weed_condition_rank_v1(v_before_condition) then
    raise exception 'A work pass cannot move the bed backward.' using errcode='22023';
  end if;
  if v_minutes=0 and p_condition_after=v_before_condition and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Add time, change the condition, or add a note.' using errcode='22023';
  end if;

  insert into atlas.weed_sessions(
    weed_card_id,weed_pass_id,task_id,work_date,minutes,minutes_known,
    condition_before,condition_after,note,actor_user_id,
    actor_membership_id,idempotency_key,metadata
  ) values (
    v_card.id,v_pass.id,v_task.id,p_work_date,v_minutes,v_minutes>0,
    v_before_condition,p_condition_after,nullif(btrim(coalesce(p_note,'')),''),
    auth.uid(),v_membership_id,p_idempotency_key,
    jsonb_build_object('source','weed_card_pass_v1','task_kept_open',p_condition_after<>'clear')
  ) returning id into v_session_id;

  update atlas.weed_passes
  set current_condition=p_condition_after,
      total_minutes=total_minutes+v_minutes,
      status=case when p_condition_after='clear' then 'closed' else status end,
      closed_at=case when p_condition_after='clear' then now() else closed_at end,
      metadata=metadata||jsonb_build_object('last_session_id',v_session_id,'last_work_date',p_work_date),
      updated_at=now()
  where id=v_pass.id;

  select coalesce(mo.normal_return_interval_days,21) into v_return_days
  from atlas.maintenance_objects mo where mo.id=v_card.maintenance_object_id;
  v_return_days := coalesce(v_return_days,21);

  update atlas.weed_cards
  set current_condition=p_condition_after,last_session_at=now(),
      next_review_on=case when p_condition_after='clear' then p_work_date+v_return_days else null end,
      metadata=metadata||jsonb_build_object('last_session_id',v_session_id,'last_work_date',p_work_date),
      updated_at=now()
  where id=v_card.id;

  v_pressure := case p_condition_after
    when 'heavy' then 'high'
    when 'medium_pressure' then 'medium'
    when 'row_readable' then 'low'
    when 'mostly_clear' then 'low'
    when 'clear' then 'maintained'
  end;

  update atlas.object_state
  set last_touched_at=greatest(coalesce(last_touched_at,p_work_date),p_work_date),
      last_weeded_at=case when p_condition_after='clear' then greatest(coalesce(last_weeded_at,p_work_date),p_work_date) else last_weeded_at end,
      weed_pressure=v_pressure,
      metadata=metadata||jsonb_build_object(
        'weed_card_id',v_card.id,'weed_card_condition',p_condition_after,
        'weed_card_total_minutes',(select total_minutes from atlas.weed_passes where id=v_pass.id),
        'weed_card_last_session_id',v_session_id,'weed_card_last_work_date',p_work_date
      ),updated_at=now()
  where object_id=v_card.object_id;

  update atlas.maintenance_objects
  set condition=case p_condition_after
        when 'heavy' then 'heavy'
        when 'medium_pressure' then 'moderate'
        when 'row_readable' then 'moderate'
        when 'mostly_clear' then 'moderate'
        when 'clear' then 'maintained'
      end,
      last_completed_at=case when p_condition_after='clear' then now() else last_completed_at end,
      next_eligible_date=case when p_condition_after='clear' then p_work_date+normal_return_interval_days else next_eligible_date end,
      active=p_condition_after='clear',
      metadata=metadata||jsonb_build_object(
        'weed_card_managed',true,'weed_card_id',v_card.id,'weed_card_condition',p_condition_after,
        'weed_card_last_session_id',v_session_id,
        'weed_card_total_minutes',(select total_minutes from atlas.weed_passes where id=v_pass.id)
      ),updated_at=now()
  where id=v_card.maintenance_object_id;

  if p_condition_after='clear' then
    v_original_action_key := v_task.action_key;
    v_original_metadata := coalesce(v_task.metadata,'{}'::jsonb);

    update atlas.tasks
    set action_key='weed_session',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('work_route','weed_session','work_rhythm','Weed Session'),
        updated_at=now()
    where id=v_task.id;

    if atlas.is_farm_owner(v_task.farm_id) then
      v_transition := atlas.owner_record_task_transition_v1(
        v_task.id,'done',p_idempotency_key||':task',p_work_date,
        case when v_minutes>0 then concat(v_minutes,' minutes · Clear') else 'Clear' end,
        null,'weed_session','weed_session',
        jsonb_build_object(
          'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
          'minutes',v_minutes,'minutes_known',v_minutes>0,
          'condition_before',v_before_condition,'condition_after',p_condition_after,
          'target_reached',true,'actor_user_id',auth.uid(),'actor_membership_id',v_membership_id
        ),null
      );
    else
      v_transition := atlas.worker_record_task_transition_v1(
        v_task.id,'done',p_idempotency_key||':task',
        case when v_minutes>0 then concat(v_minutes,' minutes · Clear') else 'Clear' end,
        null,
        jsonb_build_object(
          'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
          'minutes',v_minutes,'minutes_known',v_minutes>0,
          'condition_before',v_before_condition,'condition_after',p_condition_after,
          'target_reached',true
        ),p_work_date,'weed_session','weed_session',null
      );
    end if;

    update atlas.tasks t
    set action_key=v_original_action_key,
        metadata=(case when v_original_metadata?'work_route'
          then t.metadata||jsonb_build_object('work_route',v_original_metadata->'work_route')
          else t.metadata-'work_route' end),
        updated_at=now()
    where t.id=v_task.id;

    update atlas.tasks t
    set metadata=(case when v_original_metadata?'work_rhythm'
          then t.metadata||jsonb_build_object('work_rhythm',v_original_metadata->'work_rhythm')
          else t.metadata-'work_rhythm' end),
        updated_at=now()
    where t.id=v_task.id;
  end if;

  return jsonb_build_object(
    'sessionId',v_session_id,'taskId',v_task.id,'nextTaskId',null,
    'cardId',v_card.id,'passId',v_pass.id,
    'minutes',v_minutes,'minutesKnown',v_minutes>0,
    'conditionAfter',p_condition_after,
    'passClosed',p_condition_after='clear','taskClosed',p_condition_after='clear',
    'nextReviewOn',case when p_condition_after='clear' then p_work_date+v_return_days else null end,
    'transition',v_transition,'deduplicated',false
  );
end;
$$;

create or replace function atlas.finish_weed_card_day_v1(
  p_task_id uuid,
  p_work_date date,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_role text;
  v_membership_id uuid;
  v_local_date date := timezone('America/Chicago',now())::date;
  v_next_task_id uuid;
  v_next_occurrence_id uuid;
  v_next_date date;
  v_transition jsonb;
  v_metadata jsonb;
  v_condition_label text;
  v_original_action_key text;
  v_original_metadata jsonb;
begin
  if p_task_id is null or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'Task and idempotency key are required.' using errcode='22023';
  end if;
  if p_work_date is null or p_work_date<v_local_date-1 or p_work_date>v_local_date+1 then
    raise exception 'Work date is outside the accepted logging window.' using errcode='22023';
  end if;

  select t.* into v_task from atlas.tasks t where t.id=p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if v_task.metadata->>'weed_card_day_close_key'=p_idempotency_key then
    return jsonb_build_object(
      'taskId',v_task.id,'taskClosed',true,
      'nextTaskId',nullif(v_task.metadata->>'weed_card_next_task_id','')::uuid,
      'deduplicated',true
    );
  end if;
  if v_task.status<>'open' then raise exception 'This daily Weed Card task is no longer open.' using errcode='22023'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id=v_membership_id)
  then
    raise exception 'This Weed Card is not assigned to the signed-in farm member.' using errcode='42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id=c.object_id
  where x.task_id=p_task_id
  limit 1 for update of c;
  if v_card.id is null then raise exception 'No Weed Card is linked to this task.' using errcode='P0002'; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id=v_card.id and p.status='active'
  for update;

  select go.* into v_object from atlas.growing_objects go where go.id=v_card.object_id;
  v_condition_label := case coalesce(v_pass.current_condition,v_card.current_condition)
    when 'heavy' then 'Heavy pressure'
    when 'medium_pressure' then 'Medium pressure'
    when 'row_readable' then 'Row readable'
    when 'mostly_clear' then 'Mostly clear'
    when 'clear' then 'Clear'
  end;

  if coalesce(v_pass.current_condition,v_card.current_condition)<>'clear' then
    v_next_date := greatest(p_work_date,coalesce(v_task.due_date,p_work_date))+1;
    select t.id into v_next_task_id
    from atlas.tasks t
    where t.farm_id=v_task.farm_id
      and t.id<>v_task.id
      and t.status in ('open','blocked')
      and t.due_date=v_next_date
      and t.metadata->>'weed_card_id'=v_card.id::text
    limit 1;

    if v_next_task_id is null then
      v_metadata := jsonb_build_object(
        'anna_task',coalesce(v_task.metadata->'anna_task','true'::jsonb),
        'owner_task',false,
        'assigned_to',coalesce(nullif(v_task.metadata->>'assigned_to',''),'Anna'),
        'assignee_key',coalesce(nullif(v_task.metadata->>'assignee_key',''),'anna'),
        'work_route','weed','work_rhythm','Weeding','display_action','Weed',
        'display_title',v_task.title,'display_subject',v_object.label,
        'main_crop_label',coalesce(nullif(v_task.metadata->>'main_crop_label',''),'Bed'),
        'collection_zone',coalesce(nullif(v_task.metadata->>'collection_zone',''),'Field Rows'),
        'collection_label',v_object.label,'maintenance_type','weed','target_object_id',v_object.id,
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_card_session_task',true,
        'task_key',concat('weed_card_',replace(v_card.id::text,'-',''),'_',v_next_date::text),
        'day_order',coalesce(v_task.metadata->'day_order','500'::jsonb),
        'work_order',coalesce(v_task.metadata->'work_order','2'::jsonb),
        'day_work_order',coalesce(v_task.metadata->'day_work_order','2'::jsonb),
        'run_sheet_order',coalesce(v_task.metadata->'run_sheet_order','2'::jsonb),
        'release_reason','weed_card_continuation'
      );

      v_next_occurrence_id := atlas.plan_work_occurrence_v1(
        v_task.farm_id,
        'maintenance:weed-card:'||v_object.stable_key,
        'maintenance:weed-card:'||v_object.stable_key||':serial',
        'weed-card:'||v_card.id::text||':'||v_next_date::text,
        v_task.title,'maintenance',v_next_date,'weed_card',v_card.id,
        'serial_queue',14,1,
        jsonb_build_object(
          'farm_id',v_task.farm_id,'zone_id',v_task.zone_id,'title',v_task.title,
          'task_type','maintenance','status','open','priority',v_task.priority,
          'due_date',v_next_date,'generated_from','weed_card','generated_from_id',v_card.id,
          'metadata',v_metadata,'action_key','weed','work_class',coalesce(v_task.work_class,'standard'),
          'visibility_scope',v_task.visibility_scope,'assigned_membership_id',v_task.assigned_membership_id,
          'task_series_key','weed_card:'||v_card.id::text,
          'engine_instance_key','weed_card:'||v_card.id::text||':'||v_next_date::text
        ),
        jsonb_build_object('task_objects',jsonb_build_array(jsonb_build_object('object_id',v_card.object_id,'role','target'))),
        jsonb_build_object('weed_card_id',v_card.id),
        v_next_date-14,
        jsonb_build_object('planned_by','finish_weed_card_day_v1','weed_card_id',v_card.id,'weed_pass_id',v_pass.id)
      );
    end if;
  end if;

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('weed_card_day_close_key',p_idempotency_key),
      updated_at=now()
  where id=v_task.id;

  v_original_action_key := v_task.action_key;
  v_original_metadata := coalesce(v_task.metadata,'{}'::jsonb);

  update atlas.tasks
  set action_key='weed_session',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('work_route','weed_session','work_rhythm','Weed Session'),
      updated_at=now()
  where id=v_task.id;

  if atlas.is_farm_owner(v_task.farm_id) then
    v_transition := atlas.owner_record_task_transition_v1(
      v_task.id,'done',p_idempotency_key||':task',p_work_date,
      v_condition_label,null,'weed_session','weed_session',
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,
        'condition_after',coalesce(v_pass.current_condition,v_card.current_condition),
        'day_closed',true,'target_reached',coalesce(v_pass.current_condition,v_card.current_condition)='clear',
        'actor_user_id',auth.uid(),'actor_membership_id',v_membership_id
      ),null
    );
  else
    v_transition := atlas.worker_record_task_transition_v1(
      v_task.id,'done',p_idempotency_key||':task',
      v_condition_label,null,
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,
        'condition_after',coalesce(v_pass.current_condition,v_card.current_condition),
        'day_closed',true,'target_reached',coalesce(v_pass.current_condition,v_card.current_condition)='clear'
      ),p_work_date,'weed_session','weed_session',null
    );
  end if;

  update atlas.tasks t
  set action_key=v_original_action_key,
      metadata=(case when v_original_metadata?'work_route'
        then t.metadata||jsonb_build_object('work_route',v_original_metadata->'work_route')
        else t.metadata-'work_route' end),
      updated_at=now()
  where t.id=v_task.id;

  update atlas.tasks t
  set metadata=(case when v_original_metadata?'work_rhythm'
        then t.metadata||jsonb_build_object('work_rhythm',v_original_metadata->'work_rhythm')
        else t.metadata-'work_rhythm' end),
      updated_at=now()
  where t.id=v_task.id;

  if v_next_task_id is null and v_next_occurrence_id is not null then
    select o.released_task_id into v_next_task_id
    from atlas.planned_work_occurrences o where o.id=v_next_occurrence_id;
    if v_next_task_id is null then
      v_next_task_id := atlas.release_weed_card_continuation_v1(v_next_occurrence_id,v_task.id);
    end if;
  end if;

  update atlas.tasks
  set metadata=metadata||jsonb_strip_nulls(jsonb_build_object('weed_card_next_task_id',v_next_task_id)),
      updated_at=now()
  where id=v_task.id;

  return jsonb_build_object(
    'taskId',v_task.id,'taskClosed',true,'nextTaskId',v_next_task_id,
    'nextOccurrenceId',v_next_occurrence_id,'cardId',v_card.id,'passId',v_pass.id,
    'conditionAfter',coalesce(v_pass.current_condition,v_card.current_condition),
    'passClosed',coalesce(v_pass.current_condition,v_card.current_condition)='clear',
    'transition',v_transition,'deduplicated',false
  );
end;
$$;

revoke all on function atlas.record_weed_card_pass_v1(uuid,integer,text,date,text,text) from public;
revoke all on function atlas.finish_weed_card_day_v1(uuid,date,text) from public;
grant execute on function atlas.record_weed_card_pass_v1(uuid,integer,text,date,text,text) to authenticated,service_role;
grant execute on function atlas.finish_weed_card_day_v1(uuid,date,text) to authenticated,service_role;
