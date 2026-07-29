create or replace function atlas.record_crop_occupancy_note_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_content atlas.object_contents%rowtype;
  v_placement atlas.crop_placements%rowtype;
  v_observation atlas.crop_observations%rowtype;
  v_object_key text := nullif(btrim(p_payload->>'objectKey'),'');
  v_crop_label text := nullif(btrim(p_payload->>'cropLabel'),'');
  v_variety text := nullif(btrim(p_payload->>'variety'),'');
  v_content_type text := coalesce(nullif(btrim(p_payload->>'contentType'),''),'crop');
  v_life_cycle text := coalesce(nullif(lower(btrim(p_payload->>'lifeCycle')),''),case when coalesce((p_payload->>'perennial')::boolean,false) then 'perennial' end);
  v_establishment_kind text := coalesce(nullif(lower(btrim(p_payload->>'establishmentKind')),''),'unknown');
  v_establishment_date date := atlas.try_date_v1(p_payload->>'establishmentDate');
  v_observed_date date := coalesce(atlas.try_date_v1(p_payload#>>'{observation,observedDate}'),atlas.try_date_v1(p_payload->>'observedDate'));
  v_stage text := coalesce(nullif(lower(btrim(p_payload#>>'{observation,stage}')),''),nullif(lower(btrim(p_payload->>'stage')),''));
  v_identity text;
  v_cycle_key text;
  v_placement_payload jsonb := coalesce(p_payload->'placement','{}'::jsonb);
  v_observation_payload jsonb := coalesce(p_payload->'observation','{}'::jsonb);
  v_placement_key text;
  v_mode text;
  v_placement_label text;
  v_rows numeric;
  v_row_length numeric;
  v_area numeric;
  v_plant_count numeric;
  v_clump_count numeric;
  v_spacing numeric;
  v_ppsf numeric;
  v_expected numeric;
  v_expected_kind text := 'unknown';
  v_expected_unit text;
  v_expected_basis text;
  v_observed_quantity numeric;
  v_observed_unit text;
  v_observed_kind text;
  v_stand numeric;
  v_condition text;
  v_confidence text;
  v_idempotency text;
  v_raw_note text := nullif(p_payload->>'rawNote','');
  v_cell jsonb;
  v_cell_key text;
  v_column text;
  v_foot integer;
  v_fraction numeric;
  v_unknowns jsonb := '[]'::jsonb;
begin
  if v_object_key is null or v_crop_label is null then
    raise exception 'objectKey and cropLabel are required.' using errcode='22023';
  end if;

  select go.* into v_object from atlas.growing_objects go where go.stable_key=v_object_key;
  if v_object.id is null then raise exception 'Growing object not found.' using errcode='P0002'; end if;
  if not atlas.is_farm_owner(v_object.farm_id)
     and current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  then
    raise exception 'Only the farm owner may record crop occupancy.' using errcode='42501';
  end if;

  select cp.* into v_profile
  from atlas.crop_profiles cp
  where lower(cp.crop_label)=lower(v_crop_label)
    and (v_variety is null or lower(coalesce(cp.variety,''))=lower(v_variety))
  order by (v_variety is not null and cp.variety is not null) desc,cp.updated_at desc
  limit 1;

  v_identity := atlas.normalize_crop_identity_v1(v_crop_label,v_variety);
  select cc.* into v_cycle
  from atlas.crop_cycles cc
  where cc.object_id=v_object.id
    and cc.lifecycle_status='active'
    and atlas.normalize_crop_identity_v1(cc.crop_label,cc.variety)=v_identity
    and (
      v_establishment_date is null
      or coalesce(cc.planted_date,cc.sown_date)=v_establishment_date
      or coalesce(cc.planted_date,cc.sown_date) is null
    )
  order by
    (coalesce(cc.planted_date,cc.sown_date)=v_establishment_date) desc,
    cc.updated_at desc
  limit 1;

  if v_cycle.id is null then
    v_cycle_key := 'note:'||v_object.stable_key||':'||substr(md5(v_identity||':'||coalesce(v_establishment_date::text,'unknown')),1,24);
    insert into atlas.crop_cycles(
      farm_id,object_id,crop_profile_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,
      sown_date,planted_date,metadata
    ) values (
      v_object.farm_id,v_object.id,v_profile.id,v_cycle_key,v_crop_label,v_variety,
      coalesce(v_stage,case when v_establishment_kind='sown' then 'sown' when v_life_cycle='perennial' then 'established' else 'planned' end),'active',
      case when v_establishment_kind='sown' then v_establishment_date end,
      case when v_establishment_kind in ('planted','transplanted') then v_establishment_date end,
      jsonb_strip_nulls(jsonb_build_object(
        'source','record_crop_occupancy_note_v1','identity',v_identity,'life_cycle',v_life_cycle,
        'raw_note',v_raw_note,'establishment_kind',v_establishment_kind
      ))
    ) returning * into v_cycle;
  else
    update atlas.crop_cycles
    set crop_profile_id=coalesce(crop_profile_id,v_profile.id),
        cycle_state=coalesce(v_stage,cycle_state),
        sown_date=case when v_establishment_kind='sown' and v_establishment_date is not null then v_establishment_date else sown_date end,
        planted_date=case when v_establishment_kind in ('planted','transplanted') and v_establishment_date is not null then v_establishment_date else planted_date end,
        metadata=metadata||jsonb_strip_nulls(jsonb_build_object('raw_note',v_raw_note,'life_cycle',v_life_cycle)),
        updated_at=now()
    where id=v_cycle.id returning * into v_cycle;
  end if;

  select oc.* into v_content
  from atlas.object_contents oc
  where oc.object_id=v_object.id
    and coalesce((oc.metadata->>'crop_occupancy_cycle_id')::uuid,v_cycle.object_content_id)=v_cycle.id
  order by (oc.id=v_cycle.object_content_id) desc,oc.updated_at desc
  limit 1;

  if v_content.id is null then
    insert into atlas.object_contents(
      farm_id,object_id,crop_profile_id,content_label,content_type,variety,planted_date,status,confidence,
      start_method,metadata
    ) values (
      v_object.farm_id,v_object.id,v_profile.id,v_crop_label,v_content_type,v_variety,
      case when v_establishment_kind in ('sown','planted','transplanted') then v_establishment_date end,
      coalesce(v_stage,case when v_life_cycle='perennial' then 'established' when v_establishment_kind='sown' then 'sown' else 'planted' end),
      atlas.occupancy_confidence_v1(coalesce(p_payload->>'confidence','owner_confirmed')),
      case when v_establishment_kind='sown' then 'direct_sow' when v_establishment_kind in ('planted','transplanted') then 'transplant' end,
      jsonb_strip_nulls(jsonb_build_object(
        'source','record_crop_occupancy_note_v1','crop_occupancy_cycle_id',v_cycle.id,
        'raw_note',v_raw_note,'life_cycle',v_life_cycle
      ))
    ) returning * into v_content;
    update atlas.crop_cycles set object_content_id=v_content.id,updated_at=now() where id=v_cycle.id;
  else
    update atlas.object_contents
    set content_label=v_crop_label,
        content_type=coalesce(nullif(v_content_type,''),content_type),
        variety=coalesce(v_variety,variety),
        planted_date=case when v_establishment_kind in ('sown','planted','transplanted') and v_establishment_date is not null then v_establishment_date else planted_date end,
        status=coalesce(v_stage,status),
        metadata=metadata||jsonb_strip_nulls(jsonb_build_object('crop_occupancy_cycle_id',v_cycle.id,'raw_note',v_raw_note,'life_cycle',v_life_cycle)),
        updated_at=now()
    where id=v_content.id returning * into v_content;
  end if;

  insert into atlas.crop_occupancy_evidence(
    farm_id,object_id,crop_cycle_id,object_content_id,evidence_role,evidence_date,confidence,metadata
  ) values (
    v_object.farm_id,v_object.id,v_cycle.id,v_content.id,'identity',coalesce(v_establishment_date,v_observed_date),
    atlas.occupancy_confidence_v1(coalesce(p_payload->>'confidence','owner_confirmed')),
    jsonb_strip_nulls(jsonb_build_object('source','record_crop_occupancy_note_v1','raw_note',v_raw_note,'payload',p_payload))
  ) on conflict do nothing;

  v_placement_key := coalesce(nullif(v_placement_payload->>'placementKey',''),'primary');
  v_mode := coalesce(nullif(lower(v_placement_payload->>'mode'),''),'unknown');
  v_placement_label := nullif(v_placement_payload->>'label','');
  v_rows := atlas.try_numeric_v1(v_placement_payload->>'rowCount');
  v_row_length := atlas.try_numeric_v1(v_placement_payload->>'rowLengthFt');
  v_area := atlas.try_numeric_v1(v_placement_payload->>'areaSqft');
  v_plant_count := atlas.try_numeric_v1(v_placement_payload->>'plantCount');
  v_clump_count := atlas.try_numeric_v1(v_placement_payload->>'clumpCount');
  v_spacing := coalesce(atlas.try_numeric_v1(v_placement_payload->>'spacingIn'),v_profile.in_row_spacing_in);
  v_ppsf := coalesce(atlas.try_numeric_v1(v_placement_payload->>'plantsPerSqft'),v_profile.plants_per_sqft);
  v_expected_unit := coalesce(nullif(lower(v_placement_payload->>'quantityUnit'),''),case when v_clump_count is not null then 'clumps' else 'plants' end);

  if v_mode='unknown' then
    v_mode := case
      when v_rows is not null and (v_row_length is null or v_row_length=v_object.length_ft) then 'full_rows'
      when v_rows is not null then 'partial_rows'
      when v_area is not null then 'square_foot_block'
      when v_plant_count is not null then 'individual_plants'
      when v_clump_count is not null then 'clumps'
      else 'unknown'
    end;
  end if;
  if v_rows is not null and v_row_length is null then v_row_length:=v_object.length_ft; end if;
  if v_area is null and v_mode='square_foot_block' then v_area:=atlas.try_numeric_v1(v_placement_payload->>'squareFeet'); end if;

  if v_plant_count is not null then
    v_expected:=v_plant_count; v_expected_kind:='recorded'; v_expected_basis:='recorded plant count';
  elsif v_clump_count is not null then
    v_expected:=v_clump_count; v_expected_kind:='recorded'; v_expected_unit:='clumps'; v_expected_basis:='recorded clump count';
  elsif v_rows is not null and v_row_length is not null and v_spacing is not null then
    v_expected:=round(v_rows*v_row_length*12/v_spacing); v_expected_kind:='calculated'; v_expected_unit:='plants'; v_expected_basis:='rows × row length ÷ in-row spacing';
  elsif v_area is not null and v_ppsf is not null then
    v_expected:=round(v_area*v_ppsf); v_expected_kind:='calculated'; v_expected_unit:='plants'; v_expected_basis:='square feet × plants per square foot';
  end if;

  if v_placement_payload<>'{}'::jsonb then
    insert into atlas.crop_placements(
      farm_id,object_id,crop_cycle_id,object_content_id,placement_key,placement_mode,placement_label,
      row_count,row_length_ft,area_sqft,explicit_plant_count,clump_count,spacing_in,plants_per_sqft,
      expected_quantity,expected_quantity_kind,expected_quantity_unit,expected_quantity_basis,confidence,metadata
    ) values (
      v_object.farm_id,v_object.id,v_cycle.id,v_content.id,v_placement_key,v_mode,v_placement_label,
      v_rows,v_row_length,v_area,v_plant_count,v_clump_count,v_spacing,v_ppsf,
      v_expected,v_expected_kind,v_expected_unit,v_expected_basis,
      atlas.occupancy_confidence_v1(coalesce(p_payload->>'confidence','owner_confirmed')),
      jsonb_strip_nulls(jsonb_build_object('source','record_crop_occupancy_note_v1','raw_note',v_raw_note))
    )
    on conflict (crop_cycle_id,placement_key) do update
    set placement_mode=excluded.placement_mode,placement_label=coalesce(excluded.placement_label,atlas.crop_placements.placement_label),
        row_count=coalesce(excluded.row_count,atlas.crop_placements.row_count),row_length_ft=coalesce(excluded.row_length_ft,atlas.crop_placements.row_length_ft),
        area_sqft=coalesce(excluded.area_sqft,atlas.crop_placements.area_sqft),explicit_plant_count=coalesce(excluded.explicit_plant_count,atlas.crop_placements.explicit_plant_count),
        clump_count=coalesce(excluded.clump_count,atlas.crop_placements.clump_count),spacing_in=coalesce(excluded.spacing_in,atlas.crop_placements.spacing_in),
        plants_per_sqft=coalesce(excluded.plants_per_sqft,atlas.crop_placements.plants_per_sqft),expected_quantity=coalesce(excluded.expected_quantity,atlas.crop_placements.expected_quantity),
        expected_quantity_kind=case when excluded.expected_quantity is not null then excluded.expected_quantity_kind else atlas.crop_placements.expected_quantity_kind end,
        expected_quantity_unit=coalesce(excluded.expected_quantity_unit,atlas.crop_placements.expected_quantity_unit),
        expected_quantity_basis=coalesce(excluded.expected_quantity_basis,atlas.crop_placements.expected_quantity_basis),
        confidence=excluded.confidence,metadata=atlas.crop_placements.metadata||excluded.metadata,updated_at=now()
    returning * into v_placement;

    if jsonb_typeof(v_placement_payload->'cells')='array' then
      for v_cell in select value from jsonb_array_elements(v_placement_payload->'cells') loop
        if jsonb_typeof(v_cell)='string' then
          v_cell_key:=trim(both '"' from v_cell::text);
          v_column:=regexp_replace(v_cell_key,'[0-9].*$','','g');
          v_foot:=nullif(regexp_replace(v_cell_key,'^[^0-9]*','','g'),'')::integer;
          v_fraction:=1;
        else
          v_column:=nullif(v_cell->>'column','');
          v_foot:=nullif(v_cell->>'foot','')::integer;
          v_fraction:=coalesce(atlas.try_numeric_v1(v_cell->>'coverageFraction'),1);
          v_cell_key:=coalesce(nullif(v_cell->>'cellKey',''),v_column||v_foot::text);
        end if;
        insert into atlas.crop_placement_cells(placement_id,cell_key,bed_column,foot_number,coverage_fraction,metadata)
        values (v_placement.id,v_cell_key,v_column,v_foot,v_fraction,jsonb_build_object('source','record_crop_occupancy_note_v1'))
        on conflict (placement_id,cell_key) do update
        set coverage_fraction=excluded.coverage_fraction,metadata=atlas.crop_placement_cells.metadata||excluded.metadata;
      end loop;
    end if;
  end if;

  v_observed_quantity:=atlas.try_numeric_v1(v_observation_payload->>'quantity');
  v_observed_unit:=coalesce(nullif(v_observation_payload->>'quantityUnit',''),case when v_clump_count is not null then 'clumps' else 'plants' end);
  v_observed_kind:=coalesce(nullif(v_observation_payload->>'quantityKind',''),case when v_observed_quantity is not null then 'count' end);
  v_stand:=atlas.try_numeric_v1(v_observation_payload->>'standPercent');
  v_condition:=nullif(v_observation_payload->>'condition','');
  v_confidence:=atlas.occupancy_confidence_v1(coalesce(v_observation_payload->>'confidence',p_payload->>'confidence','owner_confirmed'));
  v_idempotency:=coalesce(nullif(p_payload->>'idempotencyKey',''),'occupancy-note:'||md5(p_payload::text));

  if v_stage is not null or v_observed_date is not null or v_observed_quantity is not null or v_stand is not null or v_condition is not null then
    insert into atlas.crop_observations(
      farm_id,object_id,crop_cycle_id,placement_id,object_content_id,observed_date,stage,
      observed_quantity,quantity_unit,quantity_kind,stand_percent,condition,confidence,
      source_kind,source_id,note,idempotency_key,metadata
    ) values (
      v_object.farm_id,v_object.id,v_cycle.id,v_placement.id,v_content.id,v_observed_date,v_stage,
      v_observed_quantity,v_observed_unit,v_observed_kind,v_stand,v_condition,v_confidence,
      'owner_note',v_idempotency,nullif(v_observation_payload->>'note',''),v_idempotency,
      jsonb_strip_nulls(jsonb_build_object('source','record_crop_occupancy_note_v1','raw_note',v_raw_note,'payload',p_payload))
    )
    on conflict (farm_id,idempotency_key) do update
    set observed_date=coalesce(excluded.observed_date,atlas.crop_observations.observed_date),
        stage=coalesce(excluded.stage,atlas.crop_observations.stage),observed_quantity=coalesce(excluded.observed_quantity,atlas.crop_observations.observed_quantity),
        quantity_unit=coalesce(excluded.quantity_unit,atlas.crop_observations.quantity_unit),quantity_kind=coalesce(excluded.quantity_kind,atlas.crop_observations.quantity_kind),
        stand_percent=coalesce(excluded.stand_percent,atlas.crop_observations.stand_percent),condition=coalesce(excluded.condition,atlas.crop_observations.condition),
        confidence=excluded.confidence,note=coalesce(excluded.note,atlas.crop_observations.note),metadata=atlas.crop_observations.metadata||excluded.metadata,updated_at=now()
    returning * into v_observation;
  end if;

  if v_life_cycle<>'perennial' and v_establishment_date is null then v_unknowns:=v_unknowns||'"establishment_date"'::jsonb; end if;
  if v_placement.id is null then v_unknowns:=v_unknowns||'"placement"'::jsonb; end if;
  if coalesce(v_expected,v_observed_quantity) is null then v_unknowns:=v_unknowns||'"quantity"'::jsonb; end if;
  if v_stage is null then v_unknowns:=v_unknowns||'"stage"'::jsonb; end if;

  return jsonb_build_object(
    'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'cropCycleId',v_cycle.id,'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,
    'objectContentId',v_content.id,'placementId',v_placement.id,'observationId',v_observation.id,
    'recorded',jsonb_strip_nulls(jsonb_build_object(
      'establishmentKind',v_establishment_kind,'establishmentDate',v_establishment_date,
      'placementMode',v_placement.placement_mode,'placementSummary',atlas.crop_placement_summary_v1(v_placement.placement_mode,v_placement.row_count,v_placement.row_length_ft,v_placement.area_sqft,v_placement.explicit_plant_count,v_placement.clump_count,v_placement.placement_label),
      'expectedQuantity',v_placement.expected_quantity,'expectedQuantityKind',v_placement.expected_quantity_kind,'expectedQuantityUnit',v_placement.expected_quantity_unit,
      'observedDate',v_observation.observed_date,'stage',v_observation.stage,'observedQuantity',v_observation.observed_quantity,'condition',v_observation.condition
    )),
    'unknowns',v_unknowns
  );
end;
$$;

revoke all on function atlas.record_crop_occupancy_note_v1(jsonb) from public;
grant execute on function atlas.record_crop_occupancy_note_v1(jsonb) to authenticated,service_role;