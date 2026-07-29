create or replace function atlas.normalize_crop_identity_v1(p_label text, p_variety text default null)
returns text
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $$
declare
  v_label text := lower(btrim(coalesce(p_label,'')));
  v_variety text := lower(btrim(coalesce(p_variety,'')));
begin
  v_label := regexp_replace(v_label, '\mbearded iris\M', 'iris', 'gi');
  v_label := regexp_replace(v_label, '\msunflowers\M', 'sunflower', 'gi');
  v_label := regexp_replace(v_label, '\mzinnias\M', 'zinnia', 'gi');
  v_label := regexp_replace(v_label, '\mdahlias\M', 'dahlia', 'gi');
  v_label := regexp_replace(v_label, '\mbeans\M', 'bean', 'gi');
  v_label := regexp_replace(v_label, '\s+', ' ', 'g');
  v_variety := regexp_replace(v_variety, '\s+', ' ', 'g');

  if v_variety <> '' and position(v_variety in v_label)=0 and position(v_label in v_variety)=0 then
    return btrim(v_variety || ' ' || v_label);
  end if;
  return nullif(v_label,'');
end;
$$;

create or replace function atlas.try_date_v1(p_value text)
returns date
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $$
begin
  if nullif(btrim(coalesce(p_value,'')), '') is null then return null; end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function atlas.occupancy_confidence_v1(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case lower(btrim(coalesce(p_value,'')))
    when 'owner_confirmed' then 'owner_confirmed'
    when 'confirmed' then 'owner_confirmed'
    when 'high' then 'high'
    when 'low' then 'low'
    else 'medium'
  end;
$$;

create or replace function atlas.ensure_crop_cycle_for_content_v1(p_object_content_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_content atlas.object_contents%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_claim atlas.planting_claims%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_identity text;
  v_start_date date;
  v_observed_date date;
  v_life_cycle text;
  v_start_method text;
  v_stage text;
  v_key text;
begin
  select oc.* into v_content from atlas.object_contents oc where oc.id=p_object_content_id;
  if v_content.id is null then
    raise exception 'Object content not found.' using errcode='P0002';
  end if;

  select go.* into v_object from atlas.growing_objects go where go.id=v_content.object_id;
  if v_content.planting_claim_id is not null then
    select pc.* into v_claim from atlas.planting_claims pc where pc.id=v_content.planting_claim_id;
  end if;

  v_identity := atlas.normalize_crop_identity_v1(v_content.content_label,v_content.variety);
  v_observed_date := coalesce(
    atlas.try_date_v1(v_content.metadata->>'observed_date'),
    atlas.try_date_v1(v_content.metadata->>'verified_date'),
    atlas.try_date_v1(v_content.metadata->>'photo_truth_date')
  );
  v_start_date := coalesce(v_content.planted_date,v_claim.planted_date,v_observed_date);
  v_life_cycle := case
    when lower(coalesce(v_content.content_type,'')) like '%perennial%' then 'perennial'
    else null
  end;
  v_start_method := lower(coalesce(v_content.start_method,v_claim.planting_method,''));
  v_stage := atlas.crop_stage_from_state_v1(v_content.status,v_life_cycle);

  select cc.* into v_cycle
  from atlas.crop_cycles cc
  where cc.object_content_id=v_content.id
  order by
    (cc.lifecycle_status='active') desc,
    (atlas.normalize_crop_identity_v1(cc.crop_label,cc.variety)=v_identity) desc,
    (coalesce(cc.sown_date,cc.planted_date)=v_start_date) desc,
    cc.updated_at desc
  limit 1;

  if v_cycle.id is null then
    select cc.* into v_cycle
    from atlas.crop_cycles cc
    where cc.object_id=v_content.object_id
      and cc.lifecycle_status='active'
      and atlas.normalize_crop_identity_v1(cc.crop_label,cc.variety)=v_identity
    order by
      (coalesce(cc.sown_date,cc.planted_date)=v_start_date) desc,
      (coalesce(cc.sown_date,cc.planted_date) is null and v_start_date is null) desc,
      cc.updated_at desc
    limit 1;
  end if;

  if v_cycle.id is null then
    v_key := 'occupancy:' || v_object.stable_key || ':' || substr(md5(coalesce(v_identity,v_content.id::text)||':'||coalesce(v_start_date::text,'unknown')||':'||v_content.id::text),1,24);
    insert into atlas.crop_cycles(
      farm_id,object_id,planting_claim_id,crop_profile_id,crop_cycle_key,
      crop_label,variety,cycle_state,lifecycle_status,sown_date,planted_date,
      object_content_id,metadata
    ) values (
      v_content.farm_id,v_content.object_id,v_content.planting_claim_id,v_content.crop_profile_id,v_key,
      v_content.content_label,v_content.variety,coalesce(v_stage,'planned'),'active',
      case when v_start_method in ('direct_sow','direct sow','sow','seed','seeded') then v_start_date else null end,
      case when v_start_method in ('direct_sow','direct sow','sow','seed','seeded') then null else v_start_date end,
      v_content.id,
      jsonb_build_object('source','crop_occupancy_backfill_v1','identity',v_identity,'date_source',case when v_content.planted_date is not null then 'object_content' when v_claim.planted_date is not null then 'planting_claim' when v_observed_date is not null then 'observation' else 'unknown' end)
    ) returning * into v_cycle;
  elsif v_cycle.object_content_id is null then
    update atlas.crop_cycles
    set object_content_id=v_content.id,
        crop_profile_id=coalesce(crop_profile_id,v_content.crop_profile_id),
        planting_claim_id=coalesce(planting_claim_id,v_content.planting_claim_id),
        updated_at=now()
    where id=v_cycle.id
    returning * into v_cycle;
  end if;

  update atlas.object_contents
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'crop_occupancy_cycle_id',v_cycle.id,
        'crop_occupancy_identity',v_identity,
        'crop_occupancy_reconciled_at',now()
      ),
      updated_at=now()
  where id=v_content.id;

  insert into atlas.crop_occupancy_evidence(
    farm_id,object_id,crop_cycle_id,object_content_id,planting_claim_id,
    evidence_role,evidence_date,confidence,metadata
  ) values (
    v_content.farm_id,v_content.object_id,v_cycle.id,v_content.id,v_content.planting_claim_id,
    'identity',coalesce(v_start_date,v_observed_date),atlas.occupancy_confidence_v1(v_content.confidence),
    jsonb_build_object('content_label',v_content.content_label,'variety',v_content.variety,'content_type',v_content.content_type,'status',v_content.status)
  ) on conflict do nothing;

  if v_start_date is not null or v_content.planting_claim_id is not null then
    insert into atlas.crop_occupancy_evidence(
      farm_id,object_id,crop_cycle_id,object_content_id,planting_claim_id,
      evidence_role,evidence_date,confidence,metadata
    ) values (
      v_content.farm_id,v_content.object_id,v_cycle.id,v_content.id,v_content.planting_claim_id,
      'planting',v_start_date,atlas.occupancy_confidence_v1(v_content.confidence),
      jsonb_build_object('start_method',nullif(v_start_method,''),'source_date',v_start_date)
    ) on conflict do nothing;
  end if;

  return v_cycle.id;
end;
$$;

create or replace function atlas.backfill_crop_placement_v1(p_crop_cycle_id uuid,p_object_content_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_content atlas.object_contents%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_claim atlas.planting_claims%rowtype;
  v_claim_object atlas.planting_claim_objects%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_placement atlas.crop_placements%rowtype;
  v_rows numeric;
  v_row_length numeric;
  v_area numeric;
  v_count numeric;
  v_clumps numeric;
  v_spacing numeric;
  v_ppsf numeric;
  v_expected numeric;
  v_expected_kind text := 'unknown';
  v_expected_unit text;
  v_expected_basis text;
  v_mode text := 'unknown';
  v_label text;
  v_unit text;
  v_coverage_kind text;
  v_coverage_amount numeric;
  v_coverage_unit text;
  v_confidence text := 'medium';
  v_content_type text;
  v_i integer;
  v_foot integer;
begin
  select cc.* into v_cycle from atlas.crop_cycles cc where cc.id=p_crop_cycle_id;
  if v_cycle.id is null or v_cycle.object_id is null then return null; end if;
  select go.* into v_object from atlas.growing_objects go where go.id=v_cycle.object_id;

  if p_object_content_id is not null then
    select oc.* into v_content from atlas.object_contents oc where oc.id=p_object_content_id;
  elsif v_cycle.object_content_id is not null then
    select oc.* into v_content from atlas.object_contents oc where oc.id=v_cycle.object_content_id;
  end if;

  if coalesce(v_content.planting_claim_id,v_cycle.planting_claim_id) is not null then
    select pc.* into v_claim from atlas.planting_claims pc where pc.id=coalesce(v_content.planting_claim_id,v_cycle.planting_claim_id);
    select pco.* into v_claim_object
    from atlas.planting_claim_objects pco
    where pco.planting_claim_id=v_claim.id and pco.object_id=v_cycle.object_id
    order by pco.created_at limit 1;
  end if;

  if coalesce(v_content.crop_profile_id,v_cycle.crop_profile_id,v_claim.crop_profile_id) is not null then
    select cp.* into v_profile from atlas.crop_profiles cp where cp.id=coalesce(v_content.crop_profile_id,v_cycle.crop_profile_id,v_claim.crop_profile_id);
  end if;

  v_rows := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'row_count'),
    atlas.try_numeric_v1(v_content.metadata->>'rows'),
    case when lower(coalesce(v_claim_object.coverage_unit,'')) in ('row','rows') then v_claim_object.coverage_amount end,
    case when lower(coalesce(v_cycle.coverage_unit,'')) in ('row','rows') then v_cycle.coverage_amount end
  );
  v_coverage_kind := coalesce(v_claim_object.coverage_kind,v_cycle.coverage_kind,v_content.metadata->>'coverage_kind');
  v_coverage_amount := coalesce(v_claim_object.coverage_amount,v_cycle.coverage_amount,atlas.try_numeric_v1(v_content.metadata->>'coverage_amount'));
  v_coverage_unit := lower(coalesce(v_claim_object.coverage_unit,v_cycle.coverage_unit,v_content.metadata->>'coverage_unit',''));

  if v_rows is null and lower(coalesce(v_coverage_kind,''))='whole_object'
     and v_profile.rows_per_3ft_bed is not null and v_object.width_ft is not null then
    v_rows := v_profile.rows_per_3ft_bed * v_object.width_ft / 3;
  end if;

  v_row_length := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'row_length_ft'),
    case when lower(coalesce(v_coverage_unit,'')) in ('ft','feet','linear_ft','row_ft') then v_coverage_amount end,
    v_claim.bed_length_ft,
    case when v_rows is not null then v_object.length_ft end
  );
  v_area := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'area_sqft'),
    atlas.try_numeric_v1(v_content.metadata->>'square_feet'),
    case when v_coverage_unit in ('sqft','sq_ft','square_feet','square feet') then v_coverage_amount end,
    case when lower(coalesce(v_coverage_kind,''))='whole_object' then v_object.area_sqft end
  );
  v_unit := lower(coalesce(v_claim.unit,v_content.metadata->>'unit',v_content.metadata->>'claim_unit',''));
  v_count := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'count'),
    atlas.try_numeric_v1(v_content.metadata->>'quantity'),
    atlas.try_numeric_v1(v_content.metadata->>'plant_count'),
    atlas.try_numeric_v1(v_content.metadata->>'plants_present'),
    atlas.try_numeric_v1(v_content.metadata->>'claim_amount'),
    case when v_unit in ('plant','plants','transplant','transplants','start','starts','tuber','tubers','division','divisions','seed','seeds') then v_claim.amount end
  );
  v_clumps := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'clump_count'),
    case when v_unit in ('clump','clumps','crown','crowns') then v_claim.amount end
  );
  v_spacing := coalesce(atlas.try_numeric_v1(v_content.metadata->>'spacing_in'),v_profile.in_row_spacing_in);
  v_ppsf := coalesce(atlas.try_numeric_v1(v_content.metadata->>'plants_per_sqft'),v_profile.plants_per_sqft);
  v_label := coalesce(
    nullif(v_content.metadata->>'placement',''),
    nullif(v_content.metadata->>'location',''),
    nullif(v_content.metadata->>'distribution','')
  );
  v_confidence := atlas.occupancy_confidence_v1(coalesce(v_content.confidence,v_claim.confidence));
  v_content_type := lower(coalesce(v_content.content_type,''));

  if v_rows is not null then
    v_mode := case when v_object.length_ft is not null and v_row_length=v_object.length_ft then 'full_rows' else 'partial_rows' end;
  elsif v_area is not null and v_coverage_unit in ('sqft','sq_ft','square_feet','square feet') then
    v_mode := 'square_foot_block';
  elsif v_clumps is not null or v_unit in ('clump','clumps','crown','crowns') then
    v_mode := 'clumps';
  elsif v_count is not null and v_unit in ('plant','plants','transplant','transplants','start','starts','tuber','tubers','division','divisions') then
    v_mode := 'individual_plants';
  elsif lower(coalesce(v_label,'')) like '%edge%' then
    v_mode := 'edge_strip';
  elsif lower(coalesce(v_label,'')) ~ '(scatter|throughout|several|pocket)' then
    v_mode := 'scattered';
  elsif lower(coalesce(v_coverage_kind,''))='whole_object' then
    v_mode := 'broadcast_area';
  elsif v_content_type like '%perennial%' then
    v_mode := 'clumps';
  end if;

  if v_count is not null then
    v_expected := v_count;
    v_expected_kind := 'recorded';
    v_expected_unit := case when v_unit in ('seed','seeds') then 'seeds' else 'plants' end;
    v_expected_basis := case when v_unit in ('seed','seeds') then 'recorded seeds sown' else 'recorded plant count' end;
  elsif v_clumps is not null then
    v_expected := v_clumps;
    v_expected_kind := 'recorded';
    v_expected_unit := 'clumps';
    v_expected_basis := 'recorded clump count';
  elsif v_rows is not null and v_row_length is not null and v_spacing is not null then
    v_expected := round(v_rows*v_row_length*12/v_spacing);
    v_expected_kind := 'calculated';
    v_expected_unit := 'plants';
    v_expected_basis := 'rows × row length ÷ in-row spacing';
  elsif v_area is not null and v_ppsf is not null then
    v_expected := round(v_area*v_ppsf);
    v_expected_kind := 'calculated';
    v_expected_unit := 'plants';
    v_expected_basis := 'square feet × plants per square foot';
  end if;

  insert into atlas.crop_placements(
    farm_id,object_id,crop_cycle_id,planting_claim_id,object_content_id,placement_key,
    placement_mode,placement_label,row_count,row_length_ft,area_sqft,explicit_plant_count,
    clump_count,spacing_in,plants_per_sqft,expected_quantity,expected_quantity_kind,
    expected_quantity_unit,expected_quantity_basis,confidence,metadata
  ) values (
    v_cycle.farm_id,v_cycle.object_id,v_cycle.id,coalesce(v_content.planting_claim_id,v_cycle.planting_claim_id),v_content.id,'primary',
    v_mode,v_label,v_rows,v_row_length,v_area,case when v_expected_unit='plants' and v_expected_kind='recorded' then v_count end,
    v_clumps,v_spacing,v_ppsf,v_expected,v_expected_kind,v_expected_unit,v_expected_basis,v_confidence,
    jsonb_strip_nulls(jsonb_build_object(
      'source','crop_occupancy_backfill_v1','coverage_kind',v_coverage_kind,'coverage_amount',v_coverage_amount,
      'coverage_unit',nullif(v_coverage_unit,''),'claim_unit',nullif(v_unit,''),'source_object_content_id',v_content.id
    ))
  )
  on conflict (crop_cycle_id,placement_key) do update
  set planting_claim_id=coalesce(atlas.crop_placements.planting_claim_id,excluded.planting_claim_id),
      object_content_id=coalesce(atlas.crop_placements.object_content_id,excluded.object_content_id),
      placement_mode=case when atlas.crop_placements.placement_mode='unknown' then excluded.placement_mode else atlas.crop_placements.placement_mode end,
      placement_label=coalesce(atlas.crop_placements.placement_label,excluded.placement_label),
      row_count=coalesce(atlas.crop_placements.row_count,excluded.row_count),
      row_length_ft=coalesce(atlas.crop_placements.row_length_ft,excluded.row_length_ft),
      area_sqft=coalesce(atlas.crop_placements.area_sqft,excluded.area_sqft),
      explicit_plant_count=coalesce(atlas.crop_placements.explicit_plant_count,excluded.explicit_plant_count),
      clump_count=coalesce(atlas.crop_placements.clump_count,excluded.clump_count),
      spacing_in=coalesce(atlas.crop_placements.spacing_in,excluded.spacing_in),
      plants_per_sqft=coalesce(atlas.crop_placements.plants_per_sqft,excluded.plants_per_sqft),
      expected_quantity=case
        when atlas.crop_placements.expected_quantity_kind='recorded' then atlas.crop_placements.expected_quantity
        when excluded.expected_quantity_kind='recorded' then excluded.expected_quantity
        else coalesce(atlas.crop_placements.expected_quantity,excluded.expected_quantity)
      end,
      expected_quantity_kind=case
        when atlas.crop_placements.expected_quantity_kind='recorded' then 'recorded'
        when excluded.expected_quantity_kind='recorded' then 'recorded'
        when atlas.crop_placements.expected_quantity is not null then atlas.crop_placements.expected_quantity_kind
        else excluded.expected_quantity_kind
      end,
      expected_quantity_unit=coalesce(atlas.crop_placements.expected_quantity_unit,excluded.expected_quantity_unit),
      expected_quantity_basis=coalesce(atlas.crop_placements.expected_quantity_basis,excluded.expected_quantity_basis),
      metadata=atlas.crop_placements.metadata||excluded.metadata,
      updated_at=now()
  returning * into v_placement;

  if v_rows is not null and v_row_length is not null
     and floor(v_rows)=v_rows and floor(v_row_length)=v_row_length
     and v_rows between 1 and 26 and v_row_length between 1 and 300 then
    for v_i in 1..v_rows::integer loop
      for v_foot in 1..v_row_length::integer loop
        insert into atlas.crop_placement_cells(placement_id,cell_key,bed_column,foot_number,metadata)
        values (v_placement.id,chr(64+v_i)||v_foot::text,chr(64+v_i),v_foot,jsonb_build_object('source','row_placement_backfill_v1'))
        on conflict (placement_id,cell_key) do nothing;
      end loop;
    end loop;
  end if;

  if v_content.id is not null and (v_rows is not null or v_area is not null or v_count is not null or v_clumps is not null or v_label is not null) then
    insert into atlas.crop_occupancy_evidence(
      farm_id,object_id,crop_cycle_id,object_content_id,planting_claim_id,evidence_role,evidence_date,confidence,metadata
    ) values (
      v_cycle.farm_id,v_cycle.object_id,v_cycle.id,v_content.id,coalesce(v_content.planting_claim_id,v_cycle.planting_claim_id),
      'placement',coalesce(v_content.planted_date,v_claim.planted_date),v_confidence,
      jsonb_build_object('placement_id',v_placement.id,'placement_mode',v_mode)
    ) on conflict do nothing;
  end if;

  return v_placement.id;
