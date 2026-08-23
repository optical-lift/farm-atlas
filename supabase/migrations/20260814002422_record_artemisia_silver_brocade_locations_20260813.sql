DO $$
DECLARE
  v_farm_id uuid;
  v_lineage_id uuid;
BEGIN
  SELECT id INTO v_farm_id FROM atlas.farms WHERE stable_key = 'elm_farm';

  INSERT INTO atlas.plant_lineages (
    farm_id, stable_key, lineage_name, common_name, botanical_name,
    story, legacy_status, metadata
  ) VALUES (
    v_farm_id,
    'artemisia_stelleriana_silver_brocade',
    'Artemisia stelleriana Silver Brocade',
    'Silver Brocade artemisia',
    'Artemisia stelleriana Silver Brocade',
    'Silvery perennial at Elm identified from the August 13, 2026 owner photo and conversation; tracked as a living perennial planting.',
    ARRAY['Elm perennial'],
    jsonb_build_object('identity_source','owner_photo_conversation_2026-08-13','recorded_by','chatgpt','recorded_at','2026-08-13')
  )
  ON CONFLICT (farm_id, stable_key) DO UPDATE SET
    lineage_name = EXCLUDED.lineage_name,
    common_name = EXCLUDED.common_name,
    botanical_name = EXCLUDED.botanical_name,
    story = EXCLUDED.story,
    metadata = atlas.plant_lineages.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_lineage_id;

  INSERT INTO atlas.plant_instances (
    lineage_id, farm_id, object_id, stable_key, label,
    quantity, unit, status, note, metadata
  )
  SELECT
    v_lineage_id,
    v_farm_id,
    go.id,
    'curve_garden_artemisia_silver_brocade',
    'Artemisia stelleriana Silver Brocade',
    2,
    'plants',
    'planted',
    '2 living plants in the Curve Garden perennial strip, confirmed by owner August 13, 2026.',
    jsonb_build_object('source','owner_report_2026-08-13','inventory_type','living_perennial','location_confirmed_by_owner',true)
  FROM atlas.growing_objects go
  WHERE go.farm_id = v_farm_id AND go.stable_key = 'curve_garden_perennial_strip'
  ON CONFLICT (farm_id, stable_key) DO UPDATE SET
    lineage_id = EXCLUDED.lineage_id,
    object_id = EXCLUDED.object_id,
    label = EXCLUDED.label,
    quantity = EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    metadata = atlas.plant_instances.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO atlas.plant_instances (
    lineage_id, farm_id, object_id, stable_key, label,
    quantity, unit, status, note, metadata
  )
  SELECT
    v_lineage_id,
    v_farm_id,
    go.id,
    'berry_walk_crescent_artemisia_silver_brocade',
    'Artemisia stelleriana Silver Brocade',
    1,
    'plant',
    'planted',
    '1 living plant in the Berry Walk Crescent Moon, confirmed by owner August 13, 2026.',
    jsonb_build_object('source','owner_report_2026-08-13','inventory_type','living_perennial','location_confirmed_by_owner',true)
  FROM atlas.growing_objects go
  WHERE go.farm_id = v_farm_id AND go.stable_key = 'berry_walk_crescent_moon'
  ON CONFLICT (farm_id, stable_key) DO UPDATE SET
    lineage_id = EXCLUDED.lineage_id,
    object_id = EXCLUDED.object_id,
    label = EXCLUDED.label,
    quantity = EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    metadata = atlas.plant_instances.metadata || EXCLUDED.metadata,
    updated_at = now();
END $$;