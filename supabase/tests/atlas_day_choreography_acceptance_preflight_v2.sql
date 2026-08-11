BEGIN;

DO $$
DECLARE
  v_anna uuid;
  v_farm uuid;
  v_snow uuid;
  v_harvest uuid;
  v_event uuid;
  v_venue uuid;
  v_iris uuid;
  v_briefing text;
  v_mismatch_count integer;
BEGIN
  SELECT fm.id,fm.farm_id INTO v_anna,v_farm
  FROM atlas.farm_memberships fm
  WHERE fm.worker_key='anna' AND fm.active=true
  ORDER BY fm.created_at
  LIMIT 1;

  IF v_anna IS NULL THEN
    RAISE EXCEPTION 'Day acceptance v2: active Anna membership missing';
  END IF;

  -- Observation sources remain provenance, never future worker tasks.
  IF EXISTS (
    SELECT 1
    FROM (VALUES (date '2026-08-15'),(date '2026-08-25')) probe(day)
    CROSS JOIN LATERAL atlas.presented_work_rows_v1(v_farm,v_anna,probe.day) row
    JOIN atlas.tasks task ON task.id=row.task_id
    WHERE task.visibility_scope='system_internal'
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: system_internal readiness provenance leaked into worker Day';
  END IF;

  SELECT task.id INTO v_snow
  FROM atlas.tasks task
  WHERE task.title ILIKE 'Pot up%Snow in Summer%'
    AND task.status IN ('open','blocked')
  ORDER BY task.created_at DESC
  LIMIT 1;

  IF v_snow IS NULL THEN
    RAISE EXCEPTION 'Day acceptance v2: Snow in Summer move missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.presented_work_rows_v1(v_farm,v_anna,date '2026-08-11') row
    WHERE row.task_id=v_snow
      AND row.presentation_state IN ('attention','presented')
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: Snow in Summer is not directly presentable on worker Day';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.grow_room_round_requests rr
    WHERE rr.request_task_id=v_snow
      AND rr.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: Snow in Summer is still hidden inside Grow Room Care';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements req
    JOIN atlas.resources resource ON resource.id=req.resource_id
    WHERE req.task_id=v_snow AND resource.stable_key='pot_up_tray_200_cell' AND req.quantity_needed=3
  ) OR NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements req
    JOIN atlas.resources resource ON resource.id=req.resource_id
    WHERE req.task_id=v_snow AND resource.stable_key='pot_up_tray_120_cell' AND req.quantity_needed=1
  ) OR NOT EXISTS (
    SELECT 1
    FROM atlas.task_resource_requirements req
    JOIN atlas.resources resource ON resource.id=req.resource_id
    WHERE req.task_id=v_snow AND resource.stable_key='potting_mix'
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: Snow exact resource branches are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.task_capacity_requirements req
    JOIN atlas.capacity_pools pool ON pool.id=req.capacity_pool_id
    WHERE req.task_id=v_snow
      AND req.capacity_role='destination'
      AND req.quantity_needed=4
      AND req.unit='tray_positions'
      AND pool.capacity_kind='lit_tray_positions'
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: Snow 4-position destination capacity missing';
  END IF;

  SELECT task.id INTO v_harvest
  FROM atlas.tasks task
  WHERE task.assigned_membership_id=v_anna
    AND task.due_date=date '2026-08-13'
    AND task.task_type='harvest'
    AND nullif(task.metadata->>'departure_label','') IS NOT NULL
    AND coalesce(task.metadata->>'address','') ILIKE '%Lebanon%'
  ORDER BY task.created_at DESC
  LIMIT 1;

  IF v_harvest IS NULL THEN
    RAISE EXCEPTION 'Day acceptance v2: Aug 13 off-farm harvest move missing';
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
    RAISE EXCEPTION 'Day acceptance v2: departure requirement cue is incomplete';
  END IF;

  SELECT project.id,project.zone_id INTO v_event,v_venue
  FROM atlas.projects project
  WHERE project.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
  LIMIT 1;

  IF v_event IS NULL OR v_venue IS NULL THEN
    RAISE EXCEPTION 'Day acceptance v2: Aug 13 event project lacks canonical Venue place';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.zones zone WHERE zone.id=v_venue AND zone.stable_key='venue'
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: event project is not linked to the canonical Venue zone';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.project_task_links link
    JOIN atlas.tasks task ON task.id=link.task_id
    WHERE link.project_id=v_event
      AND task.task_type='event_setup'
      AND task.zone_id IS DISTINCT FROM v_venue
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: event setup task is structurally placeless or outside project Venue';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.presented_work_rows_v1(v_farm,v_anna,date '2026-08-13') row
    JOIN atlas.tasks task ON task.id=row.task_id
    WHERE row.presentation_state IN ('attention','presented')
      AND EXISTS (
        SELECT 1
        FROM atlas.task_prerequisites prerequisite
        LEFT JOIN atlas.tasks prerequisite_task ON prerequisite_task.id=prerequisite.prerequisite_task_id
        WHERE prerequisite.downstream_task_id=task.id
          AND prerequisite.active=true
          AND prerequisite.satisfied_at IS NULL
          AND (prerequisite_task.id IS NULL OR prerequisite_task.status IS DISTINCT FROM prerequisite.required_status)
      )
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: prerequisite-blocked downstream setup outranks actionable worker work';
  END IF;

  SELECT atlas.event_day_briefing_body_v1(v_event,v_anna,date '2026-08-13') INTO v_briefing;
  IF coalesce(v_briefing,'') <> 'Lebanon harvest this morning. Elm setup afterward.' THEN
    RAISE EXCEPTION 'Day acceptance v2: compact future-event briefing drifted: %',v_briefing;
  END IF;

  IF position('Lebanon' IN pg_get_functiondef('atlas.event_day_briefing_body_v1(uuid,uuid,date)'::regprocedure))>0
     OR position('Karianne' IN pg_get_functiondef('atlas.event_day_briefing_body_v1(uuid,uuid,date)'::regprocedure))>0 THEN
    RAISE EXCEPTION 'Day acceptance v2: event briefing logic hardcodes acceptance-case place/person names';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.grow_room_round_requests rr
    JOIN atlas.tasks task ON task.id=rr.request_task_id
    WHERE rr.resolved_at IS NULL
      AND (task.visibility_scope='system_internal' OR task.task_type IN ('pot_up','hardening_off','transplant_readiness','propagation_readiness'))
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: substantive/internal work remains nested in Grow Room Care';
  END IF;

  SELECT count(*)::integer INTO v_mismatch_count
  FROM atlas.tasks task
  JOIN atlas.planned_work_occurrences occurrence ON occurrence.id=coalesce(
    task.planned_occurrence_id,
    CASE WHEN nullif(task.metadata->>'planned_occurrence_id','') ~* '^[0-9a-f-]{36}$'
      THEN (task.metadata->>'planned_occurrence_id')::uuid ELSE NULL END
  )
  WHERE task.farm_id=v_farm
    AND task.assigned_membership_id=v_anna
    AND task.status IN ('open','blocked')
    AND task.due_date IS NOT NULL
    AND occurrence.state='released'
    AND occurrence.released_task_id=task.id
    AND occurrence.planned_due_date IS DISTINCT FROM task.due_date
    AND coalesce(task.metadata->>'planned_occurrence_date_role','')<>'historical_release_provenance'
    AND lower(coalesce(occurrence.metadata->>'historical_release_provenance','false')) NOT IN ('true','1','yes','on');

  IF v_mismatch_count<>0 THEN
    RAISE EXCEPTION 'Day acceptance v2: % active task/occurrence schedule mismatches remain',v_mismatch_count;
  END IF;

  SELECT task.id INTO v_iris
  FROM atlas.tasks task
  WHERE task.metadata->>'task_key'='anna_20260716_divide_lilac_haven_irises_into_drifts'
  ORDER BY task.created_at DESC
  LIMIT 1;

  IF v_iris IS NULL OR NOT EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.id=v_iris
      AND task.status='open'
      AND task.due_date IS NULL
      AND task.commitment_kind='floating'
      AND task.sky_deferral_mode='allow'
  ) THEN
    RAISE EXCEPTION 'Day acceptance v2: Owner replanning specimen no longer preserves floating canonical truth';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'ok',true,
  'proof',jsonb_build_array(
    'system-internal readiness cannot become worker Day work',
    'Snow in Summer is a direct canonical Task Focus move with exact resource/capacity branches',
    'Lebanon has a blocking canonical departure requirement cue',
    'Aug 13 event setup inherits the canonical Venue place',
    'prerequisite-blocked downstream setup stays behind actionable worker work',
    'event first-open briefing is compact, service-day aware, and derives its departure from task truth',
    'substantive Grow Room moves are not nested inside Grow Room Care',
    'active task and released-occurrence schedule truth is aligned',
    'Owner floating/sky-deferrable work remains undated canonical truth'
  )
) AS atlas_day_choreography_acceptance_preflight_v2;

ROLLBACK;
