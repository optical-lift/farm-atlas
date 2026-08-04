-- A person's normal Work feed contains only work canonically assigned to that
-- membership/user/worker identity. Sharing metadata does not expand the normal
-- feed. The only cross-person overlay is an explicit work-alongside window.

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
  WITH personal_presented AS (
    SELECT presented.task_id, 0 AS surface_group, presented.lane_order, presented.selection_rank
    FROM atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) presented
    JOIN atlas.tasks task ON task.id = presented.task_id
    WHERE presented.presentation_state IN ('attention', 'presented')
      AND (
        task.assigned_membership_id = p_membership_id
        OR task.assigned_user_id = v_user_id
        OR task.metadata ->> 'executor_membership_id' = p_membership_id::text
        OR (
          v_worker_key IS NOT NULL
          AND lower(coalesce(
            nullif(task.metadata ->> 'executor_worker_key', ''),
            nullif(task.metadata ->> 'assignee_key', ''),
            nullif(task.metadata ->> 'assigned_to', '')
          )) = v_worker_key
        )
        OR (
          v_role = 'owner'
          AND task.assigned_membership_id IS NULL
          AND task.assigned_user_id IS NULL
          AND (
            lower(coalesce(task.metadata ->> 'owner_task', 'false')) = 'true'
            OR lower(coalesce(task.metadata ->> 'assigned_to', '')) = 'owner'
            OR task.visibility_scope = 'owner'
          )
        )
      )
  ), personal_scheduled AS (
    SELECT
      task.id AS task_id,
      1 AS surface_group,
      1 AS lane_order,
      row_number() OVER (ORDER BY task.due_date, task.priority, task.created_at) AS selection_rank
    FROM atlas.tasks task
    WHERE task.farm_id = p_farm_id
      AND task.parent_task_id IS NULL
      AND nullif(task.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(task.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND (
        task.assigned_membership_id = p_membership_id
        OR task.assigned_user_id = v_user_id
        OR task.metadata ->> 'executor_membership_id' = p_membership_id::text
        OR (
          v_worker_key IS NOT NULL
          AND lower(coalesce(
            nullif(task.metadata ->> 'executor_worker_key', ''),
            nullif(task.metadata ->> 'assignee_key', ''),
            nullif(task.metadata ->> 'assigned_to', '')
          )) = v_worker_key
        )
        OR (
          v_role = 'owner'
          AND task.assigned_membership_id IS NULL
          AND task.assigned_user_id IS NULL
          AND (
            lower(coalesce(task.metadata ->> 'owner_task', 'false')) = 'true'
            OR lower(coalesce(task.metadata ->> 'assigned_to', '')) = 'owner'
            OR task.visibility_scope = 'owner'
          )
        )
      )
      AND (
        (
          task.status IN ('open', 'blocked')
          AND task.work_lane = 'required'
          AND task.commitment_kind = 'hard_date'
          AND task.due_date > v_day
          AND task.due_date <= v_due_through
        )
        OR (
          task.status = 'done'
          AND p_done_date IS NOT NULL
          AND task.due_date = p_done_date
        )
      )
  ), alongside AS (
    SELECT
      task.id AS task_id,
      2 AS surface_group,
      1 AS lane_order,
      row_number() OVER (ORDER BY task.due_date, task.priority, task.created_at) AS selection_rank
    FROM atlas.work_alongside_windows alongside_window
    JOIN atlas.tasks task
      ON task.farm_id = alongside_window.farm_id
     AND task.assigned_membership_id = alongside_window.teammate_membership_id
    WHERE v_role IN ('owner', 'manager')
      AND alongside_window.farm_id = p_farm_id
      AND alongside_window.observer_membership_id = p_membership_id
      AND alongside_window.status = 'active'
      AND task.visibility_scope = 'assigned_worker'
      AND task.parent_task_id IS NULL
      AND nullif(task.metadata ->> 'parent_task_id', '') IS NULL
      AND nullif(task.metadata ->> 'parentTaskId', '') IS NULL
      AND lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      AND task.due_date BETWEEN alongside_window.starts_on AND alongside_window.ends_on
      AND (
        (task.status IN ('open', 'blocked') AND task.due_date <= v_due_through)
        OR (task.status = 'done' AND p_done_date IS NOT NULL AND task.due_date = p_done_date)
      )
  ), chosen AS (
    SELECT * FROM personal_presented
    UNION ALL
    SELECT * FROM personal_scheduled
    UNION ALL
    SELECT * FROM alongside
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

DO $verification$
BEGIN
  IF position(
    'shared_with_membership_ids'
    IN pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure)
  ) > 0 THEN
    RAISE EXCEPTION 'Shared membership metadata still expands the personal Work feed.';
  END IF;

  IF position(
    'work_alongside_windows'
    IN pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'The explicit work-alongside overlay is missing.';
  END IF;
END
$verification$;