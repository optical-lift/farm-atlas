create or replace function atlas.record_production_field_care_v1(
  p_task_id uuid,
  p_action text,
  p_results jsonb,
  p_care_date date,
  p_note text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_task atlas.tasks%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_expected_role text;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_field_log uuid;
  v_transition jsonb;
  v_gate jsonb;
  v_row record;
  v_state atlas.production_field_care_state%rowtype;
  v_stand atlas.production_field_stands%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_total numeric;
  v_observation_id uuid;
begin
  if p_task_id is null
     or p_action not in ('water','weed','pinch')
     or p_care_date is null
     or p_results is null
     or jsonb_typeof(p_results)<>'array'
     or jsonb_array_length(p_results)=0
  then
    raise exception 'Task, care action, date, and object results are required' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>120 then
    raise exception 'A valid field-care idempotency key is required' using errcode='22023';
  end if;
  if p_care_date>v_today+1 then
    raise exception 'Care date cannot be in the future' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  v_expected_role:=case p_action
    when 'water' then 'water_care'
    when 'weed' then 'weed_care'
    else 'pinch_care'
  end;

  select pl.* into v_lot
  from atlas.production_lot_tasks plt
  join atlas.production_lots pl on pl.id=plt.production_lot_id
  where plt.task_id=p_task_id and plt.link_role=v_expected_role
  limit 1
  for update of pl;

  if v_task.id is null or v_lot.id is null then
    raise exception 'Task is not linked to this production field-care action' using errcode='22023';
  end if;
  if exists(
    select 1 from atlas.field_logs
    where farm_id=v_lot.farm_id
      and idempotency_key=left(v_key||':field-log',160)
  ) then
    return jsonb_build_object(
      'taskId',p_task_id,
      'productionLotId',v_lot.id,
      'deduplicated',true
    );
  end if;
  if v_task.status not in ('open','blocked') then
    raise exception 'Field-care task is not open' using errcode='22023';
  end if;

  create temporary table if not exists pg_temp.production_care_input(
    object_id uuid primary key,
    plants_alive numeric
  ) on commit drop;
  truncate pg_temp.production_care_input;

  insert into pg_temp.production_care_input(object_id,plants_alive)
  select
    (x->>'objectId')::uuid,
    case
      when nullif(x->>'plantsAlive','') is null then null
      else (x->>'plantsAlive')::numeric
    end
  from jsonb_array_elements(p_results) x;

  if (select count(*) from pg_temp.production_care_input)
     <>(select count(*) from atlas.task_objects where task_id=p_task_id)
  then
    raise exception 'Every bed linked to this care task must be confirmed' using errcode='22023';
  end if;

  if exists(
    select 1
    from pg_temp.production_care_input i
    left join atlas.task_objects t
      on t.task_id=p_task_id and t.object_id=i.object_id
    left join atlas.production_field_care_state s
      on s.production_lot_id=v_lot.id and s.object_id=i.object_id
    left join atlas.production_field_stands fs on fs.id=s.field_stand_id
    where t.object_id is null
       or s.id is null
       or fs.id is null
       or i.plants_alive<0
       or (i.plants_alive is not null and i.plants_alive>fs.current_plants)
  ) then
    raise exception 'Care results must use linked production stands and cannot increase living plants' using errcode='22023';
  end if;

  insert into atlas.field_logs(
    farm_id,log_date,action_types,summary_sentence,note,
    created_by,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,p_care_date,
    array[p_action,'production_field_care'],
    'Completed '||p_action||' care for '||v_lot.lot_label,
    p_note,'production_stage_engine','production_stage_engine',
    left(v_key||':field-log',160),
    jsonb_build_object(
      'production_lot_id',v_lot.id,
      'action',p_action,
      'results',p_results
    )
  ) returning id into v_field_log;

  for v_row in select * from pg_temp.production_care_input loop
    select * into v_state
    from atlas.production_field_care_state
    where production_lot_id=v_lot.id and object_id=v_row.object_id
    for update;
    select * into v_stand
    from atlas.production_field_stands
    where id=v_state.field_stand_id
    for update;
    select * into v_object from atlas.growing_objects where id=v_state.object_id;

    update atlas.production_field_stands
    set current_plants=coalesce(v_row.plants_alive,current_plants),
        total_losses=plants_transplanted-coalesce(v_row.plants_alive,current_plants),
        stand_status=case
          when coalesce(v_row.plants_alive,current_plants)=0 then 'failed'
          else 'field_care'
        end,
        last_observed_date=p_care_date,
        metadata=metadata||jsonb_build_object(
          'last_care_action',p_action,
          'last_care_date',p_care_date
        ),
        updated_at=now()
    where id=v_stand.id;

    insert into atlas.production_field_observations(
      farm_id,production_lot_id,task_id,object_id,crop_cycle_id,
      field_stand_id,observation_type,outcome,observed_date,
      quantity,unit,note,idempotency_key,metadata
    ) values(
      v_lot.farm_id,v_lot.id,p_task_id,v_state.object_id,v_state.crop_cycle_id,
      v_stand.id,p_action,
      case p_action
        when 'water' then 'watered'
        when 'weed' then 'weeded'
        else 'pinched'
      end,
      p_care_date,coalesce(v_row.plants_alive,v_stand.current_plants),
      'plants_alive',p_note,
      left(v_key||':object:'||v_state.object_id::text,160),
      jsonb_build_object('prior_plants_alive',v_stand.current_plants)
    ) returning id into v_observation_id;

    update atlas.production_field_care_state
    set plants_alive=coalesce(v_row.plants_alive,v_stand.current_plants),
        establishment_status=case
          when coalesce(v_row.plants_alive,v_stand.current_plants)=0 then 'failed'
          else 'established'
        end,
        water_status=case when p_action='water' then 'adequate' else water_status end,
        weed_pressure=case when p_action='weed' then 'clear' else weed_pressure end,
        pinch_status=case when p_action='pinch' then 'done' else pinch_status end,
        last_watered_at=case when p_action='water' then p_care_date else last_watered_at end,
        last_weeded_at=case when p_action='weed' then p_care_date else last_weeded_at end,
        last_pinched_at=case when p_action='pinch' then p_care_date else last_pinched_at end,
        metadata=metadata||jsonb_build_object(
          'last_care_task_id',p_task_id,
          'last_care_action',p_action
        ),
        updated_at=now()
    where id=v_state.id;

    update atlas.crop_cycles
    set cycle_state=case
          when coalesce(v_row.plants_alive,v_stand.current_plants)=0 then 'failed'
          else 'growing'
        end,
        lifecycle_status=case
          when coalesce(v_row.plants_alive,v_stand.current_plants)=0 then 'archived'
          else 'active'
        end,
        coverage_kind='plants_alive',
        coverage_amount=coalesce(v_row.plants_alive,v_stand.current_plants),
        coverage_unit='plants',
        metadata=metadata||jsonb_build_object(
          'last_production_care_action',p_action,
          'last_production_care_date',p_care_date
        ),
        updated_at=now()
    where id=v_state.crop_cycle_id;

    insert into atlas.object_activity_events(
      farm_id,object_id,field_log_id,crop_cycle_id,event_type,event_date,
      note,quantity,unit,created_by,source,idempotency_key,metadata
    ) values(
      v_lot.farm_id,v_state.object_id,v_field_log,v_state.crop_cycle_id,
      case p_action
        when 'water' then 'watered'
        when 'weed' then 'weeded'
        else 'maintained'
      end,
      p_care_date,p_note,
      coalesce(v_row.plants_alive,v_stand.current_plants),
      'plants_alive','production_stage_engine','production_stage_engine',
      left(v_key||':event:'||v_state.object_id::text,160),
      jsonb_build_object(
        'production_lot_id',v_lot.id,
        'field_stand_id',v_stand.id,
        'care_action',p_action
      )
    ) on conflict do nothing;

    insert into atlas.field_log_objects(field_log_id,zone_id,object_id,role)
    values(v_field_log,v_object.zone_id,v_object.id,'production_care')
    on conflict do nothing;

    update atlas.object_state
    set life_status=case
          when coalesce(v_row.plants_alive,v_stand.current_plants)=0 then 'failed'
          else 'growing'
        end,
        water_status=case when p_action='water' then 'irrigated' else water_status end,
        weed_pressure=case when p_action='weed' then 'clear' else weed_pressure end,
        last_touched_at=p_care_date,
        last_watered_at=case when p_action='water' then p_care_date else last_watered_at end,
        last_weeded_at=case when p_action='weed' then p_care_date else last_weeded_at end,
        metadata=metadata||jsonb_build_object(
          'production_lot_id',v_lot.id,
          'field_stand_id',v_stand.id,
          'plants_alive',coalesce(v_row.plants_alive,v_stand.current_plants),
          'last_production_care_action',p_action
        ),
        updated_at=now()
    where object_id=v_state.object_id;
  end loop;

  select coalesce(sum(current_plants),0) into v_total
  from atlas.production_field_stands
  where production_lot_id=v_lot.id and stand_status<>'cleared';

  update atlas.production_lots
  set current_quantity=v_total,
      current_unit='plants',
      current_stage=case when v_total=0 then 'field_failure_decision' else 'field_care' end,
      lifecycle_status=case when v_total=0 then 'failed' else lifecycle_status end,
      metadata=metadata||jsonb_build_object(
        'last_biological_event',p_action||'_care_completed',
        'last_care_date',p_care_date
      ),
      updated_at=now()
  where id=v_lot.id;

  insert into atlas.production_lot_events(
    farm_id,production_lot_id,event_type,event_date,quantity,unit,
    task_id,note,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,v_lot.id,p_action||'_care_completed',p_care_date,
    v_total,'plants_alive',p_task_id,p_note,
    'production_stage_engine',left(v_key||':event:lot',160),
    jsonb_build_object('field_log_id',v_field_log,'results',p_results)
  );

  perform atlas.sync_production_care_policies_v1(v_lot.id);
  if p_action='pinch' then
    update atlas.production_care_policies
    set current_status='satisfied',
        last_observation_id=v_observation_id,
        last_satisfied_at=p_care_date,
        metadata=metadata||jsonb_build_object('completed_task_id',p_task_id),
        updated_at=now()
    where production_lot_id=v_lot.id and care_kind='pinching';
  end if;

  v_transition:=atlas.record_task_transition_v1_internal(
    p_task_id,'done',left(v_key||':task:done',160),null,
    coalesce(nullif(btrim(p_note),''),initcap(p_action)||' care completed.'),
    null,p_action,'production_lot',
    jsonb_build_object(
      'production_lot_id',v_lot.id,
      'plants_alive',v_total,
      'results',p_results
    ),
    v_field_log
  );

  v_gate:=atlas.refresh_production_harvest_gate_v1(v_lot.id);

  return jsonb_build_object(
    'taskId',p_task_id,
    'productionLotId',v_lot.id,
    'action',p_action,
    'plantsAlive',v_total,
    'fieldLogId',v_field_log,
    'harvestGate',v_gate,
    'deduplicated',false
  );
end; $$;

create or replace function atlas.set_production_harvest_rules_v1(
  p_production_lot_id uuid,
  p_pinch_required boolean,
  p_harvest_watch_start date,
  p_harvest_watch_end date,
  p_confidence text,
  p_note text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_lot atlas.production_lots%rowtype;
  v_rule atlas.production_harvest_rules%rowtype;
  v_gate jsonb;
  v_task atlas.tasks%rowtype;
  v_pinch_task uuid;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  if p_production_lot_id is null
     or p_pinch_required is null
     or p_harvest_watch_start is null
     or p_harvest_watch_end is null
     or p_harvest_watch_end<p_harvest_watch_start
  then
    raise exception 'Production lot, pinch decision, and valid harvest-watch window are required' using errcode='22023';
  end if;
  if p_confidence not in ('confirmed','estimated') then
    raise exception 'Confidence must be confirmed or estimated' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>120 then
    raise exception 'A valid harvest-rules idempotency key is required' using errcode='22023';
  end if;

  select * into v_lot
  from atlas.production_lots
  where id=p_production_lot_id
  for update;
  if v_lot.id is null then
    raise exception 'Production lot was not found' using errcode='P0002';
  end if;

  select * into v_rule
  from atlas.production_harvest_rules
  where farm_id=v_lot.farm_id and idempotency_key=v_key;
  if v_rule.id is not null then
    return jsonb_build_object(
      'productionLotId',v_lot.id,
      'harvestRuleId',v_rule.id,
      'deduplicated',true
    );
  end if;

  insert into atlas.production_harvest_rules(
    farm_id,production_lot_id,pinch_required,
    harvest_watch_start,harvest_watch_end,
    confidence,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,v_lot.id,p_pinch_required,
    p_harvest_watch_start,p_harvest_watch_end,
    p_confidence,'owner_decision',v_key,
    jsonb_build_object('note',p_note)
  )
  on conflict(production_lot_id) do update set
    pinch_required=excluded.pinch_required,
    harvest_watch_start=excluded.harvest_watch_start,
    harvest_watch_end=excluded.harvest_watch_end,
    confidence=excluded.confidence,
    idempotency_key=excluded.idempotency_key,
    metadata=atlas.production_harvest_rules.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_rule;

  update atlas.production_lots
  set expected_harvest_start=p_harvest_watch_start,
      expected_harvest_end=p_harvest_watch_end,
      metadata=metadata||jsonb_build_object(
        'pinch_required',p_pinch_required,
        'harvest_rule_confidence',p_confidence
      ),
      updated_at=now()
  where id=v_lot.id;

  perform atlas.sync_production_care_policies_v1(v_lot.id);

  insert into atlas.production_care_policies(
    farm_id,production_lot_id,care_kind,policy_status,
    required_before_harvest,current_status,source_task_id,metadata
  ) values(
    v_lot.farm_id,v_lot.id,'pinching',
    case when p_pinch_required then 'required' else 'not_required' end,
    p_pinch_required,
    case when p_pinch_required then 'due' else 'not_required' end,
    null,jsonb_build_object('harvest_rule_id',v_rule.id)
  )
  on conflict(production_lot_id,care_kind) do update set
    policy_status=excluded.policy_status,
    required_before_harvest=excluded.required_before_harvest,
    current_status=case
      when excluded.policy_status='not_required' then 'not_required'
      when atlas.production_care_policies.current_status='satisfied' then 'satisfied'
      else 'due'
    end,
    metadata=atlas.production_care_policies.metadata||excluded.metadata,
    updated_at=now();

  update atlas.production_field_care_state
  set pinch_status=case
        when p_pinch_required
        then case when pinch_status='done' then 'done' else 'due' end
        else 'not_required'
      end,
      updated_at=now()
  where production_lot_id=v_lot.id
    and establishment_status<>'failed';

  insert into atlas.production_lot_events(
    farm_id,production_lot_id,event_type,event_date,
    task_id,note,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,v_lot.id,'harvest_rules_set',v_today,
    null,p_note,'production_stage_engine',left(v_key||':event',160),
    jsonb_build_object(
      'pinch_required',p_pinch_required,
      'harvest_watch_start',p_harvest_watch_start,
      'harvest_watch_end',p_harvest_watch_end,
      'confidence',p_confidence
    )
  );

  select t.* into v_task
  from atlas.production_lot_tasks plt
  join atlas.tasks t on t.id=plt.task_id
  where plt.production_lot_id=v_lot.id
    and plt.link_role='establishment_check'
  order by t.created_at desc
  limit 1;

  if p_pinch_required and exists(
    select 1 from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and pinch_status='due'
  ) then
    select t.id into v_pinch_task
    from atlas.production_lot_tasks plt
    join atlas.tasks t on t.id=plt.task_id
    where plt.production_lot_id=v_lot.id
      and plt.link_role='pinch_care'
      and t.status in ('open','blocked')
    limit 1;

    if v_pinch_task is null then
      insert into atlas.tasks(
        farm_id,title,task_type,status,priority,due_date,
        generated_from,generated_from_id,note,metadata,
        action_key,work_class,task_series_key,engine_instance_key,
        visibility_scope,assigned_membership_id
      ) values(
        v_lot.farm_id,
        'Pinch field cohort — '||v_lot.lot_label,
        'production_field_care','open','high',
        greatest(
          v_today,
          coalesce(
            (select min(planted_date)+14
             from atlas.production_transplant_placements
             where production_lot_id=v_lot.id),
            v_today
          )
        ),
        'production_harvest_rules',v_rule.id,
        'Pinch every linked bed, then confirm completion for this production cohort.',
        jsonb_build_object(
          'task_key','production_field_pinch_'||v_rule.id::text,
          'task_style','production_field_care',
          'production_lot_id',v_lot.id,
          'production_lot_key',v_lot.stable_key,
          'care_action','pinch',
          'display_action','Pinch',
          'display_subject',v_lot.lot_label,
          'display_detail','All living field beds',
          'collection_zone','Production beds'
        ),
        'production_pinch','standard',
        'production-lot:'||v_lot.stable_key||':pinch',
        'production-field-pinch:'||v_rule.id::text,
        coalesce(v_task.visibility_scope,'assigned_worker'),
        v_task.assigned_membership_id
      ) returning id into v_pinch_task;

      insert into atlas.production_lot_tasks(
        production_lot_id,task_id,link_role,source,metadata
      ) values(
        v_lot.id,v_pinch_task,'pinch_care','production_stage_engine',
        jsonb_build_object('harvest_rule_id',v_rule.id)
      );

      insert into atlas.task_objects(task_id,object_id,role)
      select v_pinch_task,object_id,'target'
      from atlas.production_field_care_state
      where production_lot_id=v_lot.id
        and establishment_status<>'failed'
        and pinch_status='due'
      on conflict do nothing;

      insert into atlas.task_crop_cycles(
        task_id,crop_cycle_id,role,confidence,source,metadata
      )
      select
        v_pinch_task,crop_cycle_id,'affects','confirmed',
        'production_stage_engine',jsonb_build_object('harvest_rule_id',v_rule.id)
      from atlas.production_field_care_state
      where production_lot_id=v_lot.id
        and establishment_status<>'failed'
        and pinch_status='due'
      on conflict do nothing;
    end if;
  end if;

  v_gate:=atlas.refresh_production_harvest_gate_v1(v_lot.id);

  return jsonb_build_object(
    'productionLotId',v_lot.id,
    'harvestRuleId',v_rule.id,
    'pinchRequired',p_pinch_required,
    'harvestWatchStart',p_harvest_watch_start,
    'harvestWatchEnd',p_harvest_watch_end,
    'pinchTaskId',v_pinch_task,
    'harvestGate',v_gate,
    'deduplicated',false
  );
end; $$;