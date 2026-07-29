-- Idempotent final state after the live FR4–FR6 Weed Card pilot corrections.

create or replace function atlas.enrich_weed_card_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_card_id uuid;
  v_pass_id uuid;
  v_managed boolean := false;
  v_metadata jsonb;
begin
  if new.source_kind <> 'maintenance_weeding_collection' or new.source_id is null then
    return new;
  end if;

  select c.id,p.id,lower(coalesce(mo.metadata->>'weed_card_managed','false')) in ('true','yes','1')
  into v_card_id,v_pass_id,v_managed
  from atlas.maintenance_objects mo
  join atlas.weed_cards c on c.maintenance_object_id=mo.id
  left join atlas.weed_passes p on p.weed_card_id=c.id and p.status='active'
  where mo.id=new.source_id;

  if not coalesce(v_managed,false) or v_card_id is null then return new; end if;

  v_metadata := coalesce(new.task_payload->'metadata','{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'weed_card_id',v_card_id,
      'weed_pass_id',v_pass_id,
      'weed_card_session_task',true,
      'release_gate_installed',true
    ));
  new.task_payload := jsonb_set(coalesce(new.task_payload,'{}'::jsonb),'{metadata}',v_metadata,true);
  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object('weed_card_id',v_card_id,'weed_card_managed',true);
  return new;
end;
$$;

drop trigger if exists enrich_weed_card_occurrence_v1 on atlas.planned_work_occurrences;
create trigger enrich_weed_card_occurrence_v1
before insert or update of source_kind,source_id,task_payload
on atlas.planned_work_occurrences
for each row execute function atlas.enrich_weed_card_occurrence_v1();

create or replace function atlas.weed_card_task_focus_v1(p_task_id uuid)
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
  v_zone_label text;
  v_role text;
  v_membership_id uuid;
  v_sessions jsonb;
  v_condition text;
begin
  select t.* into v_task from atlas.tasks t where t.id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id=v_membership_id)
  then
    raise exception 'This Weed Card is not available to the signed-in farm member.' using errcode='42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id=c.object_id
  where x.task_id=p_task_id
  limit 1;
  if v_card.id is null then return null; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id=v_card.id and p.status='active'
  limit 1;

  v_condition := coalesce(
    v_pass.current_condition,
    case lower(coalesce(v_task.metadata->>'condition',''))
      when 'heavy' then 'heavy'
      when 'high' then 'heavy'
      when 'moderate' then 'medium_pressure'
      when 'medium' then 'medium_pressure'
      when 'light' then 'row_readable'
      when 'low' then 'row_readable'
      when 'clear' then 'clear'
      when 'maintained' then 'clear'
      else null
    end,
    v_card.current_condition
  );

  select go.* into v_object from atlas.growing_objects go where go.id=v_card.object_id;
  select z.label into v_zone_label from atlas.zones z where z.id=v_object.zone_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'workDate',s.work_date,'minutes',s.minutes,
    'conditionBefore',s.condition_before,'conditionAfter',s.condition_after,
    'note',s.note,'recordedAt',s.recorded_at
  ) order by s.recorded_at desc),'[]'::jsonb)
  into v_sessions
  from (
    select ws.*
    from atlas.weed_sessions ws
    where ws.weed_card_id=v_card.id
      and (v_pass.id is null or ws.weed_pass_id=v_pass.id)
    order by ws.recorded_at desc
    limit 12
  ) s;

  return jsonb_build_object(
    'taskId',v_task.id,'taskStatus',v_task.status,'taskDueDate',v_task.due_date,
    'cardId',v_card.id,'passId',v_pass.id,'passStatus',coalesce(v_pass.status,'closed'),
    'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'zoneLabel',coalesce(v_zone_label,'Elm Farm'),
    'cropLabel',coalesce(nullif(v_task.metadata->>'main_crop_label',''),nullif(v_task.metadata->>'crop_label',''),'Bed'),
    'condition',v_condition,'targetCondition',coalesce(v_pass.target_condition,v_card.target_condition),
    'totalMinutes',coalesce(v_pass.total_minutes,0),
    'sessionCount',case when v_pass.id is null then 0 else jsonb_array_length(v_sessions) end,
    'nextReviewOn',v_card.next_review_on,
    'sessions',case when v_pass.id is null then '[]'::jsonb else v_sessions end
  );
