BEGIN;

DO $$
DECLARE
  v_mg2 uuid;
  v_kale uuid;
  v_snow uuid;
  v_prepare uuid;
  v_harvest uuid;
  v_event uuid;
  v_resource_count integer;
  v_resource_roles text[];
BEGIN
  SELECT id INTO v_mg2
  FROM atlas.growing_objects
  WHERE stable_key='mg2'
  LIMIT 1;

  IF v_mg2 IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: MG2 object missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.weed_cards WHERE object_id=v_mg2
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: MG2 Weed Card missing';
  END IF;

  SELECT id INTO v_kale
  FROM atlas.tasks
  WHERE task_type='transplant_readiness'
    AND metadata->>'crop_profile_stable_key'='fall_kale_seedling'
    AND status IN ('open','blocked')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_kale IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: fall kale readiness source missing';
  END IF;

  SELECT id INTO v_snow
  FROM atlas.tasks
  WHERE title ILIKE 'Pot up%Snow in Summer%'
    AND status IN ('open','blocked')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_snow IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: Snow in Summer move missing';
  END IF;

  SELECT count(*)::integer,
         array_agg(DISTINCT move_role ORDER BY move_role)
    INTO v_resource_count, v_resource_roles
  FROM atlas.task_resource_requirements
  WHERE task_id=v_snow;

  IF v_resource_count <> 3 THEN
    RAISE EXCEPTION 'Day acceptance preflight: expected 3 Snow resource requirements, found %', v_resource_count;
  END IF;

  IF NOT (coalesce(v_resource_roles,'{}'::text[]) @> ARRAY['container','growing_medium']::text[]) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Snow resource roles incomplete: %', v_resource_roles;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.task_capacity_requirements requirement
    JOIN atlas.capacity_pools pool ON pool.id=requirement.capacity_pool_id
    WHERE requirement.task_id=v_snow
      AND requirement.capacity_role='destination'
      AND pool.capacity_kind='lit_tray_positions'
      AND requirement.quantity_needed=4
      AND requirement.unit='tray_positions'
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Snow exact 4-position destination capacity missing';
  END IF;

  SELECT id INTO v_prepare
  FROM atlas.tasks
  WHERE title='Prepare Karianne’s garden for Thursday bouquet-bar harvest'
    AND status IN ('open','blocked')
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT id INTO v_harvest
  FROM atlas.tasks
  WHERE title='Thursday morning harvest at Karianne’s garden for bouquet bar'
    AND status IN ('open','blocked')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_prepare IS NULL OR v_harvest IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon task pair missing';
  END IF;

  IF coalesce((SELECT metadata->>'address' FROM atlas.tasks WHERE id=v_prepare),'') NOT ILIKE '%Lebanon%'
     OR coalesce((SELECT metadata->>'address' FROM atlas.tasks WHERE id=v_harvest),'') NOT ILIKE '%Lebanon%' THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon destination truth missing';
  END IF;

  SELECT id INTO v_event
  FROM atlas.projects
  WHERE status='active'
    AND portfolio_type='event'
    AND target_date='2026-08-13'
    AND title ILIKE '%Bloom Bar%'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: Aug 13 Bloom Bar event project missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.project_task_links WHERE project_id=v_event AND task_id=v_prepare
  ) OR NOT EXISTS (
    SELECT 1 FROM atlas.project_task_links WHERE project_id=v_event AND task_id=v_harvest
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon work is not linked to the Aug 13 Bloom Bar';
  END IF;
END
$$;

-- Read-only proof payload for manual/CI inspection.
SELECT jsonb_build_object(
  'ok', true,
  'proof', jsonb_build_array(
    'MG2 Weed Card exists',
    'fall kale readiness source exists',
    'Snow in Summer has 3 resource requirements plus exact 4 lit tray-position destination capacity',
    'Lebanon prepare and harvest tasks retain Lebanon destination truth',
    'both Lebanon tasks belong to the Aug 13 Bloom Bar event'
  )
) AS atlas_day_choreography_acceptance_preflight_v1;

ROLLBACK;
