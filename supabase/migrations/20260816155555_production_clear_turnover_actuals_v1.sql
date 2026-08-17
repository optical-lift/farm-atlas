create or replace function atlas.ensure_production_clear_path_v1(p_production_lot_id uuid,p_source_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_lot atlas.production_lots%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_event atlas.production_lot_events%rowtype;
  v_source_task atlas.tasks%rowtype;
  v_existing_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_due date;
  v_offset integer;
  v_role text;
begin
  select * into v_lot from atlas.production_lots where id=p_production_lot_id;
  if v_lot.id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_lot.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select * into v_event from atlas.production_lot_events where id=p_source_event_id and production_lot_id=v_lot.id;
  if v_event.id is null or v_event.event_type<>'harvest_recorded' or coalesce(v_event.metadata->>'harvest_action','')<>'complete' then
    return jsonb_build_object('state','not_applicable','productionLotId',v_lot.id,'reason','Clear path is created only after a counted complete harvest event.');
  end if;

  select t.* into v_existing_task from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id where plt.production_lot_id=v_lot.id and plt.link_role in ('clear','termination_decision') and t.status in ('open','blocked') order by t.created_at desc limit 1;
  if v_existing_task.id is not null then return jsonb_build_object('state','existing','productionLotId',v_lot.id,'taskId',v_existing_task.id,'taskType',v_existing_task.task_type); end if;

  select * into v_profile from atlas.crop_profiles where id=v_lot.crop_profile_id;
  select * into v_source_task from atlas.tasks where id=v_event.task_id;
  v_offset:=v_profile.clear_offset_days;

  if v_offset is null then
    insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,work_lane,commitment_kind)
    values(v_lot.farm_id,'Set termination + clear timing — '||v_lot.lot_label,'production_termination_decision','open','high',v_event.event_date,'production_lot_event',v_event.id,
      'A complete harvest was recorded, but this crop profile has no confirmed clear-offset rule. Set the termination/clear timing so the field cohort cannot disappear after harvest.',
      jsonb_build_object('management_task',true,'owner_task',false,'production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'source_harvest_event_id',v_event.id,'display_action','Set clear timing','display_subject',v_lot.lot_label,'collection_zone','Farm Operations'),
      'decide','light','production-lot:'||v_lot.stable_key||':termination-decision','production-termination-decision:'||v_lot.id::text,'management','process_continuation','floating') returning id into v_task_id;
    v_role:='termination_decision';
  else
    v_due:=v_event.event_date+v_offset;
    insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id,work_lane,commitment_kind,operation_class,operation_class_source)
    values(v_lot.farm_id,'Clear finished production cohort — '||v_lot.lot_label,'production_clear','open','high',v_due,'production_lot_event',v_event.id,
      'Clear the finished field cohort and record the actual release of occupied beds. Turnover remains a separate next state.',
      jsonb_build_object('production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'source_harvest_event_id',v_event.id,'clear_offset_days',v_offset,'display_action','Clear','display_subject',v_lot.lot_label,'collection_zone','Production beds'),
      'clear','heavy','production-lot:'||v_lot.stable_key||':clear','production-clear:'||v_lot.id::text,
      coalesce(v_source_task.visibility_scope,'farm_shared'),v_source_task.assigned_membership_id,'process_continuation','floating','remove_uproot','production_actual_reforecast_v1') returning id into v_task_id;
    insert into atlas.task_objects(task_id,object_id,role) select v_task_id,object_id,'clear_source' from atlas.production_field_stands where production_lot_id=v_lot.id and stand_status<>'cleared' on conflict do nothing;
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata) select v_task_id,crop_cycle_id,'terminates','confirmed','production_actual_reforecast_v1','{}'::jsonb from atlas.production_field_stands where production_lot_id=v_lot.id and stand_status<>'cleared' on conflict do nothing;
    v_role:='clear';
  end if;

  insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata) values(v_lot.id,v_task_id,v_role,'production_actual_reforecast_v1',jsonb_build_object('source_event_id',v_event.id));
  return jsonb_build_object('state','created','productionLotId',v_lot.id,'taskId',v_task_id,'linkRole',v_role,'dueDate',v_due,'clearOffsetDays',v_offset);
end;
$function$;

