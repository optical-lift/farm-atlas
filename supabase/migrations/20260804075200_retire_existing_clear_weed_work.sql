-- The physical-need gates stop new ordinary Weed work. Retire any serving that
-- was already active for a Weed Card whose canonical field condition is clear.
-- An explicit active maintenance directive remains authoritative and is not
-- silently closed by this repair.

DO $repair$
DECLARE
  v_task_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT task.id), '{}'::uuid[])
  INTO v_task_ids
  FROM atlas.tasks task
  JOIN atlas.task_objects linked ON linked.task_id = task.id
  JOIN atlas.weed_cards card ON card.object_id = linked.object_id
  WHERE task.status IN ('open', 'blocked')
    AND card.current_condition = 'clear'
    AND (
      lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
      OR coalesce(task.metadata ->> 'weed_card_managed', 'false') = 'true'
      OR coalesce(task.metadata ->> 'maintenance_type', '') = 'weed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM atlas.maintenance_directives directive
      WHERE directive.serving_task_id = task.id
        AND directive.status = 'active'
    );

  IF cardinality(v_task_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE atlas.planned_work_occurrences occurrence
  SET state = 'completed',
      metadata = coalesce(occurrence.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'completed_by', 'weed_physical_need_guard',
          'completed_reason', 'The canonical Weed Card is physically clear.',
          'completed_at', now()
        ),
      updated_at = now()
  WHERE occurrence.released_task_id = ANY(v_task_ids)
     OR occurrence.id IN (
       SELECT state.current_occurrence_id
       FROM atlas.rhythm_state state
       WHERE state.current_task_id = ANY(v_task_ids)
         AND state.current_occurrence_id IS NOT NULL
     );

  UPDATE atlas.tasks task
  SET status = 'skipped',
      completed_at = coalesce(task.completed_at, now()),
      blocker_text = null,
      metadata = coalesce(task.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'skipped_by', 'weed_physical_need_guard',
          'skipped_reason', 'The canonical Weed Card is physically clear.',
          'skipped_at', now()
        ),
      updated_at = now()
  WHERE task.id = ANY(v_task_ids);

  UPDATE atlas.rhythm_state state
  SET current_task_id = null,
      current_occurrence_id = null,
      recovery_started_at = null,
      state_reason = coalesce(state.state_reason, '{}'::jsonb)
        || jsonb_build_object(
          'taskClearedBy', 'weed_physical_need_guard',
          'taskClearedAt', now(),
          'physicalCondition', 'clear'
        ),
      updated_at = now()
  WHERE state.current_task_id = ANY(v_task_ids);
END;
$repair$;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atlas.tasks task
    JOIN atlas.task_objects linked ON linked.task_id = task.id
    JOIN atlas.weed_cards card ON card.object_id = linked.object_id
    WHERE task.status IN ('open', 'blocked')
      AND card.current_condition = 'clear'
      AND (
        lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
        OR coalesce(task.metadata ->> 'weed_card_managed', 'false') = 'true'
        OR coalesce(task.metadata ->> 'maintenance_type', '') = 'weed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM atlas.maintenance_directives directive
        WHERE directive.serving_task_id = task.id
          AND directive.status = 'active'
      )
  ) THEN
    RAISE EXCEPTION 'A clear Weed Card still has ordinary active Weed work.';
  END IF;
END;
$verify$;