end;
$$;

create or replace function atlas.backfill_crop_observation_v1(p_crop_cycle_id uuid,p_object_content_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_content atlas.object_contents%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_placement_id uuid;
  v_observation atlas.crop_observations%rowtype;
  v_date date;
  v_stage text;
  v_quantity numeric;
  v_quantity_unit text;
  v_quantity_kind text;
  v_stand numeric;
  v_condition text;
  v_life_cycle text;
  v_confidence text;
begin
  select cc.* into v_cycle from atlas.crop_cycles cc where cc.id=p_crop_cycle_id;
  select oc.* into v_content from atlas.object_contents oc where oc.id=p_object_content_id;
  if v_cycle.id is null or v_content.id is null then return null; end if;
  if coalesce(v_content.crop_profile_id,v_cycle.crop_profile_id) is not null then
    select cp.* into v_profile from atlas.crop_profiles cp where cp.id=coalesce(v_content.crop_profile_id,v_cycle.crop_profile_id);
  end if;
  select cp.id into v_placement_id from atlas.crop_placements cp where cp.crop_cycle_id=v_cycle.id order by cp.created_at limit 1;

  v_date := coalesce(
    atlas.try_date_v1(v_content.metadata->>'observed_date'),
    atlas.try_date_v1(v_content.metadata->>'verified_date'),
    atlas.try_date_v1(v_content.metadata->>'photo_truth_date')
  );
  v_life_cycle := coalesce(v_profile.life_cycle,case when lower(coalesce(v_content.content_type,'')) like '%perennial%' then 'perennial' end);
  v_stage := atlas.crop_stage_from_state_v1(v_content.status,v_life_cycle);
  v_quantity := coalesce(
    atlas.try_numeric_v1(v_content.metadata->>'count'),
    atlas.try_numeric_v1(v_content.metadata->>'quantity'),
    atlas.try_numeric_v1(v_content.metadata->>'plant_count'),
    atlas.try_numeric_v1(v_content.metadata->>'plants_present')
  );
  v_quantity_unit := case when lower(coalesce(v_content.content_type,'')) like '%perennial%' and v_content.metadata ? 'clump_count' then 'clumps' else 'plants' end;
  v_quantity_kind := case when v_quantity is not null then 'count' end;
  v_stand := atlas.try_numeric_v1(v_content.metadata->>'stand_percent');
  v_condition := coalesce(
    nullif(v_content.metadata->>'stand_quality',''),
    nullif(v_content.metadata->>'germination',''),
    nullif(v_content.metadata->>'growth',''),
    nullif(v_content.metadata->>'browse_damage',''),
    nullif(v_content.status,'')
  );
  v_confidence := atlas.occupancy_confidence_v1(v_content.confidence);

  insert into atlas.crop_observations(
    farm_id,object_id,crop_cycle_id,placement_id,object_content_id,observed_date,stage,
    observed_quantity,quantity_unit,quantity_kind,stand_percent,condition,confidence,
    source_kind,source_id,note,idempotency_key,metadata
  ) values (
    v_cycle.farm_id,v_cycle.object_id,v_cycle.id,v_placement_id,v_content.id,v_date,v_stage,
    v_quantity,v_quantity_unit,v_quantity_kind,v_stand,v_condition,v_confidence,
    'object_content',v_content.id::text,v_content.note,'occupancy-backfill:'||v_content.id::text,
    jsonb_build_object('source','crop_occupancy_backfill_v1','content_type',v_content.content_type,'raw_status',v_content.status,'raw_metadata',v_content.metadata)
  )
  on conflict (farm_id,idempotency_key) do update
  set placement_id=coalesce(atlas.crop_observations.placement_id,excluded.placement_id),
      observed_date=coalesce(atlas.crop_observations.observed_date,excluded.observed_date),
      stage=coalesce(excluded.stage,atlas.crop_observations.stage),
      observed_quantity=coalesce(excluded.observed_quantity,atlas.crop_observations.observed_quantity),
      quantity_unit=coalesce(excluded.quantity_unit,atlas.crop_observations.quantity_unit),
      quantity_kind=coalesce(excluded.quantity_kind,atlas.crop_observations.quantity_kind),
      stand_percent=coalesce(excluded.stand_percent,atlas.crop_observations.stand_percent),
      condition=coalesce(excluded.condition,atlas.crop_observations.condition),
      metadata=atlas.crop_observations.metadata||excluded.metadata,
      updated_at=now()
  returning * into v_observation;

  insert into atlas.crop_occupancy_evidence(
    farm_id,object_id,crop_cycle_id,object_content_id,evidence_role,evidence_date,confidence,metadata
  ) values (
    v_cycle.farm_id,v_cycle.object_id,v_cycle.id,v_content.id,'observation',v_date,v_confidence,
    jsonb_build_object('observation_id',v_observation.id,'stage',v_stage,'quantity',v_quantity)
  ) on conflict do nothing;

  return v_observation.id;
end;
$$;

create or replace function atlas.rebuild_crop_occupancy_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  r record;
  v_cycle_id uuid;
  v_content_count integer := 0;
  v_cycle_count integer := 0;
  v_placement_count integer := 0;
  v_observation_count integer := 0;
begin
  for r in select id from atlas.object_contents order by created_at,id loop
    v_cycle_id := atlas.ensure_crop_cycle_for_content_v1(r.id);
    v_content_count := v_content_count+1;
    if atlas.backfill_crop_placement_v1(v_cycle_id,r.id) is not null then v_placement_count := v_placement_count+1; end if;
    if atlas.backfill_crop_observation_v1(v_cycle_id,r.id) is not null then v_observation_count := v_observation_count+1; end if;
  end loop;

  for r in
    select cc.id
    from atlas.crop_cycles cc
    where cc.object_id is not null
      and not exists(select 1 from atlas.crop_placements p where p.crop_cycle_id=cc.id)
    order by cc.created_at,cc.id
  loop
    if atlas.backfill_crop_placement_v1(r.id,null) is not null then v_placement_count := v_placement_count+1; end if;
  end loop;

  select count(*) into v_cycle_count from atlas.crop_cycles where object_id is not null;
  return jsonb_build_object(
    'objectContentsProcessed',v_content_count,
    'cropCycles',v_cycle_count,
    'placementWrites',v_placement_count,
    'observationWrites',v_observation_count,
    'placements',(select count(*) from atlas.crop_placements),
    'placementCells',(select count(*) from atlas.crop_placement_cells),
    'observations',(select count(*) from atlas.crop_observations),
    'evidenceRows',(select count(*) from atlas.crop_occupancy_evidence)
  );
end;
$$;

revoke all on function atlas.try_date_v1(text) from public;
revoke all on function atlas.occupancy_confidence_v1(text) from public;
revoke all on function atlas.ensure_crop_cycle_for_content_v1(uuid) from public;
revoke all on function atlas.backfill_crop_placement_v1(uuid,uuid) from public;
revoke all on function atlas.backfill_crop_observation_v1(uuid,uuid) from public;
revoke all on function atlas.rebuild_crop_occupancy_v1() from public;
grant execute on function atlas.try_date_v1(text) to authenticated,service_role;
grant execute on function atlas.occupancy_confidence_v1(text) to authenticated,service_role;
grant execute on function atlas.rebuild_crop_occupancy_v1() to service_role;

select atlas.rebuild_crop_occupancy_v1();