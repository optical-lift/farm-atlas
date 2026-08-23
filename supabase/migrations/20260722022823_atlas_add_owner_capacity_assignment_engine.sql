alter table atlas.capacity_measurements drop constraint if exists capacity_measurements_value_check;
alter table atlas.capacity_measurements add constraint capacity_measurements_value_check check ((measurement_kind='count' and value>=0) or (measurement_kind<>'count' and value>0));

create table atlas.production_bed_assignments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  requirement_id uuid not null references atlas.production_capacity_requirements(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  quantity_assigned numeric not null check (quantity_assigned>0),
  unit text not null default 'bed_ft',
  planned_transplant_date date not null,
  expected_release_date date,
  assignment_status text not null default 'assigned' check (assignment_status in ('assigned','released','cancelled')),
  source text not null default 'owner_capacity_planner',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id,object_id,assignment_status),
  check (expected_release_date is null or expected_release_date>=planned_transplant_date)
);
create index production_bed_assignments_lot_idx on atlas.production_bed_assignments(production_lot_id,assignment_status);
create index production_bed_assignments_object_idx on atlas.production_bed_assignments(object_id,planned_transplant_date) where assignment_status='assigned';
create trigger production_bed_assignments_set_updated_at before update on atlas.production_bed_assignments for each row execute function atlas.set_updated_at();

create or replace function atlas.validate_production_bed_assignment_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare v_lot_farm uuid; v_req_farm uuid; v_req_lot uuid; v_req_kind text; v_req_unit text; v_object_farm uuid; v_object_type text; v_length numeric;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id,production_lot_id,capacity_kind,unit into v_req_farm,v_req_lot,v_req_kind,v_req_unit from atlas.production_capacity_requirements where id=new.requirement_id;
  select farm_id,object_type,length_ft into v_object_farm,v_object_type,v_length from atlas.growing_objects where id=new.object_id;
  if v_lot_farm is distinct from new.farm_id or v_req_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id then raise exception 'Bed assignment records must belong to the same farm'; end if;
  if v_req_lot is distinct from new.production_lot_id or v_req_kind is distinct from 'bed_feet' or v_req_unit is distinct from new.unit then raise exception 'Bed assignment requirement must be the production lot bed-feet requirement'; end if;
  if v_object_type is distinct from 'bed' or v_length is null or v_length<=0 then raise exception 'Bed assignments require a measured growing bed'; end if;
  if new.quantity_assigned>v_length then raise exception 'Bed assignment exceeds the selected bed length'; end if;
  return new;
end; $$;
create trigger production_bed_assignments_validate before insert or update on atlas.production_bed_assignments for each row execute function atlas.validate_production_bed_assignment_v1();

create or replace function atlas.sync_snapdragon_auto_capacity_reservations_v1(p_program_id uuid)
returns jsonb language plpgsql security definer set search_path=atlas,public as $$
declare v_farm_id uuid; v_requirement record; v_pool_id uuid; v_pool_key text; v_created integer:=0; v_released integer:=0;
begin
  select farm_id into v_farm_id from atlas.production_programs where id=p_program_id and stable_key='spring_2027_snapdragon_program';
  if v_farm_id is null then raise exception 'Spring 2027 Snapdragon program not found'; end if;
  update atlas.production_capacity_reservations r set reservation_status='released',updated_at=now(),metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object('released_reason','requirement_no_longer_reservable')
  from atlas.production_capacity_requirements req join atlas.production_lots pl on pl.id=req.production_lot_id
  where pl.program_id=p_program_id and r.requirement_id=req.id and r.source='snapdragon_capacity_auto' and r.reservation_status in ('tentative','confirmed') and (req.calculation_status not in ('calculated','confirmed') or req.quantity_needed is null or req.quantity_needed<=0 or req.window_start is null or req.window_end is null);
  get diagnostics v_released=row_count;
  for v_requirement in
    select req.*,pl.stable_key production_lot_key from atlas.production_capacity_requirements req join atlas.production_lots pl on pl.id=req.production_lot_id
    where pl.program_id=p_program_id and req.capacity_kind in ('trays','shelf_positions','lit_shelf_positions') and req.calculation_status in ('calculated','confirmed') and req.quantity_needed is not null and req.quantity_needed>0 and req.window_start is not null and req.window_end is not null
    order by pl.succession_number,req.capacity_kind
  loop
    v_pool_key:=case v_requirement.capacity_kind when 'trays' then 'grow_room_tray_inventory' when 'shelf_positions' then 'grow_room_shelf_positions' when 'lit_shelf_positions' then 'grow_room_lit_shelf_positions' end;
    select id into v_pool_id from atlas.capacity_pools where farm_id=v_farm_id and stable_key=v_pool_key and active and capacity_status='confirmed';
    if v_pool_id is null then continue; end if;
    insert into atlas.production_capacity_reservations(farm_id,production_lot_id,requirement_id,capacity_pool_id,quantity_reserved,unit,window_start,window_end,reservation_status,source,metadata)
    values(v_farm_id,v_requirement.production_lot_id,v_requirement.id,v_pool_id,v_requirement.quantity_needed,v_requirement.unit,v_requirement.window_start,v_requirement.window_end,'confirmed','snapdragon_capacity_auto',jsonb_build_object('production_lot_key',v_requirement.production_lot_key,'capacity_kind',v_requirement.capacity_kind))
    on conflict(requirement_id,capacity_pool_id,window_start,window_end) do update set quantity_reserved=excluded.quantity_reserved,unit=excluded.unit,reservation_status='confirmed',metadata=atlas.production_capacity_reservations.metadata||excluded.metadata,updated_at=now();
    v_created:=v_created+1;
  end loop;
  return jsonb_build_object('programId',p_program_id,'reservationsSynced',v_created,'reservationsReleased',v_released);
