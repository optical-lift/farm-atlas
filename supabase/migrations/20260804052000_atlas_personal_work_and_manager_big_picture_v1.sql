-- Keep each signed-in person's normal Work feed personal, while preserving
-- explicit work-alongside windows and adding a separate management-only farm-day
-- reader for the big-picture view.

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

CREATE OR REPLACE FUNCTION atlas.home_task_cards_for_membership_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date DEFAULT NULL,
  p_done_date date DEFAULT NULL
)
RETURNS SETOF atlas.v_task_cards
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas, auth
AS $function$
DECLARE
  v_role text;
  v_user_id uuid;
  v_worker_key text;
  v_day date := coalesce(p_done_date, (now() at time zone 'America/Chicago')::date);
  v_due_through date := coalesce(p_due_through, v_day + 35);
BEGIN
  SELECT fm.role, fm.user_id, nullif(lower(btrim(fm.worker_key)), '')
  INTO v_role, v_user_id, v_worker_key
  FROM atlas.farm_memberships fm
  WHERE fm.id = p_membership_id
    AND fm.farm_id = p_farm_id
    AND fm.active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Active farm membership required.' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS DISTINCT FROM auth.uid()
     AND NOT atlas.is_farm_manager_or_owner(p_farm_id) THEN
    RAISE EXCEPTION 'Only farm management may read another member''s work.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH chosen AS (
    SELECT row.task_id, 0 AS surface_group, row.lane_order, row.selection_rank
    FROM atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
    WHERE row.presentation_state IN ('attention', 'presented')

    UNION ALL

    SELECT t.id, 1, 1, row_number() OVER (ORDER BY t.due_date, t.priority, t.created_at)
    FROM atlas.tasks t
    WHERE t.farm_id = p_farm_id
      AND t.status IN ('open', 'blocked')
      AND t.parent_task_id IS NULL
      AND nullif(t.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(t.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(t.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND t.work_lane = 'required'
      AND t.commitment_kind = 'hard_date'
      AND t.due_date > v_day
      AND t.due_date <= v_due_through
      AND (
        t.assigned_membership_id = p_membership_id
        OR t.assigned_user_id = v_user_id
        OR t.metadata ->> 'executor_membership_id' = p_membership_id::text
        OR (
          jsonb_typeof(t.metadata -> 'shared_with_membership_ids') = 'array'
          AND (t.metadata -> 'shared_with_membership_ids') ? p_membership_id::text
        )
        OR (
          v_worker_key IS NOT NULL
          AND lower(coalesce(
            nullif(t.metadata ->> 'executor_worker_key', ''),
            nullif(t.metadata ->> 'assignee_key', ''),
            nullif(t.metadata ->> 'assigned_to', '')
          )) = v_worker_key
        )
        OR (
          v_role = 'owner'
          AND lower(coalesce(t.metadata ->> 'owner_task', 'false')) = 'true'
        )
      )

    UNION ALL

    -- Explicit temporary overlay only. A Manager or Owner sees a teammate's
    -- assigned cards only when a same-farm work-alongside window covers the
    -- task date. Task ownership remains unchanged.
    SELECT
      t.id,
      2,
      1,
      row_number() OVER (ORDER BY t.due_date, t.priority, t.created_at)
    FROM atlas.work_alongside_windows w
    JOIN atlas.tasks t
      ON t.farm_id = w.farm_id
     AND t.assigned_membership_id = w.teammate_membership_id
    WHERE v_role IN ('owner', 'manager')
      AND w.farm_id = p_farm_id
      AND w.observer_membership_id = p_membership_id
      AND w.status = 'active'
      AND t.visibility_scope = 'assigned_worker'
      AND t.parent_task_id IS NULL
      AND nullif(t.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(t.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(t.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND t.due_date BETWEEN w.starts_on AND w.ends_on
      AND (
        (
          t.status IN ('open', 'blocked')
          AND t.due_date <= v_due_through
        )
        OR (
          t.status = 'done'
          AND p_done_date IS NOT NULL
          AND t.due_date = p_done_date
        )
      )
  ), deduped AS (
    SELECT DISTINCT ON (task_id)
      task_id,
      surface_group,
      lane_order,
      selection_rank
    FROM chosen
    ORDER BY task_id, surface_group, lane_order, selection_rank
  )
  SELECT card.*
  FROM deduped selected
  JOIN atlas.v_task_cards card ON card.task_id = selected.task_id
  WHERE card.status IN ('open', 'blocked', 'done')
    AND (
      (
        card.task_type = 'grow_room_care'
        AND lower(card.title) IN ('grow room care', 'water + check grow room', 'check grow room')
      )
      OR NOT (
        coalesce(card.zone_key, '') = 'grow_room'
        OR coalesce(card.zone_label, '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'collection_zone', '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'location_label', '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'work_route', '') IN (
          'grow_room_check', 'grow_room_audit', 'pot_up', 'hardening_off',
          'soil_block', 'grow_room_setup', 'grow_room_care'
        )
      )
    )
  ORDER BY selected.surface_group, selected.lane_order, selected.selection_rank;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.home_task_cards_for_membership_v2(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.home_task_cards_for_membership_v2(uuid, uuid, date, date)
  TO service_role;

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
    -- Every assigned scheduled card that is due today or still carried forward.
    SELECT t.id AS task_id, 0 AS source_rank, t.due_date, t.priority, t.created_at
    FROM atlas.tasks t
    WHERE t.farm_id = p_farm_id
      AND t.task_scope = 'farm_operation'
      AND t.parent_task_id IS NULL
      AND nullif(t.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(t.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(t.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND EXISTS (
        SELECT 1
        FROM active_memberships member
        WHERE t.assigned_membership_id = member.id
           OR t.assigned_user_id = member.user_id
           OR t.metadata ->> 'executor_membership_id' = member.id::text
           OR (
             member.worker_key IS NOT NULL
             AND lower(coalesce(
               nullif(t.metadata ->> 'executor_worker_key', ''),
               nullif(t.metadata ->> 'assignee_key', ''),
               nullif(t.metadata ->> 'assigned_to', '')
             )) = member.worker_key
           )
      )
      AND (
        (t.status IN ('open', 'blocked') AND t.due_date IS NOT NULL AND t.due_date <= p_work_date)
        OR (t.status = 'done' AND t.due_date = p_work_date)
      )

    UNION ALL

    -- Include capacity-selected undated work that genuinely belongs in a
    -- member's hand for this date.
    SELECT row.task_id, 1, NULL::date, 'normal'::text, now()
    FROM active_memberships member
    CROSS JOIN LATERAL atlas.presented_work_rows_v1(p_farm_id, member.id, p_work_date) row
    WHERE row.presentation_state IN ('attention', 'presented')
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

DO $verification$
BEGIN
  IF position(
    'work_alongside_windows'
    IN pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'Personal membership reader lost the explicit work-alongside overlay.';
  END IF;

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
END
$verification$;