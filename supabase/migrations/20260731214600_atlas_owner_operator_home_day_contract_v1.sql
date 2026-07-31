-- Keep fresh Atlas replays aligned with the selected-member Home day contract
-- already applied in production.
--
-- The helper remains service-only. The authenticated Owner wrapper continues to
-- validate operator authority before entering this implementation layer.

DO $preflight$
BEGIN
  IF to_regprocedure('atlas.home_day_for_membership_v1(uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'home_day_for_membership_v1 is required before contract convergence.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has drift before Home day convergence.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION atlas.home_day_for_membership_v1(
  p_membership_id uuid,
  p_day date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_farm_id uuid;
  v_day date := coalesce(p_day, (now() AT TIME ZONE 'America/Chicago')::date);
  v_carried jsonb := '[]'::jsonb;
  v_planned jsonb := '[]'::jsonb;
  v_open integer := 0;
  v_done integer := 0;
BEGIN
  SELECT membership.farm_id
  INTO v_farm_id
  FROM atlas.farm_memberships membership
  WHERE membership.id = p_membership_id
    AND membership.active = true;

  IF v_farm_id IS NULL THEN
    RAISE EXCEPTION 'Active farm membership required.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', task.id,
    'title', task.title,
    'status', task.status,
    'dueDate', task.due_date,
    'taskType', task.task_type,
    'workClass', task.work_class,
    'priority', task.priority,
    'zoneId', task.zone_id
  ) ORDER BY task.due_date, task.priority DESC, task.created_at), '[]'::jsonb)
  INTO v_carried
  FROM atlas.tasks task
  WHERE task.farm_id = v_farm_id
    AND task.due_date < v_day
    AND task.status IN ('open', 'blocked')
    AND atlas.can_read_task_for_membership_v1(task.id, p_membership_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', task.id,
    'title', task.title,
    'status', task.status,
    'dueDate', task.due_date,
    'taskType', task.task_type,
    'workClass', task.work_class,
    'priority', task.priority,
    'zoneId', task.zone_id
  ) ORDER BY task.priority DESC, task.created_at), '[]'::jsonb)
  INTO v_planned
  FROM atlas.tasks task
  WHERE task.farm_id = v_farm_id
    AND task.due_date = v_day
    AND task.status <> 'archived'
    AND atlas.can_read_task_for_membership_v1(task.id, p_membership_id);

  SELECT
    count(*) FILTER (WHERE task.status IN ('open', 'blocked'))::integer,
    count(*) FILTER (WHERE task.status = 'done')::integer
  INTO v_open, v_done
  FROM atlas.tasks task
  WHERE task.farm_id = v_farm_id
    AND task.due_date = v_day
    AND atlas.can_read_task_for_membership_v1(task.id, p_membership_id);

  RETURN jsonb_build_object(
    'contractVersion', 'living_day_v1',
    'farmId', v_farm_id,
    'date', v_day,
    'journal', jsonb_build_object(
      'contractVersion', 'journal_day_v1',
      'farmId', v_farm_id,
      'date', v_day,
      'carried', v_carried,
      'planned', v_planned,
      'events', '[]'::jsonb,
      'unlocks', '[]'::jsonb,
      'summary', jsonb_build_object(
        'open', v_open,
        'done', v_done,
        'events', 0,
        'unlocks', 0
      )
    ),
    'carriedRhythms', '[]'::jsonb,
    'ownerDecisions', '[]'::jsonb,
    'goals', '[]'::jsonb,
    'unlockedToday', '[]'::jsonb,
    'completionSummary', jsonb_build_object(
      'readyToShow', v_open = 0,
      'plannedOpen', v_open,
      'plannedDone', v_done,
      'completed', v_done,
      'partial', 0,
      'migrated', 0,
      'blocked', 0,
      'restored', 0,
      'advanced', 0,
      'unlocked', 0
    ),
    'rules', jsonb_build_object(
      'denominator', 'bounded_day_plan_only',
      'carriedExcluded', true,
      'goalsExcluded', true,
      'unlockedTodayExcluded', true,
      'timeMayExpireStewardshipButNotClaimPhysicalCondition', true
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION atlas.home_day_for_membership_v1(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.home_day_for_membership_v1(uuid, date)
  TO service_role;

DO $verification$
DECLARE
  definition text;
  drift_count integer;
BEGIN
  definition := pg_get_functiondef(
    'atlas.home_day_for_membership_v1(uuid,date)'::regprocedure
  );

  IF position('''contractVersion'', ''living_day_v1''' IN definition) = 0 THEN
    RAISE EXCEPTION 'Selected-member Home day does not expose living_day_v1.';
  END IF;

  IF position(
    '''timeMayExpireStewardshipButNotClaimPhysicalCondition'', true'
    IN definition
  ) = 0 THEN
    RAISE EXCEPTION 'Selected-member Home day rules are incomplete.';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'atlas.home_day_for_membership_v1(uuid,date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.home_day_for_membership_v1(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Selected-member Home day helper is directly exposed.';
  END IF;

  SELECT count(*)
  INTO drift_count
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'RPC registry drift after Home day convergence: %', drift_count;
  END IF;
END
$verification$;
