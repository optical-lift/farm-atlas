-- A rhythm occurrence can wait in the reservoir after its bed has been restored.
-- Recheck current physical truth at the final release boundary so an old clock
-- signal can never become new assigned Weed work after the Weed Card is clear.

ALTER FUNCTION atlas.release_eligible_work_v1(uuid, date, integer)
  RENAME TO release_eligible_work_without_weed_physical_gate_v1;

REVOKE ALL ON FUNCTION atlas.release_eligible_work_without_weed_physical_gate_v1(uuid, date, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION atlas.release_eligible_work_v1(
  p_farm_id uuid,
  p_as_of_date date DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_today date := coalesce(p_as_of_date, (now() at time zone 'America/Chicago')::date);
  v_suppressed_ids uuid[] := '{}'::uuid[];
  v_result jsonb;
BEGIN
  SELECT coalesce(array_agg(candidate.id), '{}'::uuid[])
  INTO v_suppressed_ids
  FROM (
    SELECT occurrence.id
    FROM atlas.planned_work_occurrences occurrence
    JOIN atlas.rhythm_state state
      ON occurrence.source_kind = 'rhythm_state'
     AND occurrence.source_id = state.id
    WHERE occurrence.farm_id = p_farm_id
      AND occurrence.state IN ('planned', 'eligible', 'failed', 'releasing')
      AND state.rhythm_key = 'weed_stewardship'
      AND state.subject_kind = 'growing_object'
      AND NOT atlas.weed_card_allows_ordinary_work_v1(state.subject_id, v_today)
    FOR UPDATE OF occurrence
  ) candidate;

  IF cardinality(v_suppressed_ids) > 0 THEN
    UPDATE atlas.planned_work_occurrences occurrence
    SET state = 'cancelled',
        metadata = coalesce(occurrence.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'cancelledBy', 'weed_physical_need_release_gate',
            'cancelledAt', now(),
            'cancelledAsOfDate', v_today,
            'cancelledReason', 'The canonical Weed Card no longer has current physical need.'
          ),
        updated_at = now()
    WHERE occurrence.id = ANY(v_suppressed_ids);

    UPDATE atlas.rhythm_state state
    SET current_occurrence_id = null,
        current_task_id = CASE
          WHEN state.current_task_id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM atlas.tasks task
             WHERE task.id = state.current_task_id
               AND task.status IN ('open', 'blocked')
           )
          THEN state.current_task_id
          ELSE null
        END,
        state_reason = coalesce(state.state_reason, '{}'::jsonb)
          || jsonb_build_object(
            'occurrenceClearedBy', 'weed_physical_need_release_gate',
            'occurrenceClearedAt', now(),
            'physicalCondition', 'clear_or_not_ordinary_weed_work'
          ),
        updated_at = now()
    WHERE state.current_occurrence_id = ANY(v_suppressed_ids);
  END IF;

  v_result := atlas.release_eligible_work_without_weed_physical_gate_v1(
    p_farm_id,
    p_as_of_date,
    p_limit
  );

  RETURN coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object(
      'weedPhysicalNeedGateVersion', 'release_boundary_v1',
      'weedOccurrencesSuppressed', cardinality(v_suppressed_ids)
    );
END;
$function$;

REVOKE ALL ON FUNCTION atlas.release_eligible_work_v1(uuid, date, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Defense in depth: no direct or future release path may insert an active
-- rhythm-generated Weed task after the bed has become physically clear.
CREATE OR REPLACE FUNCTION atlas.guard_rhythm_weed_task_physical_need_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_state_id uuid;
  v_state atlas.rhythm_state%ROWTYPE;
  v_as_of date;
BEGIN
  IF NEW.status NOT IN ('open', 'blocked') THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.metadata ->> 'rhythm_key', '') <> 'weed_stewardship'
     AND coalesce(NEW.generated_from, '') <> 'rhythm_clock' THEN
    RETURN NEW;
  END IF;

  v_state_id := coalesce(
    NEW.generated_from_id,
    atlas.rhythm_safe_uuid_v1(NEW.metadata ->> 'rhythm_state_id')
  );

  IF v_state_id IS NULL AND NEW.planned_occurrence_id IS NOT NULL THEN
    SELECT occurrence.source_id
    INTO v_state_id
    FROM atlas.planned_work_occurrences occurrence
    WHERE occurrence.id = NEW.planned_occurrence_id
      AND occurrence.source_kind = 'rhythm_state';
  END IF;

  IF v_state_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT state.*
  INTO v_state
  FROM atlas.rhythm_state state
  WHERE state.id = v_state_id;

  IF v_state.id IS NULL
     OR v_state.rhythm_key <> 'weed_stewardship'
     OR v_state.subject_kind <> 'growing_object' THEN
    RETURN NEW;
  END IF;

  v_as_of := coalesce(NEW.due_date, (now() at time zone 'America/Chicago')::date);
  IF NOT atlas.weed_card_allows_ordinary_work_v1(v_state.subject_id, v_as_of) THEN
    RAISE EXCEPTION 'Rhythm Weed work cannot be released without current physical need.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.guard_rhythm_weed_task_physical_need_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zy_guard_rhythm_weed_task_physical_need_v1 ON atlas.tasks;
CREATE TRIGGER zy_guard_rhythm_weed_task_physical_need_v1
BEFORE INSERT OR UPDATE OF status, due_date, generated_from, generated_from_id,
  planned_occurrence_id, metadata
ON atlas.tasks
FOR EACH ROW
EXECUTE FUNCTION atlas.guard_rhythm_weed_task_physical_need_v1();

-- Retire any stale serving that escaped before the final release gate existed.
DO $repair$
DECLARE
  v_task_ids uuid[] := '{}'::uuid[];
  v_occurrence_ids uuid[] := '{}'::uuid[];
BEGIN
  PERFORM set_config('atlas.reservoir_migration', 'on', true);

  SELECT
    coalesce(array_agg(DISTINCT task.id), '{}'::uuid[]),
    coalesce(array_agg(DISTINCT task.planned_occurrence_id)
      FILTER (WHERE task.planned_occurrence_id IS NOT NULL), '{}'::uuid[])
  INTO v_task_ids, v_occurrence_ids
  FROM atlas.tasks task
  JOIN atlas.task_objects linked ON linked.task_id = task.id
  JOIN atlas.weed_cards card ON card.object_id = linked.object_id
  WHERE task.status IN ('open', 'blocked')
    AND card.current_condition = 'clear'
    AND (
      coalesce(task.metadata ->> 'rhythm_key', '') = 'weed_stewardship'
      OR coalesce(task.release_reason, '') = 'rhythm_serving'
      OR coalesce(task.generated_from, '') = 'rhythm_clock'
    );

  IF cardinality(v_task_ids) > 0 THEN
    UPDATE atlas.tasks task
    SET status = 'skipped',
        completed_at = coalesce(task.completed_at, now()),
        blocker_text = null,
        metadata = coalesce(task.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'skipped_by', 'weed_physical_need_release_gate',
            'skipped_reason', 'The canonical Weed Card is physically clear.',
            'skipped_at', now()
          ),
        updated_at = now()
    WHERE task.id = ANY(v_task_ids);
  END IF;

  IF cardinality(v_occurrence_ids) > 0 THEN
    UPDATE atlas.planned_work_occurrences occurrence
    SET state = 'completed',
        metadata = coalesce(occurrence.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'completedBy', 'weed_physical_need_release_gate',
            'completedReason', 'The canonical Weed Card was physically clear before release.',
            'completedAt', now()
          ),
        updated_at = now()
    WHERE occurrence.id = ANY(v_occurrence_ids);
  END IF;

  UPDATE atlas.rhythm_state state
  SET current_task_id = null,
      current_occurrence_id = null,
      recovery_started_at = null,
      state_reason = coalesce(state.state_reason, '{}'::jsonb)
        || jsonb_build_object(
          'staleServingClearedBy', 'weed_physical_need_release_gate',
          'staleServingClearedAt', now(),
          'physicalCondition', 'clear'
        ),
      updated_at = now()
  WHERE state.current_task_id = ANY(v_task_ids)
     OR state.current_occurrence_id = ANY(v_occurrence_ids);

  -- A restored rhythm can also retain an unreleased occurrence after its task
  -- reference has already been cleared. Cancel those pending copies now.
  WITH invalid_pending AS (
    SELECT occurrence.id, state.id AS state_id
    FROM atlas.planned_work_occurrences occurrence
    JOIN atlas.rhythm_state state
      ON occurrence.source_kind = 'rhythm_state'
     AND occurrence.source_id = state.id
    WHERE occurrence.state IN ('planned', 'eligible', 'failed', 'releasing')
      AND state.rhythm_key = 'weed_stewardship'
      AND state.subject_kind = 'growing_object'
      AND NOT atlas.weed_card_allows_ordinary_work_v1(
        state.subject_id,
        (now() at time zone 'America/Chicago')::date
      )
  ), cancelled AS (
    UPDATE atlas.planned_work_occurrences occurrence
    SET state = 'cancelled',
        metadata = coalesce(occurrence.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'cancelledBy', 'weed_physical_need_release_gate',
            'cancelledAt', now(),
            'cancelledReason', 'The rhythm was satisfied before this occurrence released.'
          ),
        updated_at = now()
    FROM invalid_pending pending
    WHERE occurrence.id = pending.id
    RETURNING occurrence.id
  )
  UPDATE atlas.rhythm_state state
  SET current_occurrence_id = null,
      updated_at = now()
  WHERE state.current_occurrence_id IN (SELECT id FROM cancelled);
END;
$repair$;

DO $verify$
BEGIN
  IF position(
    'weedOccurrencesSuppressed'
    IN pg_get_functiondef('atlas.release_eligible_work_v1(uuid,date,integer)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'The work reservoir is missing its Weed physical-need release gate.';
  END IF;

  IF has_function_privilege(
    'service_role',
    'atlas.release_eligible_work_without_weed_physical_gate_v1(uuid,date,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The ungated work-reservoir implementation is exposed to service_role.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.tasks task
    JOIN atlas.task_objects linked ON linked.task_id = task.id
    JOIN atlas.weed_cards card ON card.object_id = linked.object_id
    WHERE task.status IN ('open', 'blocked')
      AND card.current_condition = 'clear'
      AND (
        coalesce(task.metadata ->> 'rhythm_key', '') = 'weed_stewardship'
        OR coalesce(task.release_reason, '') = 'rhythm_serving'
        OR coalesce(task.generated_from, '') = 'rhythm_clock'
      )
  ) THEN
    RAISE EXCEPTION 'A rhythm-generated Weed task is still active for a clear Weed Card.';
  END IF;
END;
$verify$;