end;
$$;

create or replace function atlas.release_weed_card_continuation_v1(
  p_occurrence_id uuid,
  p_source_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_occ atlas.planned_work_occurrences%rowtype;
  v_source atlas.tasks%rowtype;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_card_id uuid;
  v_existing uuid;
begin
  if p_occurrence_id is null or p_source_task_id is null then
    raise exception 'Occurrence and source task are required.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('weed-card-replacement:'||p_occurrence_id::text,0));
  select * into v_source from atlas.tasks where id=p_source_task_id;
  if v_source.id is null or v_source.status<>'done' then
    raise exception 'The prior Weed Card session must be done before its replacement is released.' using errcode='22023';
  end if;

  select * into v_occ from atlas.planned_work_occurrences where id=p_occurrence_id for update;
  if v_occ.id is null or v_occ.farm_id<>v_source.farm_id or v_occ.source_kind<>'weed_card' then
    raise exception 'The replacement occurrence is not a Weed Card continuation for this farm.' using errcode='22023';
  end if;

  v_card_id := v_occ.source_id;
  if v_card_id is null or v_source.metadata->>'weed_card_id' is distinct from v_card_id::text then
    raise exception 'The replacement occurrence does not match the completed Weed Card.' using errcode='22023';
  end if;

  if v_occ.state='released' and v_occ.released_task_id is not null then return v_occ.released_task_id; end if;
  if v_occ.state not in ('planned','eligible','failed','releasing') then
    raise exception 'The Weed Card occurrence cannot be released from state %.',v_occ.state using errcode='22023';
  end if;

  select t.id into v_existing
  from atlas.tasks t
  where t.farm_id=v_occ.farm_id
    and t.status in ('open','blocked')
    and t.metadata->>'weed_card_id'=v_card_id::text
    and t.due_date=v_occ.planned_due_date
  order by t.created_at
  limit 1;
  if v_existing is not null then
    update atlas.planned_work_occurrences
    set state='released',released_at=coalesce(released_at,now()),released_task_id=v_existing,updated_at=now()
    where id=v_occ.id;
    return v_existing;
  end if;

  select * into v_template from jsonb_populate_record(null::atlas.tasks,v_occ.task_payload);
  if coalesce(v_template.metadata->>'weed_card_id','')<>v_card_id::text
     or lower(coalesce(v_template.metadata->>'weed_card_session_task','false')) not in ('true','yes','1')
  then
    raise exception 'The occurrence payload is not a governed Weed Card session.' using errcode='22023';
  end if;

  update atlas.planned_work_occurrences
  set state='releasing',updated_at=now(),metadata=metadata||jsonb_build_object(
    'replacement_source_task_id',v_source.id,
    'replacement_release_at',now(),
    'replacement_release_reason','same_card_daily_session'
  )
  where id=v_occ.id;

  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,
    unlock_text,blocker_text,generated_from,generated_from_id,note,metadata,
    action_key,work_class,parent_task_id,task_series_key,engine_instance_key,
    visibility_scope,assigned_membership_id,planned_occurrence_id,
    release_policy_id,released_at,release_reason,organization_id,task_scope,
    assigned_user_id,created_by_user_id,origin_kind
  ) values (
    v_occ.farm_id,v_template.zone_id,v_occ.title,
    coalesce(nullif(v_template.task_type,''),'maintenance'),'open',
    coalesce(nullif(v_template.priority,''),'normal'),v_occ.planned_due_date,
    v_template.unlock_text,null,'weed_card',v_card_id,v_template.note,
    coalesce(v_template.metadata,'{}'::jsonb)||jsonb_build_object(
      'released_by','release_weed_card_continuation_v1',
      'replacement_source_task_id',v_source.id
    ),
    coalesce(nullif(v_template.action_key,''),'weed'),
    coalesce(nullif(v_template.work_class,''),'standard'),null,
    v_template.task_series_key,v_template.engine_instance_key,
    coalesce(v_template.visibility_scope,v_source.visibility_scope),
    coalesce(v_template.assigned_membership_id,v_source.assigned_membership_id),
    v_occ.id,v_occ.release_policy_id,now(),'weed_card_replacement',
    v_source.organization_id,v_source.task_scope,v_source.assigned_user_id,
    auth.uid(),'generated'
  ) returning id into v_task_id;

  perform atlas.restore_task_relation_payload_v1(v_task_id,v_occ.relation_payload);
  perform atlas.attach_released_task_to_source_v1(v_occ.id,v_task_id);
  return v_task_id;
