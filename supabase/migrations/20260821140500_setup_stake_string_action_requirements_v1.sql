do $$
declare
  v_farm_id uuid;
begin
  select id into strict v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  insert into atlas.resources (
    farm_id, stable_key, label, resource_type, resource_category, status,
    quantity, unit, consumable, restock_needed, metadata
  ) values
    (v_farm_id, 'wooden_layout_stakes', 'Wooden stakes', 'supply', 'layout', 'available', 120, 'stakes', false, false,
      jsonb_build_object('source', 'owner_confirmed_layout_stock', 'purpose', 'measure_stake_string')),
    (v_farm_id, 'layout_string', 'String', 'supply', 'layout', 'unknown', null, null, true, false,
      jsonb_build_object('source', 'stake_string_setup_recipe_v1', 'purpose', 'measure_stake_string')),
    (v_farm_id, 'layout_scissors', 'Scissors', 'tool', 'layout', 'unknown', null, null, false, false,
      jsonb_build_object('source', 'stake_string_setup_recipe_v1', 'purpose', 'measure_stake_string')),
    (v_farm_id, 'layout_measuring_tape', 'Measuring tape', 'tool', 'layout', 'unknown', null, null, false, false,
      jsonb_build_object('source', 'stake_string_setup_recipe_v1', 'purpose', 'measure_stake_string'))
  on conflict (farm_id, stable_key) do update
  set
    label = excluded.label,
    resource_type = excluded.resource_type,
    resource_category = excluded.resource_category,
    updated_at = now(),
    metadata = coalesce(atlas.resources.metadata, '{}'::jsonb) || excluded.metadata;

  insert into atlas.action_requirement_templates (
    farm_id, stable_key, action_type, label, applies_to_task_type,
    required_resource_categories, optional_resource_categories,
    required_resource_keys, optional_resource_keys,
    creates_follow_up_task_types, hard_parts, unlocks, notes, metadata
  ) values (
    v_farm_id,
    'measure_stake_string_v1',
    'measure_stake_string',
    'Stake + String Beds',
    'site_layout',
    array['layout']::text[],
    '{}'::text[],
    array['wooden_layout_stakes','layout_string','layout_scissors','layout_measuring_tape']::text[],
    '{}'::text[],
    '{}'::text[],
    array['Keep bed and walkway widths physically legible before mowing.']::text[],
    array['Mowing can follow the established lanes without guessing.']::text[],
    'Canonical visual/resource recipe for measure + stake/string site-layout work.',
    jsonb_build_object(
      'card_family', 'setup',
      'card_language', 'Stake + String Beds',
      'display_method', 'task_card_lab_setup_v1',
      'owner_confirmed_at', '2026-08-21'
    )
  )
  on conflict (farm_id, stable_key) do update
  set
    action_type = excluded.action_type,
    label = excluded.label,
    applies_to_task_type = excluded.applies_to_task_type,
    required_resource_categories = excluded.required_resource_categories,
    optional_resource_categories = excluded.optional_resource_categories,
    required_resource_keys = excluded.required_resource_keys,
    optional_resource_keys = excluded.optional_resource_keys,
    hard_parts = excluded.hard_parts,
    unlocks = excluded.unlocks,
    notes = excluded.notes,
    metadata = coalesce(atlas.action_requirement_templates.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
end $$;
