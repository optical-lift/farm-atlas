create or replace function atlas.record_production_seedling_care_v1(
  p_task_id uuid,p_surviving_seedlings numeric,p_tray_count numeric,p_care_date date,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_task atlas.tasks%rowtype; v_lot atlas.production_lots%rowtype; v_batch atlas.production_tray_batches%rowtype;
  v_existing uuid; v_readiness_task_id uuid; v_transition jsonb; v_due date; v_key text:=nullif(btrim(p_idempotency_key),'');
begin
  if p_task_id is null or p_surviving_seedlings is null or p_surviving_seedlings<=0 or p_tray_count is null or p_tray_count<=0 or p_care_date is null then raise exception 'Task, surviving seedlings, trays, and care date are required' using errcode='22023'; end if;
  if v_key is null or length(v_key)>120 then raise exception 'A valid seedling-care idempotency key is required' using errcode='22023'; end if;
  if p_care_date>v_today+1 then raise exception 'Care date cannot be in the future' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  select pl.* into v_lot from atlas.production_lot_tasks plt join atlas.production_lots pl on pl.id=plt.production_lot_id where plt.task_id=p_task_id and plt.link_role='seedling_care' limit 1 for update of pl;
  if v_task.id is null or v_lot.id is null then raise exception 'Task is not a linked production seedling-care step' using errcode='22023'; end if;
  select * into v_batch from atlas.production_tray_batches where id=v_task.generated_from_id and production_lot_id=v_lot.id for update;
  if v_batch.id is null or v_batch.status not in ('germinated','seedling_care') then raise exception 'Seedling-care task is missing its germinated tray batch' using errcode='22023'; end if;
  select id into v_existing from atlas.production_lot_events where farm_id=v_lot.farm_id and idempotency_key=left(v_key||':event:care',160);
  if v_existing is not null then
    select task_id into v_readiness_task_id from atlas.production_lot_tasks where production_lot_id=v_lot.id and link_role='transplant_readiness' order by created_at desc limit 1;
    return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'readinessTaskId',v_readiness_task_id,'deduplicated',true);
  end if;
  if v_task.status not in ('open','blocked') then raise exception 'Seedling-care task is not open' using errcode='22023'; end if;
  if p_surviving_seedlings>coalesce(v_batch.viable_seedlings,v_batch.seeds_sown) then raise exception 'Surviving seedling count exceeds the tray cohort' using errcode='22023'; end if;
  if p_tray_count>v_batch.tray_count then raise exception 'Current tray count cannot exceed the sown tray count' using errcode='22023'; end if;
  update atlas.production_tray_batches set status='seedling_care',current_quantity=p_surviving_seedlings,current_unit='seedlings',tray_count=p_tray_count,metadata=metadata||jsonb_build_object('seedling_care_started_date',p_care_date),updated_at=now() where id=v_batch.id;
  update atlas.production_lots set current_quantity=p_surviving_seedlings,current_unit='seedlings',current_stage='seedling_care',metadata=metadata||jsonb_build_object('last_biological_event','seedling_care_started'),updated_at=now() where id=v_lot.id;
  update atlas.crop_cycles set cycle_state='seedling_care',coverage_kind='viable_seedlings',coverage_amount=p_surviving_seedlings,coverage_unit='seedlings',metadata=metadata||jsonb_build_object('current_tray_count',p_tray_count),updated_at=now() where id=v_batch.crop_cycle_id;
  insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,note,source,idempotency_key,metadata)
  values(v_lot.farm_id,v_lot.id,'seedling_care_started',p_care_date,p_surviving_seedlings,'seedlings',p_task_id,v_batch.crop_cycle_id,p_note,'production_stage_engine',left(v_key||':event:care',160),jsonb_build_object('tray_batch_id',v_batch.id,'tray_count',p_tray_count));
  v_transition:=atlas.record_task_transition_v1_internal(p_task_id,'done',left(v_key||':task:done',160),null,coalesce(nullif(btrim(p_note),''),'Began seedling care for '||p_surviving_seedlings::text||' seedlings.'),null,'grow_room','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'surviving_seedlings',p_surviving_seedlings,'tray_count',p_tray_count),null);
  v_due:=greatest(coalesce(v_lot.expected_transplant_start,p_care_date),p_care_date);
  insert into atlas.tasks(farm_id,zone_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
  values(v_lot.farm_id,v_task.zone_id,'Confirm transplant readiness — '||v_lot.lot_label,'production_transplant_readiness','open','high',v_due,'production_tray_batch',v_batch.id,'Count surviving seedlings and confirm whether this exact tray cohort is field-ready.',jsonb_build_object('task_key','production_transplant_readiness_'||v_batch.id::text,'task_style','production_transplant_readiness','production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'production_tray_batch_id',v_batch.id,'crop_cycle_id',v_batch.crop_cycle_id,'expected_transplant_start',v_lot.expected_transplant_start,'expected_transplant_end',v_lot.expected_transplant_end,'display_action','Confirm','display_subject',v_lot.lot_label||' transplant readiness','display_detail',p_surviving_seedlings::text||' seedlings · '||p_tray_count::text||' trays','collection_zone','Grow Room','assigned_to',v_task.metadata->>'assigned_to'),'observe','light','production-lot:'||v_lot.stable_key||':transplant-readiness','production-transplant-readiness:'||v_batch.id::text,v_task.visibility_scope,v_task.assigned_membership_id)
  returning id into v_readiness_task_id;
  insert into atlas.task_objects(task_id,object_id,role) select v_readiness_task_id,object_id,'primary_location' from atlas.task_objects where task_id=p_task_id order by created_at limit 1 on conflict do nothing;
  insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata) values(v_lot.id,v_readiness_task_id,'transplant_readiness','production_stage_engine',jsonb_build_object('tray_batch_id',v_batch.id));
  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata) values(v_readiness_task_id,v_batch.crop_cycle_id,'observes','confirmed','production_stage_engine',jsonb_build_object('tray_batch_id',v_batch.id)) on conflict do nothing;
  return jsonb_build_object('taskId',p_task_id,'productionLotId',v_lot.id,'trayBatchId',v_batch.id,'readinessTaskId',v_readiness_task_id,'survivingSeedlings',p_surviving_seedlings,'trayCount',p_tray_count,'deduplicated',false);
end; $$;