end;
$$;

create or replace function atlas.record_weed_card_session_v1(
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
  v_object atlas.growing_objects%rowtype;
  v_role text;
  v_membership_id uuid;
  v_local_date date := timezone('America/Chicago',now())::date;
  v_session_id uuid;
  v_existing atlas.weed_sessions%rowtype;
  v_next_task_id uuid;
  v_next_occurrence_id uuid;
  v_next_date date;
  v_transition jsonb;
  v_metadata jsonb;
  v_condition_label text;
  v_pressure text;
  v_return_days integer;
  v_start_condition text;
  v_original_action_key text;
  v_original_metadata jsonb;
begin
  if p_task_id is null or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'Task and idempotency key are required.' using errcode='22023';
  end if;
  if p_minutes is null or p_minutes<1 or p_minutes>480 then
    raise exception 'Minutes must be between 1 and 480.' using errcode='22023';
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
      'sessionId',v_existing.id,'taskId',v_existing.task_id,
      'nextTaskId',v_existing.next_task_id,'conditionAfter',v_existing.condition_after,
      'minutes',v_existing.minutes,'deduplicated',true
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
      jsonb_build_object('opened_from_task_id',v_task.id,'source','weed_card_session_v1')
    ) returning * into v_pass;

    update atlas.weed_cards set current_condition=v_start_condition,next_review_on=null,updated_at=now() where id=v_card.id;
  end if;

  if atlas.weed_condition_rank_v1(p_condition_after)<atlas.weed_condition_rank_v1(v_pass.current_condition) then
    raise exception 'A work session cannot move the bed backward. Open a new observation instead.' using errcode='22023';
  end if;

  select go.* into v_object from atlas.growing_objects go where go.id=v_card.object_id;

  if p_condition_after<>'clear' then
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
        'display_detail',concat('Continue clearing · ',coalesce(nullif(v_task.metadata->>'main_crop_label',''),'bed')),
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
        jsonb_build_object('planned_by','record_weed_card_session_v1','weed_card_id',v_card.id,'weed_pass_id',v_pass.id)
      );
    end if;
  end if;

  insert into atlas.weed_sessions(
    weed_card_id,weed_pass_id,task_id,work_date,minutes,
    condition_before,condition_after,note,actor_user_id,
    actor_membership_id,idempotency_key,metadata
  ) values (
    v_card.id,v_pass.id,v_task.id,p_work_date,p_minutes,
    v_pass.current_condition,p_condition_after,nullif(btrim(coalesce(p_note,'')),''),
    auth.uid(),v_membership_id,p_idempotency_key,
    jsonb_build_object('source','weed_card_task_focus_v1','next_occurrence_id',v_next_occurrence_id)
  ) returning id into v_session_id;

  update atlas.weed_passes
  set current_condition=p_condition_after,
      total_minutes=total_minutes+p_minutes,
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

  v_condition_label := case p_condition_after
    when 'heavy' then 'Heavy pressure'
    when 'medium_pressure' then 'Medium pressure'
    when 'row_readable' then 'Row readable'
    when 'mostly_clear' then 'Mostly clear'
    when 'clear' then 'Clear'
  end;

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
      concat(p_minutes,' minutes · ',v_condition_label),'Weed Card session logged',
      'weed_session','weed_session',
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
        'minutes',p_minutes,'condition_before',v_pass.current_condition,'condition_after',p_condition_after,
        'target_reached',p_condition_after='clear','actor_user_id',auth.uid(),'actor_membership_id',v_membership_id
      ),null
    );
  else
    v_transition := atlas.worker_record_task_transition_v1(
      v_task.id,'done',p_idempotency_key||':task',
      concat(p_minutes,' minutes · ',v_condition_label),'Weed Card session logged',
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
        'minutes',p_minutes,'condition_before',v_pass.current_condition,'condition_after',p_condition_after,
        'target_reached',p_condition_after='clear'
      ),p_work_date,'weed_session','weed_session',null
    );
  end if;

  update atlas.tasks t
  set action_key=v_original_action_key,
      metadata=case when v_original_metadata?'work_route'
        then t.metadata||jsonb_build_object('work_route',v_original_metadata->'work_route')
        else t.metadata-'work_route' end,
      updated_at=now()
  where t.id=v_task.id;

  update atlas.tasks t
  set metadata=case when v_original_metadata?'work_rhythm'
        then t.metadata||jsonb_build_object('work_rhythm',v_original_metadata->'work_rhythm')
        else t.metadata-'work_rhythm' end,
      updated_at=now()
  where t.id=v_task.id;

  if v_next_task_id is null and v_next_occurrence_id is not null then
    select o.released_task_id into v_next_task_id
    from atlas.planned_work_occurrences o where o.id=v_next_occurrence_id;
    if v_next_task_id is null then
      v_next_task_id := atlas.release_weed_card_continuation_v1(v_next_occurrence_id,v_task.id);
    end if;
  end if;

  update atlas.weed_sessions set next_task_id=v_next_task_id where id=v_session_id;

  return jsonb_build_object(
    'sessionId',v_session_id,'taskId',v_task.id,'nextTaskId',v_next_task_id,
    'nextOccurrenceId',v_next_occurrence_id,'cardId',v_card.id,'passId',v_pass.id,
    'minutes',p_minutes,'conditionAfter',p_condition_after,
    'passClosed',p_condition_after='clear',
    'nextReviewOn',case when p_condition_after='clear' then p_work_date+v_return_days else null end,
    'transition',v_transition,'deduplicated',false
  );
