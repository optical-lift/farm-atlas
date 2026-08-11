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
  v_prepare_requirement_count integer;
  v_briefing_body text;
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
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_kale IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: fall kale readiness source missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.tasks task
    WHERE task.id=v_kale
      AND task.status='done'
      AND task.visibility_scope='system_internal'
      AND task.metadata->>'transplant_readiness_status'='already_potted'
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: fall kale stale readiness source was not retired from canonical crop truth';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.task_crop_cycles link
    JOIN atlas.crop_cycles cycle ON cycle.id=link.crop_cycle_id
    WHERE link.task_id=v_kale
      AND link.role='observes'
      AND cycle.cycle_state IN ('hardening_off','potted_up','transplanted','established')
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: fall kale readiness is not linked to the advanced canonical crop cycle';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.worker_day_cues cue
    WHERE cue.cue_kind='observation'
      AND cue.result_contract->>'taskId'=v_kale::text
      AND cue.status='resolved'
      AND cue.response->>'source'='canonical_state_reconciliation'
      AND cue.response->>'readiness'='already_potted'
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: fall kale observation cue did not reconcile to current reality';
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
    FROM atlas.task_resource_requirements requirement
    JOIN atlas.resources resource ON resource.id=requirement.resource_id
    WHERE requirement.task_id=v_snow
      AND requirement.move_role='container'
      AND resource.stable_key='pot_up_tray_200_cell'
      AND requirement.quantity_needed=3
      AND requirement.unit='trays'
  ) OR NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements requirement
    JOIN atlas.resources resource ON resource.id=requirement.resource_id
    WHERE requirement.task_id=v_snow
      AND requirement.move_role='container'
      AND resource.stable_key='pot_up_tray_120_cell'
      AND requirement.quantity_needed=1
      AND requirement.unit='tray'
  ) OR NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements requirement
    JOIN atlas.resources resource ON resource.id=requirement.resource_id
    WHERE requirement.task_id=v_snow
      AND requirement.move_role='growing_medium'
      AND resource.stable_key='potting_mix'
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Snow exact container/medium requirement branches are incomplete';
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
    AND status IN ('open','blocked','done')
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT id INTO v_harvest
  FROM atlas.tasks
  WHERE title='Thursday morning harvest at Karianne’s garden for bouquet bar'
    AND status IN ('open','blocked','done')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_prepare IS NULL OR v_harvest IS NULL THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon task pair missing';
  END IF;

  IF coalesce((SELECT metadata->>'address' FROM atlas.tasks WHERE id=v_prepare),'') NOT ILIKE '%Lebanon%'
     OR coalesce((SELECT metadata->>'address' FROM atlas.tasks WHERE id=v_harvest),'') NOT ILIKE '%Lebanon%' THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon destination truth missing';
  END IF;

  SELECT count(*)::integer INTO v_prepare_requirement_count
  FROM atlas.task_resource_requirements requirement
  JOIN atlas.resources resource ON resource.id=requirement.resource_id
  WHERE requirement.task_id=v_prepare
    AND requirement.requirement_role='required'
    AND (
      (resource.label='Saw' AND requirement.quantity_needed=1)
      OR (resource.label='Air compressor' AND requirement.quantity_needed=1)
      OR (resource.label='Metal rake with wood handle' AND requirement.quantity_needed=1)
      OR (resource.label='Black florist buckets' AND requirement.quantity_needed=5)
    );

  IF v_prepare_requirement_count <> 4 THEN
    RAISE EXCEPTION 'Day acceptance preflight: Lebanon preparation load is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements requirement
    JOIN atlas.resources resource ON resource.id=requirement.resource_id
    WHERE requirement.task_id=v_harvest
      AND requirement.requirement_role='required'
      AND resource.label='Black florist buckets'
      AND requirement.quantity_needed=7
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Thursday Lebanon harvest does not require 7 black florist buckets';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.worker_day_cues cue
    WHERE cue.anchor_task_id=v_harvest
      AND cue.cue_kind='requirement'
      AND cue.anchor_kind='before_task'
      AND cue.recovery_policy='block'
      AND cue.result_contract->>'kind'='requirement_confirmation_v1'
      AND cue.payload->'items' @> '["7 black florist buckets"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Thursday Lebanon departure cue is missing its canonical 7-bucket requirement';
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

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.worker_day_cues cue
    WHERE cue.service_date='2026-08-13'
      AND cue.cue_kind='briefing'
      AND cue.anchor_kind='first_open'
      AND cue.recovery_policy='expire'
      AND cue.payload->>'dynamicProjectId'=v_event::text
  ) THEN
    RAISE EXCEPTION 'Day acceptance preflight: Aug 13 first-open event briefing missing';
  END IF;

  SELECT atlas.event_day_briefing_body_v1(v_event, '23e98e5e-16ca-40d8-872c-c77e06baa167'::uuid, '2026-08-13'::date)
    INTO v_briefing_body;

  IF coalesce(nullif(btrim(v_briefing_body),''),'')='' THEN
    RAISE EXCEPTION 'Day acceptance preflight: Aug 13 dynamic briefing body is empty';
  END IF;
END
$$;

-- Read-only proof payload for manual/CI inspection.
SELECT jsonb_build_object(
  'ok', true,
  'proof', jsonb_build_array(
    'MG2 Weed Card exists',
    'fall kale stale readiness is retired from canonical crop truth and its observation cue is reconciled',
    'Snow in Summer has exact 3 x 200-cell + 1 x 120-cell + potting-mix branches and 4 lit tray positions',
    'Lebanon prepare and harvest tasks retain destination truth and canonical load requirements',
    'Thursday harvest has a blocking 7-bucket departure cue',
    'both Lebanon tasks belong to the Aug 13 Bloom Bar event',
    'Aug 13 has a dynamic first-open briefing with a non-empty current body'
  )
) AS atlas_day_choreography_acceptance_preflight_v1;

ROLLBACK;
