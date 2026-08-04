-- Keep each signed-in person's normal Work feed personal, allow farm Managers
-- to configure explicit Work Alongside windows, and add a separate management-
-- only farm-day reader for the big-picture view.

CREATE OR REPLACE FUNCTION atlas.validate_work_alongside_window_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_observer atlas.farm_memberships%ROWTYPE;
  v_teammate atlas.farm_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_observer
  FROM atlas.farm_memberships
  WHERE id = NEW.observer_membership_id;

  SELECT * INTO v_teammate
  FROM atlas.farm_memberships
  WHERE id = NEW.teammate_membership_id;

  IF v_observer.id IS NULL OR v_teammate.id IS NULL THEN
    RAISE EXCEPTION 'Both work-alongside memberships must exist.' USING ERRCODE = '23503';
  END IF;

  IF v_observer.active IS DISTINCT FROM true OR v_teammate.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Work-alongside memberships must be active.' USING ERRCODE = '23514';
  END IF;

  IF v_observer.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only an Owner or Manager membership may observe a work-alongside window.' USING ERRCODE = '42501';
  END IF;

  IF v_observer.farm_id IS DISTINCT FROM v_teammate.farm_id
     OR NEW.farm_id IS DISTINCT FROM v_observer.farm_id THEN
    RAISE EXCEPTION 'Work-alongside memberships must belong to the same farm.' USING ERRCODE = '23514';
  END IF;

  NEW.created_by_user_id := coalesce(NEW.created_by_user_id, auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS work_alongside_windows_owner_select ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_owner_insert ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_owner_update ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_owner_delete ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_management_select ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_management_insert ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_management_update ON atlas.work_alongside_windows;
DROP POLICY IF EXISTS work_alongside_windows_management_delete ON atlas.work_alongside_windows;

CREATE POLICY work_alongside_windows_management_select
ON atlas.work_alongside_windows
FOR SELECT TO authenticated
USING (atlas.is_farm_manager_or_owner(farm_id));

CREATE POLICY work_alongside_windows_management_insert
ON atlas.work_alongside_windows
FOR INSERT TO authenticated
WITH CHECK (atlas.is_farm_manager_or_owner(farm_id));

CREATE POLICY work_alongside_windows_management_update
ON atlas.work_alongside_windows
FOR UPDATE TO authenticated
USING (atlas.is_farm_manager_or_owner(farm_id))
WITH CHECK (atlas.is_farm_manager_or_owner(farm_id));

CREATE POLICY work_alongside_windows_management_delete
ON atlas.work_alongside_windows
FOR DELETE TO authenticated
USING (atlas.is_farm_manager_or_owner(farm_id));

-- The public Home/Day entry point resolves the authenticated user's membership.
-- It may not accept a different worker key and may not aggregate other farm
-- memberships. Explicit Work Alongside overlays are handled by the membership
-- reader installed in the immediately following strict-scope migration.
CREATE OR REPLACE FUNCTION atlas.home_task_cards_v2(
  p_farm_id uuid,
  p_worker_key text,
  p_due_through date,
  p_done_date date
)
RETURNS SETOF atlas.v_task_cards
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas, auth
AS $function$
DECLARE
  v_membership_id uuid;
  v_worker_key text;
  v_requested_worker_key text := nullif(lower(btrim(p_worker_key)), '');
BEGIN
  v_membership_id := atlas.current_membership_id(p_farm_id);
  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'Active farm membership required.' USING ERRCODE = '42501';
  END IF;

  SELECT nullif(lower(btrim(membership.worker_key)), '')
  INTO v_worker_key
  FROM atlas.farm_memberships membership
  WHERE membership.id = v_membership_id
    AND membership.farm_id = p_farm_id
    AND membership.active = true;

  IF v_worker_key IS NULL THEN
    RAISE EXCEPTION 'Current Atlas worker identity was not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_requested_worker_key IS NOT NULL
     AND v_requested_worker_key IS DISTINCT FROM v_worker_key THEN
    RAISE EXCEPTION 'The home reader may only load the signed-in membership.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT card.*
  FROM atlas.home_task_cards_for_membership_v2(
    p_farm_id,
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.home_task_cards_v2(uuid, text, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atlas.home_task_cards_v2(uuid, text, date, date)
  TO authenticated;

CREATE OR REPLACE FUNCTION atlas.farm_day_task_cards_v1(
  p_farm_id uuid,
  p_work_date date DEFAULT ((now() at time zone 'America/Chicago')::date)
)
RETURNS SETOF atlas.v_task_cards
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas, auth
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := atlas.current_farm_role(p_farm_id);
  IF v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Farm management membership required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH active_memberships AS (
    SELECT fm.id, fm.user_id, nullif(lower(btrim(fm.worker_key)), '') AS worker_key
    FROM atlas.farm_memberships fm
    WHERE fm.farm_id = p_farm_id
      AND fm.active = true
  ), chosen AS (
    -- Scheduled work due on this date or still carried forward.
    SELECT task.id AS task_id, 0 AS source_rank, task.due_date, task.priority, task.created_at
    FROM atlas.tasks task
    WHERE task.farm_id = p_farm_id
      AND task.task_scope = 'farm_operation'
      AND task.parent_task_id IS NULL
      AND nullif(task.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(task.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND EXISTS (
        SELECT 1
        FROM active_memberships member
        WHERE task.assigned_membership_id = member.id
           OR task.assigned_user_id = member.user_id
           OR task.metadata ->> 'executor_membership_id' = member.id::text
           OR (
             member.worker_key IS NOT NULL
             AND lower(coalesce(
               nullif(task.metadata ->> 'executor_worker_key', ''),
               nullif(task.metadata ->> 'assignee_key', ''),
               nullif(task.metadata ->> 'assigned_to', '')
             )) = member.worker_key
           )
      )
      AND (
        (task.status IN ('open', 'blocked') AND task.due_date IS NOT NULL AND task.due_date <= p_work_date)
        OR (task.status = 'done' AND task.due_date = p_work_date)
      )

    UNION ALL

    -- Capacity-selected undated work genuinely in a person's hand that day.
    SELECT presented.task_id, 1, NULL::date, 'normal'::text, now()
    FROM active_memberships member
    CROSS JOIN LATERAL atlas.presented_work_rows_v1(p_farm_id, member.id, p_work_date) presented
    WHERE presented.presentation_state IN ('attention', 'presented')
  ), picked AS (
    SELECT DISTINCT ON (task_id) task_id, source_rank, due_date, priority, created_at
    FROM chosen
    ORDER BY task_id, source_rank, due_date NULLS LAST, priority, created_at
  )
  SELECT card.*
  FROM picked
  JOIN atlas.v_task_cards card ON card.task_id = picked.task_id
  ORDER BY
    CASE card.status WHEN 'blocked' THEN 0 WHEN 'open' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
    card.due_date NULLS LAST,
    card.priority,
    card.created_at,
    card.task_id;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.farm_day_task_cards_v1(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atlas.farm_day_task_cards_v1(uuid, date)
  TO authenticated, service_role;

-- Keep the repository-governed authenticated RPC registry synchronized with
-- this new management endpoint. The later repair migration repeats this UPSERT
-- safely for already-applied production databases.
INSERT INTO atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
VALUES (
  'atlas.farm_day_task_cards_v1(uuid, date)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  0,
  0,
  jsonb_build_object(
    'source', 'manager_farm_day_build',
    'registered_by_migration', '20260804052000_atlas_personal_work_and_manager_big_picture_v1.sql'
  ),
  now()
)
ON CONFLICT (signature) DO UPDATE
SET classification = EXCLUDED.classification,
    confidence = EXCLUDED.confidence,
    review_status = EXCLUDED.review_status,
    authenticated_execute_expected = EXCLUDED.authenticated_execute_expected,
    security_definer_expected = EXCLUDED.security_definer_expected,
    service_execute_expected = EXCLUDED.service_execute_expected,
    evidence = atlas.authenticated_rpc_registry.evidence || EXCLUDED.evidence,
    reviewed_at = now();

DO $verification$
BEGIN
  IF position(
    'membership.id'
    IN pg_get_functiondef('atlas.home_task_cards_v2(uuid,text,date,date)'::regprocedure)
  ) > 0
     AND position(
       'cross join lateral'
       IN lower(pg_get_functiondef('atlas.home_task_cards_v2(uuid,text,date,date)'::regprocedure))
     ) > 0 THEN
    RAISE EXCEPTION 'The normal home reader still aggregates other farm memberships.';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'atlas.farm_day_task_cards_v1(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Management farm-day reader is not callable by authenticated sessions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM atlas.authenticated_rpc_registry
    WHERE signature = 'atlas.farm_day_task_cards_v1(uuid, date)'
      AND authenticated_execute_expected = true
      AND security_definer_expected = true
      AND review_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Management farm-day reader is missing from the authenticated RPC registry.';
  END IF;
END
$verification$;