create or replace function atlas.record_production_clear_v1(p_task_id uuid,p_clear_date date,p_note text,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_event_id uuid;
  v_turnover_task uuid;
  v_transition jsonb;
  v_cleared_stands integer:=0;
begin
  if p_task_id is null or p_clear_date is null or v_key is null then raise exception 'Task, clear date, and idempotency key are required' using errcode='22023'; end if;
  if p_clear_date>(now() at time zone 'America/Chicago')::date+1 then raise exception 'Clear date cannot be in the future' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  select pl.* into v_lot from atlas.production_lot_tasks plt join atlas.production_lots pl on pl.id=plt.production_lot_id where plt.task_id=p_task_id and plt.link_role='clear' limit 1 for update of pl;
  if v_task.id is null or v_lot.id is null then raise exception 'Task is not a linked production clear step' using errcode='22023'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_lot.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select id into v_event_id from atlas.production_lot_events where farm_id=v_lot.farm_id and idempotency_key=left(v_key||':event:cleared',160);
  if v_event_id is not null then return jsonb_build_object('eventId',v_event_id,'productionLotId',v_lot.id,'deduplicated',true); end if;
  if v_task.status not in ('open','blocked') then raise exception 'Clear task is not open' using errcode='22023'; end if;

  update atlas.production_field_stands set stand_status='cleared',current_plants=0,total_losses=plants_transplanted,last_observed_date=p_clear_date,metadata=metadata||jsonb_build_object('cleared_date',p_clear_date,'clear_task_id',v_task.id),updated_at=now() where production_lot_id=v_lot.id and stand_status<>'cleared';
  get diagnostics v_cleared_stands=row_count;
  update atlas.crop_cycles set cycle_state='cleared',lifecycle_status='complete',cleared_date=p_clear_date,coverage_kind='plants_alive',coverage_amount=0,coverage_unit='plants',metadata=metadata||jsonb_build_object('production_clear_task_id',v_task.id),updated_at=now() where id in (select crop_cycle_id from atlas.production_field_stands where production_lot_id=v_lot.id);
  update atlas.production_bed_assignments set assignment_status='released',expected_release_date=greatest(coalesce(expected_release_date,p_clear_date),p_clear_date),metadata=metadata||jsonb_build_object('actual_release_date',p_clear_date,'clear_task_id',v_task.id),updated_at=now() where production_lot_id=v_lot.id and assignment_status='assigned';
  update atlas.production_capacity_reservations r set reservation_status='released',metadata=metadata||jsonb_build_object('released_reason','production_cohort_cleared','released_date',p_clear_date,'clear_task_id',v_task.id),updated_at=now() where r.production_lot_id=v_lot.id and r.reservation_status in ('tentative','confirmed') and exists(select 1 from atlas.capacity_pools cp where cp.id=r.capacity_pool_id and cp.capacity_kind='bed_feet');
  update atlas.production_lots set current_quantity=0,current_unit='plants',current_stage='turnover',lifecycle_status='active',metadata=metadata||jsonb_build_object('last_biological_event','cleared','actual_clear_date',p_clear_date),updated_at=now() where id=v_lot.id;

  insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,note,source,idempotency_key,metadata)
  values(v_lot.farm_id,v_lot.id,'cleared',p_clear_date,0,'plants_alive',v_task.id,p_note,'production_stage_engine',left(v_key||':event:cleared',160),jsonb_build_object('cleared_stand_count',v_cleared_stands)) returning id into v_event_id;
  v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done',left(v_key||':task:done',160),null,coalesce(nullif(btrim(coalesce(p_note,'')),''),'Production cohort cleared.'),null,'clear','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'production_lot_event_id',v_event_id,'cleared_stand_count',v_cleared_stands),null);

  insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id,work_lane,commitment_kind,operation_class,operation_class_source)
  values(v_lot.farm_id,'Turn over cleared production beds — '||v_lot.lot_label,'production_turnover','open','medium',p_clear_date,'production_lot_event',v_event_id,
    'Complete the post-clear turnover state for the beds released by this production lot. This closes the lot lifecycle; the next occupancy remains separate production truth.',
    jsonb_build_object('production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'source_clear_event_id',v_event_id,'display_action','Turn over','display_subject',v_lot.lot_label,'collection_zone','Production beds'),
    'prepare','heavy','production-lot:'||v_lot.stable_key||':turnover','production-turnover:'||v_lot.id::text,
    v_task.visibility_scope,v_task.assigned_membership_id,'process_continuation','floating','cultivate_prepare','production_actual_reforecast_v1') returning id into v_turnover_task;
  insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata) values(v_lot.id,v_turnover_task,'turnover','production_actual_reforecast_v1',jsonb_build_object('source_clear_event_id',v_event_id));
  insert into atlas.task_objects(task_id,object_id,role) select v_turnover_task,object_id,'turnover_target' from atlas.production_field_stands where production_lot_id=v_lot.id on conflict do nothing;

  return jsonb_build_object('contractVersion','record_production_clear_v1','productionLotId',v_lot.id,'eventId',v_event_id,'clearedStandCount',v_cleared_stands,'turnoverTaskId',v_turnover_task,'deduplicated',false);
