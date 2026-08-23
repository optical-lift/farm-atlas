alter table atlas.production_bed_assignments drop constraint if exists production_bed_assignments_production_lot_id_object_id_assi_key;
create unique index production_bed_assignments_one_active_object_uidx on atlas.production_bed_assignments(production_lot_id,object_id) where assignment_status='assigned';
alter function atlas.owner_production_capacity_snapshot_v1(uuid) volatile;

create or replace function atlas.owner_answer_capacity_question_v1(p_farm_id uuid,p_question_id uuid,p_answer_value numeric,p_answer_text text default null,p_confidence text default 'measured')
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_question atlas.capacity_questions%rowtype; v_program_id uuid; v_measurement_kind text; v_unit text; v_min numeric; v_max numeric; v_lot_key text; v_lot_id uuid;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  if p_confidence not in ('measured','confirmed','estimated') then raise exception 'Invalid measurement confidence.' using errcode='22023'; end if;
  select q.* into v_question from atlas.capacity_questions q join atlas.production_programs pp on pp.id=q.production_program_id where q.id=p_question_id and q.farm_id=p_farm_id and pp.stable_key='spring_2027_snapdragon_program' for update of q;
  if v_question.id is null then raise exception 'Capacity question was not found.' using errcode='P0002'; end if;
  v_program_id:=v_question.production_program_id;
  if v_question.stable_key='spring_snapdragon_bed_assignments' then raise exception 'Bed assignments use the bed-assignment action.' using errcode='22023'; end if;
  if p_answer_value is null then raise exception 'A numeric answer is required.' using errcode='22023'; end if;
  case v_question.stable_key
    when 'rocket_s1_seed_quantity' then v_unit:='seeds';v_min:=1;v_max:=1000000;v_lot_key:='snapdragon_rocket_spring_2027_s1';
    when 'madame_s2_seed_quantity' then v_unit:='seeds';v_min:=1;v_max:=1000000;v_lot_key:='snapdragon_madame_butterfly_spring_2027_s2';
    when 'snapdragon_seeds_per_three_quarter_block' then v_measurement_kind:='conversion';v_unit:='seeds_per_block';v_min:=0.1;v_max:=100;
    when 'three_quarter_blocks_per_cafeteria_tray' then v_measurement_kind:='conversion';v_unit:='blocks_per_tray';v_min:=1;v_max:=10000;
    when 'cafeteria_trays_per_rack_shelf' then v_measurement_kind:='conversion';v_unit:='trays_per_shelf';v_min:=1;v_max:=100;
    when 'functional_grow_light_sets' then v_measurement_kind:='count';v_unit:='light_sets';v_min:=0;v_max:=1000;
    when 'shelf_positions_per_grow_light_set' then v_measurement_kind:='conversion';v_unit:='shelf_positions_per_light_set';v_min:=0.1;v_max:=100;
    when 'snapdragon_lit_shelf_occupancy_days' then v_measurement_kind:='duration_days';v_unit:='days';v_min:=1;v_max:=365;
    when 'snapdragon_planning_viability_percent' then v_measurement_kind:='percentage';v_unit:='percent';v_min:=1;v_max:=100;
    when 'snapdragon_rows_per_three_foot_bed' then v_measurement_kind:='rows_per_bed';v_unit:='rows';v_min:=1;v_max:=20;
    when 'snapdragon_in_row_spacing_inches' then v_measurement_kind:='spacing_inches';v_unit:='inches';v_min:=0.25;v_max:=48;
    when 'snapdragon_bed_preparation_lead_days' then v_measurement_kind:='lead_days';v_unit:='days';v_min:=1;v_max:=365;
    else raise exception 'Unsupported capacity question.' using errcode='22023';
  end case;
  if p_answer_value<v_min or p_answer_value>v_max then raise exception 'Capacity answer is outside the supported range.' using errcode='22023'; end if;
  if v_lot_key is not null then
    if trunc(p_answer_value)<>p_answer_value then raise exception 'Seed quantity must be a whole number.' using errcode='22023'; end if;
    select id into v_lot_id from atlas.production_lots where farm_id=p_farm_id and program_id=v_program_id and stable_key=v_lot_key for update;
    if v_lot_id is null then raise exception 'Production lot was not found.' using errcode='P0002'; end if;
    update atlas.production_lots set planned_input_quantity=p_answer_value,planned_input_unit='seeds',updated_at=now() where id=v_lot_id;
    update atlas.production_capacity_requirements set quantity_needed=p_answer_value,unit='seeds',calculation_status='confirmed',updated_at=now() where production_lot_id=v_lot_id and capacity_kind='seed';
    insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,stage_to,quantity,unit,note,idempotency_key,metadata)
    values(p_farm_id,v_lot_id,'planned_seed_quantity_confirmed',current_date,'planned',p_answer_value,'seeds',nullif(btrim(coalesce(p_answer_text,'')),''),left('capacity-seed-plan:'||v_question.id::text||':'||p_answer_value::text,160),jsonb_build_object('capacity_question_id',v_question.id,'confidence',p_confidence))
    on conflict(farm_id,idempotency_key) do nothing;
  else
    insert into atlas.capacity_measurements(farm_id,stable_key,label,measurement_kind,value,unit,confidence,note,metadata)
    values(p_farm_id,v_question.stable_key,v_question.question_text,v_measurement_kind,p_answer_value,v_unit,p_confidence,nullif(btrim(coalesce(p_answer_text,'')),''),jsonb_build_object('capacity_question_id',v_question.id,'production_program_id',v_program_id,'recorded_by',auth.uid()))
    on conflict(farm_id,stable_key) do update set value=excluded.value,unit=excluded.unit,confidence=excluded.confidence,note=excluded.note,metadata=atlas.capacity_measurements.metadata||excluded.metadata,updated_at=now();
  end if;
  update atlas.capacity_questions set answer_value=p_answer_value,answer_unit=v_unit,answer_text=nullif(btrim(coalesce(p_answer_text,'')),''),status='answered',answered_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('confidence',p_confidence,'answered_by',auth.uid()),updated_at=now() where id=v_question.id;
  perform atlas.refresh_grow_room_capacity_pools_v1(p_farm_id);
  perform atlas.refresh_snapdragon_capacity_requirements_v1(v_program_id);
  perform atlas.refresh_snapdragon_tray_windows_v1(v_program_id);
  perform atlas.sync_snapdragon_auto_capacity_reservations_v1(v_program_id);
  perform atlas.sync_snapdragon_bed_preparation_tasks_v1(v_program_id);
  return atlas.owner_production_capacity_snapshot_v1(p_farm_id);
