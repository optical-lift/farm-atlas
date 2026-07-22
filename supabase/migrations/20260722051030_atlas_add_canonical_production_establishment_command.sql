create or replace function atlas.record_production_establishment_v1(
  p_task_id uuid,
  p_stands jsonb,
  p_action text,
  p_observed_date date,
  p_recheck_date date,
  p_note text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_task atlas.tasks%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_gate atlas.production_transplant_gates%rowtype;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_existing uuid;
  v_total numeric:=0;
  v_expected integer:=0;
  v_row record;
  v_stand atlas.production_field_stands%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_loss numeric;
  v_outcome text;
  v_field_log uuid;
  v_transition jsonb;
  v_water_task uuid;
  v_weed_task uuid;
  v_owner_task uuid;
  v_harvest_gate jsonb;
begin
  if p_task_id is null
     or p_stands is null
     or jsonb_typeof(p_stands)<>'array'
     or jsonb_array_length(p_stands)=0
     or p_action not in ('not_yet','established','failed')
     or p_observed_date is null
  then
    raise exception 'Task, stand counts, valid establishment action, and observation date are required' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>120 then
    raise exception 'A valid establishment idempotency key is required' using errcode='22023';
  end if;
  if p_observed_date>v_today+1 then
    raise exception 'Observation date cannot be in the future' using errcode='22023';
  end if;
  if p_action='not_yet' and (p_recheck_date is null or p_recheck_date<=p_observed_date) then
    raise exception 'Not-yet establishment requires a later recheck date' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  select pl.* into v_lot
  from atlas.production_lot_tasks plt
  join atlas.production_lots pl on pl.id=plt.production_lot_id
  where plt.task_id=p_task_id and plt.link_role='establishment_check'
  limit 1
  for update of pl;
  if v_task.id is null or v_lot.id is null then
    raise exception 'Task is not a linked production establishment check' using errcode='22023';
  end if;

  select * into v_gate
  from atlas.production_transplant_gates
  where id=v_task.generated_from_id and production_lot_id=v_lot.id;
  if v_gate.id is null or v_gate.gate_status<>'transplanted' then
    raise exception 'Establishment check requires a completed transplant gate' using errcode='22023';
  end if;

  select id into v_existing
  from atlas.production_lot_events
  where farm_id=v_lot.farm_id
    and idempotency_key=left(v_key||':event:establishment',160);
  if v_existing is not null then
    return jsonb_build_object(
      'taskId',p_task_id,
      'productionLotId',v_lot.id,
      'action',p_action,
      'deduplicated',true
    );
  end if;
  if v_task.status not in ('open','blocked') then
    raise exception 'Establishment task is not open' using errcode='22023';
  end if;

  create temporary table if not exists pg_temp.production_establishment_input(
    placement_id uuid primary key,
    plants_alive numeric not null,
    water_status text not null,
    weed_pressure text not null
  ) on commit drop;
  truncate pg_temp.production_establishment_input;

  insert into pg_temp.production_establishment_input(
    placement_id,plants_alive,water_status,weed_pressure
  )
  select
    (x->>'placementId')::uuid,
    (x->>'plantsAlive')::numeric,
    x->>'waterStatus',
    x->>'weedPressure'
  from jsonb_array_elements(p_stands) x;

  if exists(
    select 1 from pg_temp.production_establishment_input
    where plants_alive<0
       or water_status not in ('adequate','needs_water','unknown')
       or weed_pressure not in ('clear','light','moderate','heavy','unknown')
  ) then
    raise exception 'Each stand needs a valid living count, water status, and weed pressure' using errcode='22023';
  end if;

  select count(*) into v_expected
  from atlas.production_field_stands
  where production_lot_id=v_lot.id and stand_status<>'cleared';
  if (select count(*) from pg_temp.production_establishment_input)<>v_expected then
    raise exception 'Every active field stand requires one establishment count' using errcode='22023';
  end if;
  if exists(
    select 1
    from pg_temp.production_establishment_input i
    left join atlas.production_field_stands s
      on s.transplant_placement_id=i.placement_id
     and s.production_lot_id=v_lot.id
    where s.id is null or i.plants_alive>s.current_plants
  ) then
    raise exception 'Establishment counts must match this lot and cannot exceed the prior living count' using errcode='22023';
  end if;

  select sum(plants_alive) into v_total
  from pg_temp.production_establishment_input;
  if p_action='established' and v_total<=0 then
    raise exception 'Established production requires living plants' using errcode='22023';
  end if;
  if p_action='failed' and v_total<>0 then
    raise exception 'Failed establishment must record zero living plants' using errcode='22023';
  end if;

  insert into atlas.field_logs(
    farm_id,log_date,action_types,summary_sentence,note,
    created_by,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,p_observed_date,
    array['establishment','count','production_lot'],
    'Counted '||v_total::text||' living plants in '||v_lot.lot_label,
    p_note,'production_stage_engine','production_stage_engine',
    left(v_key||':field-log',160),
    jsonb_build_object(
      'production_lot_id',v_lot.id,
      'action',p_action,
      'stands',p_stands
    )
  ) returning id into v_field_log;

  for v_row in select * from pg_temp.production_establishment_input loop
    select * into v_stand
    from atlas.production_field_stands
    where transplant_placement_id=v_row.placement_id
    for update;
    select * into v_object from atlas.growing_objects where id=v_stand.object_id;

    v_loss:=v_stand.current_plants-v_row.plants_alive;
    v_outcome:=case
      when v_row.plants_alive=0 then 'failed'
      when v_loss>0 then 'partial_loss'
      when p_action='established' then 'established'
      else 'not_yet'
    end;

    insert into atlas.production_field_observations(
      farm_id,production_lot_id,task_id,object_id,crop_cycle_id,
      field_stand_id,observation_type,outcome,observed_date,
      quantity,unit,note,idempotency_key,metadata
    ) values(
      v_lot.farm_id,v_lot.id,p_task_id,v_stand.object_id,v_stand.crop_cycle_id,
      v_stand.id,'establishment',v_outcome,p_observed_date,
      v_row.plants_alive,'plants',p_note,
      left(v_key||':stand:'||v_stand.id::text,160),
      jsonb_build_object(
        'transplant_placement_id',v_stand.transplant_placement_id,
        'plants_transplanted',v_stand.plants_transplanted,
        'plants_lost',v_loss,
        'water_status',v_row.water_status,
        'weed_pressure',v_row.weed_pressure,
        'next_check_date',case when p_action='not_yet' then p_recheck_date else null end,
        'confidence','counted'
      )
    );

    update atlas.production_field_stands
    set current_plants=v_row.plants_alive,
        total_losses=plants_transplanted-v_row.plants_alive,
        last_observed_date=p_observed_date,
        stand_status=case
          when v_row.plants_alive=0 then 'failed'
          when p_action='established' then 'established'
          else 'establishing'
        end,
        establishment_status=case
          when v_row.plants_alive=0 then 'failed'
          when p_action='established' and v_loss>0 then 'partial_loss'
          when p_action='established' then 'established'
          else 'not_yet'
        end,
        established_date=case
          when p_action='established' and v_row.plants_alive>0
          then p_observed_date
          else established_date
        end,
        next_observation_date=case when p_action='not_yet' then p_recheck_date else null end,
        metadata=metadata||jsonb_build_object('last_establishment_action',p_action),
        updated_at=now()
    where id=v_stand.id;

    insert into atlas.production_field_care_state(
      farm_id,production_lot_id,object_id,crop_cycle_id,field_stand_id,
      plants_alive,establishment_status,water_status,weed_pressure,
      pinch_status,last_establishment_check,metadata
    ) values(
      v_lot.farm_id,v_lot.id,v_stand.object_id,v_stand.crop_cycle_id,v_stand.id,
      v_row.plants_alive,
      case
        when v_row.plants_alive=0 then 'failed'
        when p_action='established' then 'established'
        else 'establishing'
      end,
      v_row.water_status,v_row.weed_pressure,'unknown',p_observed_date,
      jsonb_build_object('transplant_placement_id',v_stand.transplant_placement_id)
    )
    on conflict(production_lot_id,object_id) do update set
      crop_cycle_id=excluded.crop_cycle_id,
      field_stand_id=excluded.field_stand_id,
      plants_alive=excluded.plants_alive,
      establishment_status=excluded.establishment_status,
      water_status=excluded.water_status,
      weed_pressure=excluded.weed_pressure,
      last_establishment_check=excluded.last_establishment_check,
      metadata=atlas.production_field_care_state.metadata||excluded.metadata,
      updated_at=now();

    update atlas.crop_cycles
    set cycle_state=case
          when v_row.plants_alive=0 then 'failed'
          when p_action='established' then 'growing'
          else 'establishment'
        end,
        lifecycle_status=case when v_row.plants_alive=0 then 'archived' else 'active' end,
        coverage_kind='plants_alive',
        coverage_amount=v_row.plants_alive,
        coverage_unit='plants',
        metadata=metadata||jsonb_build_object(
          'establishment_observed_date',p_observed_date,
          'establishment_action',p_action,
          'establishment_losses',v_stand.plants_transplanted-v_row.plants_alive
        ),
        updated_at=now()
    where id=v_stand.crop_cycle_id;

    insert into atlas.object_activity_events(
      farm_id,object_id,field_log_id,crop_cycle_id,event_type,event_date,
      note,quantity,unit,created_by,source,idempotency_key,metadata
    ) values(
      v_lot.farm_id,v_stand.object_id,v_field_log,v_stand.crop_cycle_id,
      'checked',p_observed_date,p_note,v_row.plants_alive,'plants',
      'production_stage_engine','production_stage_engine',
      left(v_key||':object:'||v_stand.object_id::text,160),
      jsonb_build_object(
        'observation_type','establishment',
        'production_lot_id',v_lot.id,
        'field_stand_id',v_stand.id,
        'water_status',v_row.water_status,
        'weed_pressure',v_row.weed_pressure
      )
    ) on conflict do nothing;

    insert into atlas.field_log_objects(field_log_id,zone_id,object_id,role)
    values(v_field_log,v_object.zone_id,v_object.id,'establishment_check')
    on conflict do nothing;

    insert into atlas.object_state(
      object_id,farm_id,life_status,weed_pressure,water_status,
      last_touched_at,last_checked_at,decision_required,
      harvest_confidence,presentability,metadata
    ) values(
      v_stand.object_id,v_lot.farm_id,
      case
        when v_row.plants_alive=0 then 'failed'
        when p_action='established' then 'growing'
        else 'planted'
      end,
      v_row.weed_pressure,
      case
        when v_row.water_status='adequate' then 'irrigated'
        when v_row.water_status='needs_water' then 'needs_water'
        else 'unknown'
      end,
      p_observed_date,p_observed_date,v_row.plants_alive=0,
      'unknown','unknown',
      jsonb_build_object(
        'production_lot_id',v_lot.id,
        'field_stand_id',v_stand.id,
        'plants_alive',v_row.plants_alive
      )
    )
    on conflict(object_id) do update set
      life_status=excluded.life_status,
      weed_pressure=excluded.weed_pressure,
      water_status=excluded.water_status,
      last_touched_at=excluded.last_touched_at,
      last_checked_at=excluded.last_checked_at,
      decision_required=excluded.decision_required,
      metadata=atlas.object_state.metadata||excluded.metadata,
      updated_at=now();
  end loop;

  update atlas.production_lots
  set current_quantity=v_total,
      current_unit='plants',
      current_stage=case
        when p_action='established' then 'field_care'
        when p_action='failed' then 'field_failure_decision'
        else 'establishment'
      end,
      lifecycle_status=case when p_action='failed' then 'failed' else 'active' end,
      metadata=metadata||jsonb_build_object(
        'last_biological_event',case
          when p_action='established' then 'established'
          when p_action='failed' then 'establishment_failed'
          else 'establishment_not_yet'
        end,
        'establishment_observed_date',p_observed_date,
        'living_plants',v_total
      ),
      updated_at=now()
  where id=v_lot.id;

  insert into atlas.production_lot_events(
    farm_id,production_lot_id,event_type,event_date,quantity,unit,
    task_id,note,source,idempotency_key,metadata
  ) values(
    v_lot.farm_id,v_lot.id,
    case
      when p_action='established' then 'established'
      when p_action='failed' then 'establishment_failed'
      else 'establishment_not_yet'
    end,
    p_observed_date,v_total,'plants',p_task_id,p_note,
    'production_stage_engine',left(v_key||':event:establishment',160),
    jsonb_build_object(
      'transplant_gate_id',v_gate.id,
      'stand_counts',p_stands,
      'field_log_id',v_field_log
    )
  );

  perform atlas.sync_production_care_policies_v1(v_lot.id);

  if p_action='not_yet' then
    v_transition:=atlas.record_task_transition_v1_internal(
      p_task_id,'rescheduled',left(v_key||':task:not-yet',160),
      p_recheck_date,
      coalesce(nullif(btrim(p_note),''),'Transplants are not fully established yet.'),
      'Establishment not complete.','observe','production_lot',
      jsonb_build_object(
        'production_lot_id',v_lot.id,
        'living_plants',v_total,
        'next_check_date',p_recheck_date,
        'stand_counts',p_stands
      ),
      v_field_log
    );
  else
    v_transition:=atlas.record_task_transition_v1_internal(
      p_task_id,'done',left(v_key||':task:done',160),null,
      coalesce(
        nullif(btrim(p_note),''),
        case when p_action='failed'
          then 'No transplanted plants established.'
          else v_total::text||' plants established.'
        end
      ),
      null,'observe','production_lot',
      jsonb_build_object(
        'production_lot_id',v_lot.id,
        'establishment_action',p_action,
        'living_plants',v_total,
        'stand_counts',p_stands
      ),
      v_field_log
    );
  end if;

  if exists(
    select 1 from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and water_status='needs_water'
  ) then
    insert into atlas.tasks(
      farm_id,title,task_type,status,priority,due_date,
      generated_from,generated_from_id,note,metadata,
      action_key,work_class,task_series_key,engine_instance_key,
      visibility_scope,assigned_membership_id
    ) values(
      v_lot.farm_id,
      'Water establishment cohort — '||v_lot.lot_label,
      'production_field_care','open','high',p_observed_date,
      'production_establishment',p_task_id,
      'Water every linked bed marked needs-water, then confirm completion for the cohort.',
      jsonb_build_object(
        'task_key','production_field_water_'||p_task_id::text,
        'task_style','production_field_care',
        'production_lot_id',v_lot.id,
        'production_lot_key',v_lot.stable_key,
        'care_action','water',
        'display_action','Water',
        'display_subject',v_lot.lot_label,
        'display_detail','Establishment cohort',
        'collection_zone','Production beds'
      ),
      'production_water','standard',
      'production-lot:'||v_lot.stable_key||':water',
      'production-field-water:'||p_task_id::text,
      v_task.visibility_scope,v_task.assigned_membership_id
    ) returning id into v_water_task;

    insert into atlas.production_lot_tasks(
      production_lot_id,task_id,link_role,source,metadata
    ) values(v_lot.id,v_water_task,'water_care','production_stage_engine','{}'::jsonb);

    insert into atlas.task_objects(task_id,object_id,role)
    select v_water_task,object_id,'target'
    from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and water_status='needs_water'
    on conflict do nothing;

    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
    select v_water_task,crop_cycle_id,'affects','confirmed','production_stage_engine','{}'::jsonb
    from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and water_status='needs_water'
    on conflict do nothing;
  end if;

  if exists(
    select 1 from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and weed_pressure in ('moderate','heavy')
  ) then
    insert into atlas.tasks(
      farm_id,title,task_type,status,priority,due_date,
      generated_from,generated_from_id,note,metadata,
      action_key,work_class,task_series_key,engine_instance_key,
      visibility_scope,assigned_membership_id
    ) values(
      v_lot.farm_id,
      'Weed establishment cohort — '||v_lot.lot_label,
      'production_field_care','open','high',p_observed_date,
      'production_establishment',p_task_id,
      'Weed every linked bed carrying moderate or heavy pressure, then confirm completion for the cohort.',
      jsonb_build_object(
        'task_key','production_field_weed_'||p_task_id::text,
        'task_style','production_field_care',
        'production_lot_id',v_lot.id,
        'production_lot_key',v_lot.stable_key,
        'care_action','weed',
        'display_action','Weed',
        'display_subject',v_lot.lot_label,
        'display_detail','Establishment cohort',
        'collection_zone','Production beds'
      ),
      'production_weed','standard',
      'production-lot:'||v_lot.stable_key||':weed',
      'production-field-weed:'||p_task_id::text,
      v_task.visibility_scope,v_task.assigned_membership_id
    ) returning id into v_weed_task;

    insert into atlas.production_lot_tasks(
      production_lot_id,task_id,link_role,source,metadata
    ) values(v_lot.id,v_weed_task,'weed_care','production_stage_engine','{}'::jsonb);

    insert into atlas.task_objects(task_id,object_id,role)
    select v_weed_task,object_id,'target'
    from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and weed_pressure in ('moderate','heavy')
    on conflict do nothing;

    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
    select v_weed_task,crop_cycle_id,'affects','confirmed','production_stage_engine','{}'::jsonb
    from atlas.production_field_care_state
    where production_lot_id=v_lot.id
      and establishment_status<>'failed'
      and weed_pressure in ('moderate','heavy')
    on conflict do nothing;
  end if;

  if p_action='failed' then
    insert into atlas.tasks(
      farm_id,title,task_type,status,priority,due_date,
      generated_from,generated_from_id,note,metadata,
      action_key,work_class,task_series_key,engine_instance_key,visibility_scope
    ) values(
      v_lot.farm_id,
      'Owner — Decide field failure recovery — '||v_lot.lot_label,
      'owner_decision','open','high',p_observed_date,
      'production_establishment',p_task_id,
      'No transplanted plants survived establishment. Decide whether to replant, replace, or cancel the crop cohort.',
      jsonb_build_object(
        'task_key','production_field_failure_'||v_lot.id::text,
        'owner_task',true,'anna_task',false,
        'production_lot_id',v_lot.id,
        'production_lot_key',v_lot.stable_key,
        'display_action','Decide',
        'display_subject',v_lot.lot_label||' field recovery',
        'display_detail','0 established plants',
        'collection_zone','Owner'
      ),
      'decide','light',
      'production-lot:'||v_lot.stable_key||':field-failure',
      'production-field-failure:'||v_lot.id::text,
      'owner'
    ) returning id into v_owner_task;

    insert into atlas.production_lot_tasks(
      production_lot_id,task_id,link_role,source,metadata
    ) values(v_lot.id,v_owner_task,'field_failure_decision','production_stage_engine','{}'::jsonb);
  end if;

  v_harvest_gate:=atlas.refresh_production_harvest_gate_v1(v_lot.id);

  return jsonb_build_object(
    'taskId',p_task_id,
    'productionLotId',v_lot.id,
    'action',p_action,
    'livingPlants',v_total,
    'fieldLogId',v_field_log,
    'waterTaskId',v_water_task,
    'weedTaskId',v_weed_task,
    'ownerDecisionTaskId',v_owner_task,
    'harvestGate',v_harvest_gate,
    'deduplicated',false
  );
end; $$;