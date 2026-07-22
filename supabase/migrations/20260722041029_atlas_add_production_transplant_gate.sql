create or replace function atlas.refresh_production_transplant_gate_v1(p_production_lot_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_lot atlas.production_lots%rowtype; v_batch atlas.production_tray_batches%rowtype; v_obs atlas.production_readiness_observations%rowtype; v_req atlas.production_capacity_requirements%rowtype;
  v_gate atlas.production_transplant_gates%rowtype; v_task atlas.tasks%rowtype; v_assigned numeric:=0; v_prepared numeric:=0; v_status text; v_blocker text; v_version integer; v_due date; v_transition jsonb; v_assignment record;
begin
  select * into v_lot from atlas.production_lots where id=p_production_lot_id for update;
  if v_lot.id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;
  select * into v_batch from atlas.production_tray_batches where production_lot_id=v_lot.id and status in ('seedling_care','transplant_ready') order by batch_number desc limit 1;
  select * into v_obs from atlas.production_readiness_observations where production_lot_id=v_lot.id and observation_outcome='ready' order by observed_date desc,created_at desc limit 1;
  if v_batch.id is null or v_obs.id is null then return jsonb_build_object('productionLotId',v_lot.id,'gateStatus','waiting_seedlings','changed',false); end if;
  select * into v_req from atlas.production_capacity_requirements where production_lot_id=v_lot.id and capacity_kind='bed_feet' limit 1;
  select coalesce(sum(quantity_assigned),0) into v_assigned from atlas.production_bed_assignments where production_lot_id=v_lot.id and assignment_status='assigned';
  select coalesce(sum(a.quantity_assigned),0) into v_prepared
  from atlas.production_bed_assignments a
  where a.production_lot_id=v_lot.id and a.assignment_status='assigned' and exists(
    select 1 from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id
    where plt.production_lot_id=v_lot.id and plt.link_role='bed_preparation' and t.status='done' and t.metadata->>'production_bed_assignment_id'=a.id::text
  );
  if v_req.id is null or v_req.calculation_status not in ('calculated','confirmed') or v_req.quantity_needed is null then v_status:='waiting_bed_math'; v_blocker:='Bed demand is not calculated from the counted surviving seedlings.';
  elsif v_assigned<v_req.quantity_needed then v_status:='waiting_bed_assignment'; v_blocker:=(v_req.quantity_needed-v_assigned)::text||' additional bed-feet must be assigned.';
  elsif v_prepared<v_req.quantity_needed then v_status:='waiting_bed_preparation'; v_blocker:=(v_req.quantity_needed-v_prepared)::text||' assigned bed-feet still need completed preparation.';
  else v_status:='ready'; v_blocker:=null; end if;
  insert into atlas.production_transplant_gates(farm_id,production_lot_id,tray_batch_id,readiness_observation_id,bed_requirement_id,required_bed_feet,assigned_bed_feet,prepared_bed_feet,gate_status,blocker_text,ready_at,refresh_version,metadata)
  values(v_lot.farm_id,v_lot.id,v_batch.id,v_obs.id,v_req.id,v_req.quantity_needed,v_assigned,v_prepared,v_status,v_blocker,case when v_status='ready' then now() end,1,jsonb_build_object('surviving_seedlings',v_obs.surviving_seedlings))
  on conflict(production_lot_id,tray_batch_id) do update set readiness_observation_id=excluded.readiness_observation_id,bed_requirement_id=excluded.bed_requirement_id,required_bed_feet=excluded.required_bed_feet,assigned_bed_feet=excluded.assigned_bed_feet,prepared_bed_feet=excluded.prepared_bed_feet,gate_status=case when atlas.production_transplant_gates.gate_status='transplanted' then 'transplanted' else excluded.gate_status end,blocker_text=case when atlas.production_transplant_gates.gate_status='transplanted' then null else excluded.blocker_text end,ready_at=case when atlas.production_transplant_gates.gate_status='transplanted' then atlas.production_transplant_gates.ready_at when excluded.gate_status='ready' then coalesce(atlas.production_transplant_gates.ready_at,now()) else null end,refresh_version=atlas.production_transplant_gates.refresh_version+1,metadata=atlas.production_transplant_gates.metadata||excluded.metadata,updated_at=now()
  returning * into v_gate;
  select * into v_task from atlas.tasks where id=v_gate.transplant_task_id;
  v_due:=greatest(coalesce(v_lot.expected_transplant_start,v_obs.observed_date),v_obs.observed_date);
  if v_task.id is null then
    insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,blocker_text,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
    values(v_lot.farm_id,'Transplant — '||v_lot.lot_label,'production_transplant',case when v_status='ready' then 'open' else 'blocked' end,'high',v_due,v_blocker,'production_transplant_gate',v_gate.id,'Record the exact number of surviving plants placed in each assigned bed.',jsonb_build_object('task_key','production_transplant_'||v_gate.id::text,'task_style','production_transplant','production_lot_id',v_lot.id,'production_lot_key',v_lot.stable_key,'production_tray_batch_id',v_batch.id,'production_transplant_gate_id',v_gate.id,'crop_cycle_id',v_batch.crop_cycle_id,'surviving_seedlings',v_obs.surviving_seedlings,'required_bed_feet',v_req.quantity_needed,'display_action','Transplant','display_subject',v_lot.lot_label,'display_detail',coalesce(v_req.quantity_needed::text,'?')||' bed-ft · '||v_obs.surviving_seedlings::text||' seedlings','collection_zone','Assigned beds','relationship_kind','production_transplant'),'transplant','heavy','production-lot:'||v_lot.stable_key||':transplant','production-transplant:'||v_gate.id::text,(select visibility_scope from atlas.tasks where id=v_obs.task_id),(select assigned_membership_id from atlas.tasks where id=v_obs.task_id)) returning * into v_task;
    update atlas.production_transplant_gates set transplant_task_id=v_task.id where id=v_gate.id;
    insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata) values(v_lot.id,v_task.id,'transplant','production_stage_engine',jsonb_build_object('transplant_gate_id',v_gate.id));
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata) values(v_task.id,v_batch.crop_cycle_id,'affects','confirmed','production_stage_engine',jsonb_build_object('transplant_gate_id',v_gate.id)) on conflict do nothing;
  elsif v_status='ready' and v_task.status='blocked' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'rescheduled',left('production-gate-ready:'||v_gate.id::text||':'||v_gate.refresh_version::text,160),v_due,'Assigned beds are prepared and the counted seedlings are ready.',null,'transplant','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'transplant_gate_id',v_gate.id,'gate_status','ready'),null);
  elsif v_status<>'ready' and v_task.status='open' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'blocked',left('production-gate-blocked:'||v_gate.id::text||':'||v_gate.refresh_version::text,160),null,v_blocker,v_blocker,'transplant','production_lot',jsonb_build_object('production_lot_id',v_lot.id,'transplant_gate_id',v_gate.id,'gate_status',v_status),null);
  elsif v_task.status='blocked' then
    update atlas.tasks set blocker_text=v_blocker,metadata=metadata||jsonb_build_object('gate_status',v_status,'gate_refresh_version',v_gate.refresh_version),updated_at=now() where id=v_task.id;
  end if;
  for v_assignment in select * from atlas.production_bed_assignments where production_lot_id=v_lot.id and assignment_status='assigned' loop
    insert into atlas.task_objects(task_id,object_id,role) values(v_task.id,v_assignment.object_id,'target') on conflict do nothing;
  end loop;
  return jsonb_build_object('productionLotId',v_lot.id,'transplantGateId',v_gate.id,'transplantTaskId',v_task.id,'gateStatus',v_status,'requiredBedFeet',v_req.quantity_needed,'assignedBedFeet',v_assigned,'preparedBedFeet',v_prepared,'blocker',v_blocker);
end; $$;