end; $$;

create or replace function atlas.owner_assign_production_bed_v1(p_farm_id uuid,p_production_lot_id uuid,p_object_id uuid,p_quantity_assigned numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_program_id uuid;v_requirement atlas.production_capacity_requirements%rowtype;v_object atlas.growing_objects%rowtype;v_existing_assigned numeric;v_assignment_id uuid;v_question_id uuid;v_lots_needed integer;v_lots_assigned integer;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  select pl.program_id into v_program_id from atlas.production_lots pl join atlas.production_programs pp on pp.id=pl.program_id where pl.id=p_production_lot_id and pl.farm_id=p_farm_id and pp.stable_key='spring_2027_snapdragon_program';
  if v_program_id is null then raise exception 'Production lot was not found.' using errcode='P0002'; end if;
  select * into v_requirement from atlas.production_capacity_requirements where production_lot_id=p_production_lot_id and capacity_kind='bed_feet' for update;
  if v_requirement.id is null or v_requirement.calculation_status not in ('calculated','confirmed') or v_requirement.quantity_needed is null then raise exception 'Calculate the production lot bed requirement before assigning beds.' using errcode='22023'; end if;
  select * into v_object from atlas.growing_objects where id=p_object_id and farm_id=p_farm_id and object_type='bed' and length_ft is not null and length_ft>0;
  if v_object.id is null then raise exception 'Selected growing bed was not found.' using errcode='P0002'; end if;
  if p_quantity_assigned is null or p_quantity_assigned<=0 or p_quantity_assigned>v_object.length_ft then raise exception 'Assigned bed-feet must fit inside the selected bed.' using errcode='22023'; end if;
  select coalesce(sum(quantity_assigned),0) into v_existing_assigned from atlas.production_bed_assignments where production_lot_id=p_production_lot_id and assignment_status='assigned' and object_id is distinct from p_object_id;
  if v_existing_assigned+p_quantity_assigned>v_requirement.quantity_needed then raise exception 'Bed assignments exceed the production lot requirement.' using errcode='22023'; end if;
  insert into atlas.production_bed_assignments(farm_id,production_lot_id,requirement_id,object_id,quantity_assigned,unit,planned_transplant_date,assignment_status,source,metadata)
  values(p_farm_id,p_production_lot_id,v_requirement.id,p_object_id,p_quantity_assigned,'bed_ft',v_requirement.required_by_date,'assigned','owner_capacity_planner',jsonb_build_object('capacity_question_key','spring_snapdragon_bed_assignments','assigned_by',auth.uid()))
  on conflict(production_lot_id,object_id) where assignment_status='assigned' do update set quantity_assigned=excluded.quantity_assigned,requirement_id=excluded.requirement_id,planned_transplant_date=excluded.planned_transplant_date,metadata=atlas.production_bed_assignments.metadata||excluded.metadata,updated_at=now()
  returning id into v_assignment_id;
  select id into v_question_id from atlas.capacity_questions where production_program_id=v_program_id and stable_key='spring_snapdragon_bed_assignments';
  select count(*) into v_lots_needed from atlas.production_lots pl join atlas.production_capacity_requirements req on req.production_lot_id=pl.id where pl.program_id=v_program_id and req.capacity_kind='bed_feet' and req.quantity_needed is not null and req.calculation_status in ('calculated','confirmed');
  select count(*) into v_lots_assigned from (select pl.id from atlas.production_lots pl join atlas.production_capacity_requirements req on req.production_lot_id=pl.id and req.capacity_kind='bed_feet' left join atlas.production_bed_assignments a on a.production_lot_id=pl.id and a.assignment_status='assigned' where pl.program_id=v_program_id and req.quantity_needed is not null and req.calculation_status in ('calculated','confirmed') group by pl.id,req.quantity_needed having coalesce(sum(a.quantity_assigned),0)>=req.quantity_needed) complete_lots;
  update atlas.capacity_questions set status=case when v_lots_needed>0 and v_lots_assigned=v_lots_needed then 'answered' else 'open' end,answer_text=case when v_lots_needed>0 and v_lots_assigned=v_lots_needed then v_lots_assigned::text||' production lots fully assigned' else v_lots_assigned::text||' of '||v_lots_needed::text||' production lots fully assigned' end,answered_at=case when v_lots_needed>0 and v_lots_assigned=v_lots_needed then now() else null end,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('assigned_by',auth.uid()),updated_at=now() where id=v_question_id;
  perform atlas.sync_snapdragon_bed_preparation_tasks_v1(v_program_id);
  return atlas.owner_production_capacity_snapshot_v1(p_farm_id);
end; $$;

create or replace function atlas.owner_release_production_bed_v1(p_farm_id uuid,p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_program_id uuid;v_question_id uuid;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  select pl.program_id into v_program_id from atlas.production_bed_assignments a join atlas.production_lots pl on pl.id=a.production_lot_id join atlas.production_programs pp on pp.id=pl.program_id where a.id=p_assignment_id and a.farm_id=p_farm_id and pp.stable_key='spring_2027_snapdragon_program' for update of a;
  if v_program_id is null then raise exception 'Bed assignment was not found.' using errcode='P0002'; end if;
  update atlas.production_bed_assignments set assignment_status='released',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('released_by',auth.uid(),'released_at',now()),updated_at=now() where id=p_assignment_id;
  update atlas.tasks set status='archived',blocker_text=null,note=coalesce(note,'')||' Bed assignment released by Owner.',updated_at=now() where farm_id=p_farm_id and engine_instance_key='capacity-bed-prep:'||p_assignment_id::text and status in ('open','blocked');
  select id into v_question_id from atlas.capacity_questions where production_program_id=v_program_id and stable_key='spring_snapdragon_bed_assignments';
  update atlas.capacity_questions set status='open',answer_text='Bed assignments changed; review remaining production lots.',answered_at=null,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('released_by',auth.uid()),updated_at=now() where id=v_question_id;
  return atlas.owner_production_capacity_snapshot_v1(p_farm_id);
end; $$;

create or replace function atlas.owner_recalculate_production_capacity_v1(p_farm_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_program_id uuid;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  select id into v_program_id from atlas.production_programs where farm_id=p_farm_id and stable_key='spring_2027_snapdragon_program';
  if v_program_id is null then raise exception 'Spring 2027 Snapdragon program not found.' using errcode='P0002'; end if;
  perform atlas.refresh_grow_room_capacity_pools_v1(p_farm_id);
  perform atlas.refresh_snapdragon_capacity_requirements_v1(v_program_id);
  perform atlas.refresh_snapdragon_tray_windows_v1(v_program_id);
  perform atlas.sync_snapdragon_auto_capacity_reservations_v1(v_program_id);
  perform atlas.sync_snapdragon_bed_preparation_tasks_v1(v_program_id);
  return atlas.owner_production_capacity_snapshot_v1(p_farm_id);
end; $$;

revoke execute on function atlas.owner_answer_capacity_question_v1(uuid,uuid,numeric,text,text) from public,anon;
revoke execute on function atlas.owner_assign_production_bed_v1(uuid,uuid,uuid,numeric) from public,anon;
revoke execute on function atlas.owner_release_production_bed_v1(uuid,uuid) from public,anon;
revoke execute on function atlas.owner_recalculate_production_capacity_v1(uuid) from public,anon;
grant execute on function atlas.owner_answer_capacity_question_v1(uuid,uuid,numeric,text,text) to authenticated,service_role;
grant execute on function atlas.owner_assign_production_bed_v1(uuid,uuid,uuid,numeric) to authenticated,service_role;
grant execute on function atlas.owner_release_production_bed_v1(uuid,uuid) to authenticated,service_role;
grant execute on function atlas.owner_recalculate_production_capacity_v1(uuid) to authenticated,service_role;
