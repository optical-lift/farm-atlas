create or replace function atlas.record_production_germination_v1(
  p_task_id uuid,
  p_action text,
  p_observed_seedlings numeric,
  p_observed_date date,
  p_note text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_task atlas.tasks%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_batch atlas.production_tray_batches%rowtype;
  v_existing atlas.production_stage_observations%rowtype;
  v_next_task_id uuid;
  v_observation_id uuid;
  v_transition jsonb;
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_next_date date;
begin
  if p_task_id is null or p_action not in ('not_yet','germinated','failed') or p_observed_date is null then
    raise exception 'Task, valid germination action, and observation date are required' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>120 then raise exception 'A valid germination idempotency key is required' using errcode='22023'; end if;
  if p_observed_date>v_today+1 then raise exception 'Observation date cannot be in the future' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Germination task was not found' using errcode='P0002'; end if;
  select pl.* into v_lot
  from atlas.production_lot_tasks plt join atlas.production_lots pl on pl.id=plt.production_lot_id
  where plt.task_id=p_task_id and plt.link_role='germination_check' limit 1 for update of pl;
  if v_lot.id is null then raise exception 'Task is not linked to a production germination check' using errcode='22023'; end if;
  select * into v_batch from atlas.production_tray_batches where id=v_task.generated_from_id and production_lot_id=v_lot.id for update;
  if v_batch.id is null then raise exception 'Germination task is missing its tray batch' using errcode='22023'; end if;

  select * into v_existing from atlas.production_stage_observations where farm_id=v_lot.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'observationId',v_existing.id,'action',v_existing.observation_outcome,'deduplicated',true);
  end if;
  if v_task.status not in ('open','blocked') then raise exception 'Germination task is not open' using errcode='22023'; end if;
  if p_action='germinated' and (p_observed_seedlings is null or p_observed_seedlings<=0) then raise exception 'Counted seedlings are required when germination is confirmed' using errcode='22023'; end if;
  if p_action='failed' and coalesce(p_observed_seedlings,0)<>0 then raise exception 'Failed germination must record zero seedlings' using errcode='22023'; end if;
  if p_observed_seedlings is not null and p_observed_seedlings>v_batch.seeds_sown then raise exception 'Observed seedlings cannot exceed seeds sown' using errcode='22023'; end if;

  insert into atlas.production_stage_observations(
    farm_id,production_lot_id,tray_batch_id,task_id,stage_key,observation_outcome,observed_date,observed_quantity,unit,confidence,note,idempotency_key,metadata
  ) values(
    v_lot.farm_id,v_lot.id,v_batch.id,p_task_id,'germination',p_action,p_observed_date,p_observed_seedlings,
    case when p_observed_seedlings is null then null else 'seedlings' end,
    case when p_observed_seedlings is null then 'observed' else 'counted' end,p_note,v_key,
    jsonb_build_object('crop_cycle_id',v_batch.crop_cycle_id,'seeds_sown',v_batch.seeds_sown,'tray_count',v_batch.tray_count)
  ) returning id into v_observation_id;

  if p_action='not_yet' then
    v_next_date:=greatest(coalesce(v_task.due_date,p_observed_date),p_observed_date)+1;
    v_transition:=atlas.record_task_transition_v1_internal(
      p_task_id,'rescheduled',left(v_key||':task:not-yet',160),v_next_date,
      coalesce(nullif(btrim(p_note),''),'No germination visible yet.'),'Not germinated yet.','observe','production_lot',
      jsonb_build_object('production_lot_id',v_lot.id,'tray_batch_id',v_batch.id,'observation_id',v_observation_id,'germination_action','not_yet'),null
    );
    insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,note,source,idempotency_key,metadata)
    values(v_lot.farm_id,v_lot.id,'germination_not_yet',p_observed_date,null,null,p_task_id,v_batch.crop_cycle_id,p_note,'production_stage_engine',left(v_key||':event:not-yet',160),jsonb_build_object('tray_batch_id',v_batch.id,'observation_id',v_observation_id,'next_check_date',v_next_date));
    return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'observationId',v_observation_id,'action','not_yet','nextDate',v_next_date,'deduplicated',false);
  end if;

  if p_action='germinated' then
    update atlas.production_tray_batches set status='germinated',germinated_date=p_observed_date,viable_seedlings=p_observed_seedlings,current_quantity=p_observed_seedlings,current_unit='seedlings',metadata=metadata||jsonb_build_object('last_observation_id',v_observation_id),updated_at=now() where id=v_batch.id;
    update atlas.production_lots set current_quantity=p_observed_seedlings,current_unit='seedlings',current_stage='seedling_care',lifecycle_status='active',metadata=metadata||jsonb_build_object('last_biological_event','germinated','last_stage_observation_id',v_observation_id),updated_at=now() where id=v_lot.id;
    update atlas.crop_cycles set cycle_state='germinated',germination_checked_date=p_observed_date,coverage_kind='viable_seedlings',coverage_amount=p_observed_seedlings,coverage_unit='seedlings',metadata=metadata||jsonb_build_object('production_stage_observation_id',v_observation_id),updated_at=now() where id=v_batch.crop_cycle_id;
    insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,note,source,idempotency_key,metadata)
    values(v_lot.farm_id,v_lot.id,'germinated',p_observed_date,p_observed_seedlings,'seedlings',p_task_id,v_batch.crop_cycle_id,p_note,'production_stage_engine',left(v_key||':event:germinated',160),jsonb_build_object('tray_batch_id',v_batch.id,'observation_id',v_observation_id,'seeds_sown',v_batch.seeds_sown));
    v_transition:=atlas.record_task_transition_v1_internal(
      p_task_id,'done',left(v_key||':task:done',160),null,
      coalesce(nullif(btrim(p_note),''),p_observed_seedlings::text||' seedlings germinated.'),null,
      'observe','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'observation_id',v_observation_id,'observed_seedlings',p_observed_seedlings),null
    );
    insert into atlas.tasks(
      farm_id,zone_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id
    ) values(
      v_lot.farm_id,v_task.zone_id,'Move under lights + begin seedling care — '||v_lot.lot_label,'seedling_care','open','high',p_observed_date,
      'production_tray_batch',v_batch.id,'Move this exact tray batch under its reserved lights and begin counted seedling care.',
      jsonb_build_object('task_key','production_seedling_care_'||v_batch.id::text,'task_style','production_seedling_care','production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'production_tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'viable_seedlings',p_observed_seedlings,'tray_count',v_batch.tray_count,'display_action','Move + care','display_subject',v_lot.lot_label,'display_detail',p_observed_seedlings::text||' seedlings · '||v_batch.tray_count::text||' trays','collection_zone','Grow Room','assigned_to',v_task.metadata->>'assigned_to'),
      'grow_room','standard','production-lot:'||v_lot.stable_key||':seedling-care','production-seedling-care:'||v_batch.id::text,
      v_task.visibility_scope,v_task.assigned_membership_id
    ) returning id into v_next_task_id;
    insert into atlas.task_objects(task_id,object_id,role) select v_next_task_id,object_id,'primary_location' from atlas.task_objects where task_id=p_task_id order by created_at limit 1;
    insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata)
    values(v_lot.id,v_next_task_id,'seedling_care','production_stage_engine',jsonb_build_object('tray_batch_id',v_batch.id,'observation_id',v_observation_id));
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
    values(v_next_task_id,v_batch.crop_cycle_id,'affects','confirmed','production_stage_engine',jsonb_build_object('tray_batch_id',v_batch.id)) on conflict do nothing;
    return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'observationId',v_observation_id,'action','germinated','observedSeedlings',p_observed_seedlings,'nextTaskId',v_next_task_id,'deduplicated',false);
  end if;

  update atlas.production_tray_batches set status='failed',germinated_date=p_observed_date,viable_seedlings=0,current_quantity=0,current_unit='seedlings',metadata=metadata||jsonb_build_object('last_observation_id',v_observation_id),updated_at=now() where id=v_batch.id;
  update atlas.production_lots set current_quantity=0,current_unit='seedlings',current_stage='reseed_decision',lifecycle_status='active',metadata=metadata||jsonb_build_object('last_biological_event','germination_failed','last_stage_observation_id',v_observation_id),updated_at=now() where id=v_lot.id;
  update atlas.crop_cycles set cycle_state='failed',lifecycle_status='archived',germination_checked_date=p_observed_date,coverage_kind='viable_seedlings',coverage_amount=0,coverage_unit='seedlings',metadata=metadata||jsonb_build_object('production_stage_observation_id',v_observation_id),updated_at=now() where id=v_batch.crop_cycle_id;
  insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,note,source,idempotency_key,metadata)
  values(v_lot.farm_id,v_lot.id,'germination_failed',p_observed_date,0,'seedlings',p_task_id,v_batch.crop_cycle_id,p_note,'production_stage_engine',left(v_key||':event:failed',160),jsonb_build_object('tray_batch_id',v_batch.id,'observation_id',v_observation_id,'seeds_sown',v_batch.seeds_sown));
  v_transition:=atlas.record_task_transition_v1_internal(
    p_task_id,'done',left(v_key||':task:failed',160),null,
    coalesce(nullif(btrim(p_note),''),'No seedlings germinated.'),null,
    'observe','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'observation_id',v_observation_id,'observed_seedlings',0,'germination_action','failed'),null
  );
  insert into atlas.tasks(
    farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id
  ) values(
    v_lot.farm_id,'Owner — Decide whether to reseed '||v_lot.lot_label,'owner_decision','open','high',p_observed_date,
    'production_tray_batch',v_batch.id,'The recorded tray batch produced zero seedlings. Decide whether to reseed, replace, or cancel this production lot.',
    jsonb_build_object('task_key','production_reseed_decision_'||v_batch.id::text,'owner_task',true,'anna_task',false,'production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'production_tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'failed_seed_quantity',v_batch.seeds_sown,'display_action','Decide','display_subject',v_lot.lot_label||' reseed','display_detail','0 of '||v_batch.seeds_sown::text||' seeds germinated','collection_zone','Owner','assigned_to','Owner'),
    'decide','light','production-lot:'||v_lot.stable_key||':reseed-decision','production-reseed-decision:'||v_batch.id::text,'owner',null
  ) returning id into v_next_task_id;
  insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata)
  values(v_lot.id,v_next_task_id,'reseed_decision','production_stage_engine',jsonb_build_object('tray_batch_id',v_batch.id,'observation_id',v_observation_id));
  return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'observationId',v_observation_id,'action','failed','nextTaskId',v_next_task_id,'deduplicated',false);
end; $$;