end; $$;

create or replace function atlas.sync_snapdragon_bed_preparation_tasks_v1(p_program_id uuid)
returns jsonb language plpgsql security definer set search_path=atlas,public as $$
declare v_program atlas.production_programs%rowtype; v_assignment record; v_anna uuid; v_worker_key text; v_task_id uuid; v_created integer:=0; v_updated integer:=0; v_title text; v_metadata jsonb;
begin
  select * into v_program from atlas.production_programs where id=p_program_id and stable_key='spring_2027_snapdragon_program';
  if v_program.id is null then raise exception 'Spring 2027 Snapdragon program not found'; end if;
  select fm.id,fm.worker_key into v_anna,v_worker_key from atlas.farm_memberships fm where fm.farm_id=v_program.farm_id and fm.active and fm.worker_key='anna' order by fm.created_at limit 1;
  for v_assignment in
    select a.id assignment_id,a.production_lot_id,a.object_id,a.quantity_assigned,a.planned_transplant_date,req.preparation_due_date,pl.stable_key production_lot_key,pl.lot_label,go.label object_label,go.zone_id
    from atlas.production_bed_assignments a join atlas.production_lots pl on pl.id=a.production_lot_id join atlas.production_capacity_requirements req on req.id=a.requirement_id join atlas.growing_objects go on go.id=a.object_id
    where pl.program_id=p_program_id and a.assignment_status='assigned' and req.preparation_due_date is not null
    order by req.preparation_due_date,pl.succession_number,go.sort_order
  loop
    v_title:='Prepare '||v_assignment.object_label||' for '||v_assignment.lot_label;
    v_metadata:=jsonb_build_object('task_key','capacity_bed_prep_'||v_assignment.assignment_id::text,'anna_task',v_anna is not null,'owner_task',v_anna is null,'assigned_to',coalesce(v_worker_key,'Owner'),'work_route','prepare','work_rhythm','Bed Preparation','display_action','Prepare bed','display_subject',v_assignment.object_label,'display_detail',v_assignment.quantity_assigned::text||' bed-ft for transplant '||v_assignment.planned_transplant_date::text,'collection_zone',v_assignment.object_label,'production_program_id',p_program_id,'production_lot_id',v_assignment.production_lot_id,'production_lot_key',v_assignment.production_lot_key,'production_bed_assignment_id',v_assignment.assignment_id,'destination_object_id',v_assignment.object_id,'required_bed_feet',v_assignment.quantity_assigned,'target_transplant_date',v_assignment.planned_transplant_date,'relationship_kind','production_capacity_preparation');
    select id into v_task_id from atlas.tasks where farm_id=v_program.farm_id and engine_instance_key='capacity-bed-prep:'||v_assignment.assignment_id::text and status in ('open','blocked') limit 1;
    if v_task_id is null then
      insert into atlas.tasks(farm_id,zone_id,title,task_type,status,priority,due_date,unlock_text,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
      values(v_program.farm_id,v_assignment.zone_id,v_title,'bed_preparation','open','high',v_assignment.preparation_due_date,'Makes the assigned bed ready before '||v_assignment.lot_label||' reaches its transplant window.','production_bed_assignment',v_assignment.assignment_id,'Weed, clear, prepare, and confirm water access for '||v_assignment.quantity_assigned::text||' bed-feet.',v_metadata,'prepare','standard','spring_2027_snapdragon_bed_preparation','capacity-bed-prep:'||v_assignment.assignment_id::text,case when v_anna is null then 'owner' else 'assigned_worker' end,v_anna)
      returning id into v_task_id;
      v_created:=v_created+1;
    else
      update atlas.tasks set zone_id=v_assignment.zone_id,title=v_title,due_date=v_assignment.preparation_due_date,unlock_text='Makes the assigned bed ready before '||v_assignment.lot_label||' reaches its transplant window.',note='Weed, clear, prepare, and confirm water access for '||v_assignment.quantity_assigned::text||' bed-feet.',metadata=coalesce(metadata,'{}'::jsonb)||v_metadata,visibility_scope=case when v_anna is null then 'owner' else 'assigned_worker' end,assigned_membership_id=v_anna,updated_at=now() where id=v_task_id;
      v_updated:=v_updated+1;
    end if;
    insert into atlas.task_objects(task_id,object_id,role) values(v_task_id,v_assignment.object_id,'target') on conflict(task_id,object_id) do nothing;
    insert into atlas.production_lot_tasks(production_lot_id,task_id,link_role,source,metadata) values(v_assignment.production_lot_id,v_task_id,'bed_preparation','capacity_planner',jsonb_build_object('production_bed_assignment_id',v_assignment.assignment_id))
    on conflict(production_lot_id,task_id,link_role) do update set metadata=atlas.production_lot_tasks.metadata||excluded.metadata;
  end loop;
  return jsonb_build_object('programId',p_program_id,'tasksCreated',v_created,'tasksUpdated',v_updated);
end; $$;

alter table atlas.production_bed_assignments enable row level security;
revoke all on atlas.production_bed_assignments from public,anon,authenticated;
grant select,insert,update,delete on atlas.production_bed_assignments to service_role;
revoke execute on function atlas.validate_production_bed_assignment_v1() from public,anon,authenticated;
revoke execute on function atlas.sync_snapdragon_auto_capacity_reservations_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.sync_snapdragon_bed_preparation_tasks_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.sync_snapdragon_auto_capacity_reservations_v1(uuid) to service_role;
grant execute on function atlas.sync_snapdragon_bed_preparation_tasks_v1(uuid) to service_role;