end;
$$;

revoke all on function atlas.release_weed_card_continuation_v1(uuid,uuid) from public;
revoke all on function atlas.weed_card_task_focus_v1(uuid) from public;
revoke all on function atlas.record_weed_card_session_v1(uuid,integer,text,date,text,text) from public;
grant execute on function atlas.weed_card_task_focus_v1(uuid) to authenticated,service_role;
grant execute on function atlas.record_weed_card_session_v1(uuid,integer,text,date,text,text) to authenticated,service_role;

update atlas.planned_work_occurrences o
set state='cancelled',updated_at=now(),
    metadata=metadata||jsonb_build_object('cancelled_for_active_weed_card_pass',true,'cancelled_at',now())
where o.source_kind='maintenance_weeding_collection'
  and o.state in ('planned','eligible','failed')
  and exists (
    select 1 from atlas.weed_cards c
    join atlas.weed_passes p on p.weed_card_id=c.id and p.status='active'
    where c.maintenance_object_id=o.source_id
  );

update atlas.object_state os
set last_weeded_at=coalesce(nullif(mo.metadata->>'last_weeded_at','')::date,mo.last_completed_at::date,os.last_weeded_at),
    weed_pressure=case c.current_condition
      when 'heavy' then 'high'
      when 'medium_pressure' then 'medium'
      when 'row_readable' then 'low'
      when 'mostly_clear' then 'low'
      when 'clear' then 'maintained'
      else os.weed_pressure
    end,
    metadata=os.metadata||jsonb_build_object(
      'weed_card_partial_truth_restored_at',now(),
      'weed_card_partial_truth_source','weed_card_final_contract_v1'
    ),updated_at=now()
from atlas.weed_cards c
join atlas.maintenance_objects mo on mo.id=c.maintenance_object_id
join atlas.growing_objects go on go.id=c.object_id
where os.object_id=c.object_id
  and go.stable_key in ('fr_4','fr_5','fr_6')
  and c.current_condition<>'clear';
