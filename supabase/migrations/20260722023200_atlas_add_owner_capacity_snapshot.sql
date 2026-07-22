create or replace function atlas.refresh_snapdragon_tray_windows_v1(p_program_id uuid)
returns integer language plpgsql security definer set search_path=atlas,public as $$
declare v_farm_id uuid; v_days numeric; v_updated integer:=0;
begin
  select farm_id into v_farm_id from atlas.production_programs where id=p_program_id and stable_key='spring_2027_snapdragon_program';
  if v_farm_id is null then raise exception 'Spring 2027 Snapdragon program not found'; end if;
  select value into v_days from atlas.capacity_measurements where farm_id=v_farm_id and stable_key='snapdragon_lit_shelf_occupancy_days';
  if v_days is null then return 0; end if;
  update atlas.production_capacity_requirements r set window_end=r.window_start+(ceil(v_days)::integer-1),updated_at=now() from atlas.production_lots pl where pl.id=r.production_lot_id and pl.program_id=p_program_id and r.capacity_kind='trays' and r.window_start is not null;
  get diagnostics v_updated=row_count;
  return v_updated;
end; $$;

create or replace function atlas.owner_production_capacity_snapshot_v1(p_farm_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,atlas as $$
declare v_program atlas.production_programs%rowtype; v_result jsonb;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  select * into v_program from atlas.production_programs where farm_id=p_farm_id and stable_key='spring_2027_snapdragon_program';
  if v_program.id is null then raise exception 'Spring 2027 Snapdragon program not found.' using errcode='P0002'; end if;
  select jsonb_build_object(
    'program',jsonb_build_object('id',v_program.id,'stableKey',v_program.stable_key,'label',v_program.program_label,'seasonYear',v_program.season_year,'promise',v_program.promise_text,'status',v_program.status),
    'summary',jsonb_build_object(
      'openQuestions',(select count(*) from atlas.capacity_questions q where q.production_program_id=v_program.id and q.status='open'),
      'answeredQuestions',(select count(*) from atlas.capacity_questions q where q.production_program_id=v_program.id and q.status='answered'),
      'blockedRequirements',(select count(*) from atlas.production_capacity_requirements r join atlas.production_lots pl on pl.id=r.production_lot_id where pl.program_id=v_program.id and r.calculation_status='blocked'),
      'calculatedRequirements',(select count(*) from atlas.production_capacity_requirements r join atlas.production_lots pl on pl.id=r.production_lot_id where pl.program_id=v_program.id and r.calculation_status in ('calculated','confirmed')),
      'activeReservations',(select count(*) from atlas.production_capacity_reservations r join atlas.production_lots pl on pl.id=r.production_lot_id where pl.program_id=v_program.id and r.reservation_status in ('tentative','confirmed')),
      'bedAssignments',(select count(*) from atlas.production_bed_assignments a join atlas.production_lots pl on pl.id=a.production_lot_id where pl.program_id=v_program.id and a.assignment_status='assigned'),
      'capacityConflicts',(select count(*) from atlas.capacity_pool_daily_load_v1 l join atlas.capacity_pools cp on cp.id=l.capacity_pool_id where cp.farm_id=p_farm_id and l.capacity_unknown_or_overbooked and l.load_date between date '2027-01-01' and date '2027-12-31')
    ),
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'stableKey',q.stable_key,'kind',q.question_kind,'question',q.question_text,'answerValue',q.answer_value,'answerUnit',q.answer_unit,'answerText',q.answer_text,'status',q.status,'answeredAt',q.answered_at,'metadata',q.metadata) order by case q.stable_key when 'rocket_s1_seed_quantity' then 1 when 'madame_s2_seed_quantity' then 2 when 'snapdragon_seeds_per_three_quarter_block' then 3 when 'three_quarter_blocks_per_cafeteria_tray' then 4 when 'cafeteria_trays_per_rack_shelf' then 5 when 'functional_grow_light_sets' then 6 when 'shelf_positions_per_grow_light_set' then 7 when 'snapdragon_lit_shelf_occupancy_days' then 8 when 'snapdragon_planning_viability_percent' then 9 when 'snapdragon_rows_per_three_foot_bed' then 10 when 'snapdragon_in_row_spacing_inches' then 11 when 'snapdragon_bed_preparation_lead_days' then 12 when 'spring_snapdragon_bed_assignments' then 13 else 99 end) from atlas.capacity_questions q where q.production_program_id=v_program.id),'[]'::jsonb),
    'pools',coalesce((select jsonb_agg(jsonb_build_object('id',cp.id,'stableKey',cp.stable_key,'label',cp.label,'kind',cp.capacity_kind,'totalCapacity',cp.total_capacity,'unit',cp.unit,'status',cp.capacity_status,'resourceId',cp.resource_id,'objectId',cp.object_id) order by cp.capacity_kind,cp.label) from atlas.capacity_pools cp where cp.farm_id=p_farm_id and cp.active),'[]'::jsonb),
    'lots',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pl.id,'stableKey',pl.stable_key,'label',pl.lot_label,'successionNumber',pl.succession_number,'plannedSeedQuantity',pl.planned_input_quantity,'plannedSowDate',pl.planned_sow_date,'transplantStart',pl.expected_transplant_start,'transplantEnd',pl.expected_transplant_end,
      'requirements',coalesce((select jsonb_agg(jsonb_build_object('id',req.id,'stableKey',req.stable_key,'capacityKind',req.capacity_kind,'quantityNeeded',req.quantity_needed,'unit',req.unit,'requiredByDate',req.required_by_date,'windowStart',req.window_start,'windowEnd',req.window_end,'preparationDueDate',req.preparation_due_date,'status',req.calculation_status,'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'poolId',r.capacity_pool_id,'poolLabel',cp.label,'quantityReserved',r.quantity_reserved,'unit',r.unit,'windowStart',r.window_start,'windowEnd',r.window_end,'status',r.reservation_status) order by cp.label) from atlas.production_capacity_reservations r join atlas.capacity_pools cp on cp.id=r.capacity_pool_id where r.requirement_id=req.id and r.reservation_status in ('tentative','confirmed')),'[]'::jsonb)) order by case req.capacity_kind when 'seed' then 1 when 'soil_blocks' then 2 when 'trays' then 3 when 'shelf_positions' then 4 when 'lit_shelf_positions' then 5 when 'bed_feet' then 6 else 99 end) from atlas.production_capacity_requirements req where req.production_lot_id=pl.id),'[]'::jsonb),
      'bedAssignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'objectId',a.object_id,'objectLabel',go.label,'zoneLabel',z.label,'quantityAssigned',a.quantity_assigned,'unit',a.unit,'plannedTransplantDate',a.planned_transplant_date,'expectedReleaseDate',a.expected_release_date,'status',a.assignment_status,'preparationTaskId',(select t.id from atlas.tasks t where t.engine_instance_key='capacity-bed-prep:'||a.id::text and t.status in ('open','blocked','done') order by t.created_at desc limit 1)) order by z.sort_order,go.sort_order) from atlas.production_bed_assignments a join atlas.growing_objects go on go.id=a.object_id join atlas.zones z on z.id=go.zone_id where a.production_lot_id=pl.id and a.assignment_status='assigned'),'[]'::jsonb)
    ) order by pl.succession_number) from atlas.production_lots pl where pl.program_id=v_program.id),'[]'::jsonb),
    'bedCandidates',coalesce((select jsonb_agg(jsonb_build_object('id',go.id,'stableKey',go.stable_key,'label',go.label,'zoneId',z.id,'zoneLabel',z.label,'lengthFt',go.length_ft,'widthFt',go.width_ft,'managementGroup',go.metadata->>'management_group') order by z.sort_order,go.sort_order,go.label) from atlas.growing_objects go join atlas.zones z on z.id=go.zone_id where go.farm_id=p_farm_id and go.object_type='bed' and go.length_ft is not null and go.length_ft>0),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(jsonb_build_object('poolId',l.capacity_pool_id,'poolKey',l.capacity_pool_key,'poolLabel',l.capacity_pool_label,'date',l.load_date,'totalCapacity',l.total_capacity,'reservedQuantity',l.reserved_quantity,'remainingCapacity',l.remaining_capacity,'unknownOrOverbooked',l.capacity_unknown_or_overbooked) order by l.load_date,l.capacity_pool_label) from atlas.capacity_pool_daily_load_v1 l join atlas.capacity_pools cp on cp.id=l.capacity_pool_id where cp.farm_id=p_farm_id and l.capacity_unknown_or_overbooked and l.load_date between date '2027-01-01' and date '2027-12-31'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

revoke execute on function atlas.refresh_snapdragon_tray_windows_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_snapdragon_tray_windows_v1(uuid) to service_role;
revoke execute on function atlas.owner_production_capacity_snapshot_v1(uuid) from public,anon;
grant execute on function atlas.owner_production_capacity_snapshot_v1(uuid) to authenticated,service_role;