end;
$function$;

create or replace function atlas.record_production_turnover_v1(p_task_id uuid,p_turnover_date date,p_note text,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_event_id uuid;
  v_transition jsonb;
begin
  if p_task_id is null or p_turnover_date is null or v_key is null then raise exception 'Task, turnover date, and idempotency key are required' using errcode='22023'; end if;
  if p_turnover_date>(now() at time zone 'America/Chicago')::date+1 then raise exception 'Turnover date cannot be in the future' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  select pl.* into v_lot from atlas.production_lot_tasks plt join atlas.production_lots pl on pl.id=plt.production_lot_id where plt.task_id=p_task_id and plt.link_role='turnover' limit 1 for update of pl;
  if v_task.id is null or v_lot.id is null then raise exception 'Task is not a linked production turnover step' using errcode='22023'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_lot.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select id into v_event_id from atlas.production_lot_events where farm_id=v_lot.farm_id and idempotency_key=left(v_key||':event:turnover',160);
  if v_event_id is not null then return jsonb_build_object('eventId',v_event_id,'productionLotId',v_lot.id,'deduplicated',true); end if;
  if v_task.status not in ('open','blocked') or v_lot.current_stage<>'turnover' then raise exception 'Production lot is not waiting for turnover' using errcode='22023'; end if;

  insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,note,source,idempotency_key,metadata)
  values(v_lot.farm_id,v_lot.id,'turnover_completed',p_turnover_date,null,null,v_task.id,p_note,'production_stage_engine',left(v_key||':event:turnover',160),'{}'::jsonb) returning id into v_event_id;
  update atlas.production_lots set current_stage='complete',lifecycle_status='completed',metadata=metadata||jsonb_build_object('last_biological_event','turnover_completed','actual_turnover_date',p_turnover_date),updated_at=now() where id=v_lot.id;
  v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done',left(v_key||':task:done',160),null,coalesce(nullif(btrim(coalesce(p_note,'')),''),'Production bed turnover completed.'),null,'prepare','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'production_lot_event_id',v_event_id),null);
  return jsonb_build_object('contractVersion','record_production_turnover_v1','productionLotId',v_lot.id,'eventId',v_event_id,'lifecycleStatus','completed','deduplicated',false);
end;
$function$;

create or replace function atlas.reforecast_from_production_lot_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.event_type in (
    'sown','germinated','germination_failed','transplanted','established','establishment_failed',
    'harvest_readiness_confirmed','harvest_not_ready','harvest_recorded','cleared','turnover_completed','labor_actual',
    'water_care_completed','weed_care_completed','pinch_care_completed','support_care_completed','fertility_care_completed'
  ) then
    perform atlas.apply_production_lot_reforecast_v1(new.production_lot_id,new.id);
  end if;
  if new.event_type='harvest_recorded' and coalesce(new.metadata->>'harvest_action','')='complete' then
    perform atlas.ensure_production_clear_path_v1(new.production_lot_id,new.id);
  end if;
  return new;
end;
$function$;

revoke all on function atlas.ensure_production_clear_path_v1(uuid,uuid) from public;
revoke all on function atlas.record_production_clear_v1(uuid,date,text,text) from public;
revoke all on function atlas.record_production_turnover_v1(uuid,date,text,text) from public;
grant execute on function atlas.ensure_production_clear_path_v1(uuid,uuid) to authenticated,service_role;
grant execute on function atlas.record_production_clear_v1(uuid,date,text,text) to authenticated,service_role;
grant execute on function atlas.record_production_turnover_v1(uuid,date,text,text) to authenticated,service_role;