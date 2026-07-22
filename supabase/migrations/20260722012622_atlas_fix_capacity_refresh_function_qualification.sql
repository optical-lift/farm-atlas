create or replace function atlas.refresh_grow_room_capacity_pools_v1(p_farm_id uuid)
returns table (capacity_pool_key text, total_capacity numeric, capacity_status text)
language plpgsql security definer set search_path = atlas, public as $$
declare v_light_sets numeric; v_shelves_per_set numeric; v_total_shelves numeric; v_lit numeric;
begin
  select m.value into v_light_sets from atlas.capacity_measurements m where m.farm_id = p_farm_id and m.stable_key = 'functional_grow_light_sets';
  select m.value into v_shelves_per_set from atlas.capacity_measurements m where m.farm_id = p_farm_id and m.stable_key = 'shelf_positions_per_grow_light_set';
  select cp.total_capacity into v_total_shelves from atlas.capacity_pools cp where cp.farm_id = p_farm_id and cp.stable_key = 'grow_room_shelf_positions';
  if v_light_sets is not null and v_shelves_per_set is not null and v_total_shelves is not null then
    v_lit := least(v_total_shelves, v_light_sets * v_shelves_per_set);
    update atlas.capacity_pools cp set total_capacity = v_lit, capacity_status = 'confirmed', updated_at = now()
    where cp.farm_id = p_farm_id and cp.stable_key = 'grow_room_lit_shelf_positions';
  end if;
  return query select cp.stable_key, cp.total_capacity, cp.capacity_status from atlas.capacity_pools cp
    where cp.farm_id = p_farm_id and cp.stable_key = 'grow_room_lit_shelf_positions';
end; $$;

create or replace function atlas.refresh_snapdragon_capacity_requirements_v1(p_program_id uuid)
returns table (production_lot_id uuid, production_lot_key text, requirements_calculated integer, requirements_blocked integer)
language plpgsql security definer set search_path = atlas, public as $$
declare
  v_farm_id uuid; v_seeds_per_block numeric; v_blocks_per_tray numeric; v_trays_per_shelf numeric;
  v_occupancy_days numeric; v_viability_percent numeric; v_rows_per_bed numeric; v_spacing_inches numeric; v_prep_lead_days numeric;
  lot_rec record; v_blocks numeric; v_trays numeric; v_shelves numeric; v_viable_plants numeric; v_bed_feet numeric; v_calc integer; v_block integer;
begin
  select pp.farm_id into v_farm_id from atlas.production_programs pp where pp.id = p_program_id and pp.stable_key = 'spring_2027_snapdragon_program';
  if v_farm_id is null then raise exception 'Spring 2027 Snapdragon program not found'; end if;
  select m.value into v_seeds_per_block from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_seeds_per_three_quarter_block';
  select m.value into v_blocks_per_tray from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'three_quarter_blocks_per_cafeteria_tray';
  select m.value into v_trays_per_shelf from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'cafeteria_trays_per_rack_shelf';
  select m.value into v_occupancy_days from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_lit_shelf_occupancy_days';
  select m.value into v_viability_percent from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_planning_viability_percent';
  select m.value into v_rows_per_bed from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_rows_per_three_foot_bed';
  select m.value into v_spacing_inches from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_in_row_spacing_inches';
  select m.value into v_prep_lead_days from atlas.capacity_measurements m where m.farm_id = v_farm_id and m.stable_key = 'snapdragon_bed_preparation_lead_days';
  for lot_rec in select pl.* from atlas.production_lots pl where pl.program_id = p_program_id order by pl.succession_number loop
    if lot_rec.planned_input_quantity is not null and v_seeds_per_block is not null then
      v_blocks := ceil(lot_rec.planned_input_quantity / v_seeds_per_block);
      update atlas.production_capacity_requirements r set quantity_needed = v_blocks, calculation_status = 'calculated', updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind = 'soil_blocks';
    else v_blocks := null; end if;
    if v_blocks is not null and v_blocks_per_tray is not null then
      v_trays := ceil(v_blocks / v_blocks_per_tray);
      update atlas.production_capacity_requirements r set quantity_needed = v_trays, calculation_status = 'calculated', updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind = 'trays';
    else v_trays := null; end if;
    if v_trays is not null and v_trays_per_shelf is not null then
      v_shelves := ceil(v_trays / v_trays_per_shelf);
      update atlas.production_capacity_requirements r set quantity_needed = v_shelves, calculation_status = 'calculated', updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind in ('shelf_positions','lit_shelf_positions');
    else v_shelves := null; end if;
    if v_shelves is not null and v_occupancy_days is not null then
      update atlas.production_capacity_requirements r set window_end = r.window_start + (ceil(v_occupancy_days)::integer - 1), updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind in ('shelf_positions','lit_shelf_positions');
    end if;
    if lot_rec.planned_input_quantity is not null and v_viability_percent is not null and v_rows_per_bed is not null and v_spacing_inches is not null then
      v_viable_plants := floor(lot_rec.planned_input_quantity * v_viability_percent / 100.0);
      v_bed_feet := ceil((v_viable_plants * v_spacing_inches / 12.0) / v_rows_per_bed);
      update atlas.production_capacity_requirements r set quantity_needed = v_bed_feet, calculation_status = 'calculated', updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind = 'bed_feet';
    end if;
    if v_prep_lead_days is not null then
      update atlas.production_capacity_requirements r set preparation_due_date = r.required_by_date - ceil(v_prep_lead_days)::integer, updated_at = now()
      where r.production_lot_id = lot_rec.id and r.capacity_kind = 'bed_feet';
    end if;
    select count(*) filter (where r.calculation_status in ('calculated','confirmed')), count(*) filter (where r.calculation_status = 'blocked')
      into v_calc, v_block from atlas.production_capacity_requirements r where r.production_lot_id = lot_rec.id;
    production_lot_id := lot_rec.id; production_lot_key := lot_rec.stable_key; requirements_calculated := v_calc; requirements_blocked := v_block; return next;
  end loop;
end; $$;

revoke execute on function atlas.refresh_grow_room_capacity_pools_v1(uuid) from public, anon, authenticated;
revoke execute on function atlas.refresh_snapdragon_capacity_requirements_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.refresh_grow_room_capacity_pools_v1(uuid) to service_role;
grant execute on function atlas.refresh_snapdragon_capacity_requirements_v1(uuid) to service_role;