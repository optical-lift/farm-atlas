create or replace function atlas.sync_snapdragon_auto_capacity_reservations_v1(p_program_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_farm_id uuid; v_requirement record; v_pool_id uuid; v_pool_key text; v_created integer:=0; v_released integer:=0;
begin
  select farm_id into v_farm_id from atlas.production_programs where id=p_program_id and stable_key='spring_2027_snapdragon_program';
  if v_farm_id is null then raise exception 'Spring 2027 Snapdragon program not found'; end if;

  update atlas.production_capacity_reservations r
  set reservation_status='released',updated_at=now(),metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object('released_reason','capacity_requirement_recalculated')
  from atlas.production_capacity_requirements req
  join atlas.production_lots pl on pl.id=req.production_lot_id,
       atlas.capacity_pools cp
  where pl.program_id=p_program_id
    and r.requirement_id=req.id
    and cp.id=r.capacity_pool_id
    and r.source='snapdragon_capacity_auto'
    and r.reservation_status in ('tentative','confirmed')
    and (
      req.calculation_status not in ('calculated','confirmed')
      or req.quantity_needed is null or req.quantity_needed<=0
      or req.window_start is null or req.window_end is null
      or r.quantity_reserved is distinct from req.quantity_needed
      or r.unit is distinct from req.unit
      or r.window_start is distinct from req.window_start
      or r.window_end is distinct from req.window_end
      or cp.stable_key is distinct from case req.capacity_kind when 'trays' then 'grow_room_tray_inventory' when 'shelf_positions' then 'grow_room_shelf_positions' when 'lit_shelf_positions' then 'grow_room_lit_shelf_positions' else null end
    );
  get diagnostics v_released=row_count;

  for v_requirement in
    select req.*,pl.stable_key production_lot_key
    from atlas.production_capacity_requirements req
    join atlas.production_lots pl on pl.id=req.production_lot_id
    where pl.program_id=p_program_id
      and req.capacity_kind in ('trays','shelf_positions','lit_shelf_positions')
      and req.calculation_status in ('calculated','confirmed')
      and req.quantity_needed is not null and req.quantity_needed>0
      and req.window_start is not null and req.window_end is not null
    order by pl.succession_number,req.capacity_kind
  loop
    v_pool_key:=case v_requirement.capacity_kind when 'trays' then 'grow_room_tray_inventory' when 'shelf_positions' then 'grow_room_shelf_positions' when 'lit_shelf_positions' then 'grow_room_lit_shelf_positions' end;
    select id into v_pool_id from atlas.capacity_pools where farm_id=v_farm_id and stable_key=v_pool_key and active and capacity_status='confirmed';
    if v_pool_id is null then continue; end if;
    insert into atlas.production_capacity_reservations(farm_id,production_lot_id,requirement_id,capacity_pool_id,quantity_reserved,unit,window_start,window_end,reservation_status,source,metadata)
    values(v_farm_id,v_requirement.production_lot_id,v_requirement.id,v_pool_id,v_requirement.quantity_needed,v_requirement.unit,v_requirement.window_start,v_requirement.window_end,'confirmed','snapdragon_capacity_auto',jsonb_build_object('production_lot_key',v_requirement.production_lot_key,'capacity_kind',v_requirement.capacity_kind))
    on conflict(requirement_id,capacity_pool_id,window_start,window_end) do update
      set quantity_reserved=excluded.quantity_reserved,unit=excluded.unit,reservation_status='confirmed',metadata=atlas.production_capacity_reservations.metadata||excluded.metadata,updated_at=now();
    v_created:=v_created+1;
  end loop;
  return jsonb_build_object('programId',p_program_id,'reservationsSynced',v_created,'reservationsReleased',v_released);
end; $$;

create or replace function atlas.refresh_snapdragon_bed_assignment_status_v1(p_program_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_question_id uuid; v_lots_needed integer:=0; v_lots_complete integer:=0; v_lots_over integer:=0; v_text text;
begin
  select id into v_question_id from atlas.capacity_questions where production_program_id=p_program_id and stable_key='spring_snapdragon_bed_assignments';
  if v_question_id is null then return jsonb_build_object('programId',p_program_id,'lotsNeeded',0,'lotsComplete',0,'lotsOverAssigned',0); end if;

  select count(*),count(*) filter(where assigned_quantity=req_quantity),count(*) filter(where assigned_quantity>req_quantity)
  into v_lots_needed,v_lots_complete,v_lots_over
  from (
    select pl.id,req.quantity_needed req_quantity,coalesce(sum(a.quantity_assigned) filter(where a.assignment_status='assigned'),0) assigned_quantity
    from atlas.production_lots pl
    join atlas.production_capacity_requirements req on req.production_lot_id=pl.id and req.capacity_kind='bed_feet'
    left join atlas.production_bed_assignments a on a.production_lot_id=pl.id
    where pl.program_id=p_program_id and req.quantity_needed is not null and req.calculation_status in ('calculated','confirmed')
    group by pl.id,req.quantity_needed
  ) x;

  v_text:=v_lots_complete::text||' of '||v_lots_needed::text||' production lots fully assigned';
  if v_lots_over>0 then v_text:=v_text||' · '||v_lots_over::text||' over-assigned after recalculation'; end if;

  update atlas.capacity_questions
  set status=case when v_lots_needed>0 and v_lots_complete=v_lots_needed and v_lots_over=0 then 'answered' else 'open' end,
      answer_text=v_text,
      answered_at=case when v_lots_needed>0 and v_lots_complete=v_lots_needed and v_lots_over=0 then coalesce(answered_at,now()) else null end,
      updated_at=now()
  where id=v_question_id;

  return jsonb_build_object('programId',p_program_id,'lotsNeeded',v_lots_needed,'lotsComplete',v_lots_complete,'lotsOverAssigned',v_lots_over);
end; $$;

create or replace function atlas.refresh_bed_assignment_status_from_requirement_v1()
returns trigger language plpgsql set search_path=pg_catalog,atlas as $$
declare v_program_id uuid;
begin
  if new.capacity_kind='bed_feet' and (new.quantity_needed is distinct from old.quantity_needed or new.calculation_status is distinct from old.calculation_status) then
    select program_id into v_program_id from atlas.production_lots where id=new.production_lot_id;
    if v_program_id is not null then perform atlas.refresh_snapdragon_bed_assignment_status_v1(v_program_id); end if;
  end if;
  return new;
end; $$;

drop trigger if exists production_capacity_requirements_refresh_bed_assignments on atlas.production_capacity_requirements;
create trigger production_capacity_requirements_refresh_bed_assignments
after update of quantity_needed,calculation_status on atlas.production_capacity_requirements
for each row execute function atlas.refresh_bed_assignment_status_from_requirement_v1();

create or replace function atlas.owner_release_production_bed_v1(p_farm_id uuid,p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_program_id uuid;v_task_id uuid;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  select pl.program_id into v_program_id
  from atlas.production_bed_assignments a
  join atlas.production_lots pl on pl.id=a.production_lot_id
  join atlas.production_programs pp on pp.id=pl.program_id
  where a.id=p_assignment_id and a.farm_id=p_farm_id and pp.stable_key='spring_2027_snapdragon_program'
  for update of a;
  if v_program_id is null then raise exception 'Bed assignment was not found.' using errcode='P0002'; end if;

  update atlas.production_bed_assignments
  set assignment_status='released',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('released_by',auth.uid(),'released_at',now()),updated_at=now()
  where id=p_assignment_id;

  for v_task_id in
    select id from atlas.tasks where farm_id=p_farm_id and engine_instance_key='capacity-bed-prep:'||p_assignment_id::text and status in ('open','blocked')
  loop
    perform atlas.record_task_transition_v1_internal(
      v_task_id,'changed_plan',left('capacity-bed-release:'||p_assignment_id::text,160),null,
      'Bed assignment released by Owner.','Bed assignment released by Owner.','prepare','production_capacity',
      jsonb_build_object('production_bed_assignment_id',p_assignment_id,'release_reason','owner_changed_bed_assignment'),null
    );
  end loop;

  perform atlas.refresh_snapdragon_bed_assignment_status_v1(v_program_id);
  return atlas.owner_production_capacity_snapshot_v1(p_farm_id);
end; $$;

revoke execute on function atlas.refresh_snapdragon_bed_assignment_status_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.refresh_bed_assignment_status_from_requirement_v1() from public,anon,authenticated;
grant execute on function atlas.refresh_snapdragon_bed_assignment_status_v1(uuid) to service_role;
