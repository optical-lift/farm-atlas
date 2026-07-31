-- Make Owner operator mode read the selected member's task surface through the
-- same membership rules used by that member's own Atlas account.
--
-- This migration does not change task data. It introduces internal,
-- membership-targeted readers, points both ordinary and operator Home task
-- readers at the same implementation, and exposes two Owner-authorized read
-- wrappers for the selected member's Living Day and set-aside state.

DO $preflight$
BEGIN
  IF md5(pg_get_functiondef('atlas.home_task_cards_v2(uuid,text,date,date)'::regprocedure))
     <> 'c795ac1f60cb14376c729a44ddfde63f' THEN
    RAISE EXCEPTION 'home_task_cards_v2 definition drifted before exact-parity migration.';
  END IF;

  IF md5(pg_get_functiondef('atlas.owner_operator_home_task_cards_v1(uuid,date,date)'::regprocedure))
     <> '222749918535562186ec58b47eb27221' THEN
    RAISE EXCEPTION 'owner_operator_home_task_cards_v1 definition drifted before exact-parity migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has drift before exact-parity migration.';
  END IF;
END
$preflight$;

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
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_role text;
  v_task_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT membership.role
  INTO v_role
  FROM atlas.farm_memberships membership
  WHERE membership.id = p_membership_id
    AND membership.farm_id = p_farm_id
    AND membership.active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Active farm membership required.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(task.id), '{}'::uuid[])
  INTO v_task_ids
  FROM atlas.tasks task
  WHERE task.farm_id = p_farm_id
    AND task.status <> 'archived'
    AND (
      task.visibility_scope = 'farm_shared'
      OR (
        task.visibility_scope = 'assigned_worker'
        AND task.assigned_membership_id = p_membership_id
      )
      OR (
        v_role = 'owner'
        AND task.visibility_scope = 'owner'
        AND (
          task.assigned_membership_id IS NULL
          OR task.assigned_membership_id = p_membership_id
        )
      )
    )
    AND (
      (
        task.status IN ('open', 'blocked')
        AND (
          p_due_through IS NULL
          OR task.due_date IS NULL
          OR task.due_date <= p_due_through
        )
      )
      OR (
        task.status = 'done'
        AND p_done_date IS NOT NULL
        AND task.due_date = p_done_date
      )
    );

  IF cardinality(v_task_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT card.*
  FROM atlas.v_task_cards card
  WHERE card.task_id = ANY(v_task_ids)
    AND (
      (
        card.task_type = 'grow_room_care'
        AND lower(card.title) IN (
          'grow room care',
          'water + check grow room',
          'check grow room'
        )
      )
      OR NOT (
        coalesce(card.zone_key, '') = 'grow_room'
        OR coalesce(card.zone_label, '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'collection_zone', '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'location_label', '') ILIKE '%grow room%'
        OR coalesce(card.metadata ->> 'work_route', '') IN (
          'grow_room_check',
          'grow_room_audit',
          'pot_up',
          'hardening_off',
          'soil_block',
          'grow_room_setup',
          'grow_room_care'
        )
      )
    )
  ORDER BY card.due_date NULLS LAST, card.priority, card.created_at;
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
SET search_path = pg_catalog, atlas
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

CREATE OR REPLACE FUNCTION atlas.owner_operator_home_task_cards_v1(
  p_effective_membership_id uuid,
  p_due_through date DEFAULT NULL,
  p_done_date date DEFAULT NULL
)
RETURNS SETOF atlas.v_task_cards
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_context jsonb;
  v_farm_id uuid;
  v_membership_id uuid;
BEGIN
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;

  RETURN QUERY
  SELECT card.*
  FROM atlas.home_task_cards_for_membership_v2(
    v_farm_id,
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.can_read_task_for_membership_v1(
  p_task_id uuid,
  p_membership_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
  SELECT coalesce((
    SELECT CASE task.visibility_scope
      WHEN 'owner' THEN
        membership.role = 'owner'
        AND task.farm_id = membership.farm_id
      WHEN 'management' THEN
        membership.role IN ('owner', 'manager')
        AND task.farm_id = membership.farm_id
      WHEN 'assigned_worker' THEN
        task.farm_id = membership.farm_id
        AND (
          membership.role IN ('owner', 'manager')
          OR task.assigned_user_id = membership.user_id
        )
      WHEN 'project_shared' THEN EXISTS (
        SELECT 1
        FROM atlas.project_task_links link
        JOIN atlas.projects project ON project.id = link.project_id
        WHERE link.task_id = task.id
          AND (
            EXISTS (
              SELECT 1
              FROM atlas.organization_memberships organization_membership
              WHERE organization_membership.organization_id = project.organization_id
                AND organization_membership.user_id = membership.user_id
                AND organization_membership.role = 'owner'
                AND organization_membership.active = true
            )
            OR EXISTS (
              SELECT 1
              FROM atlas.project_contributors contributor
              WHERE contributor.project_id = project.id
                AND contributor.user_id = membership.user_id
                AND contributor.active = true
            )
          )
      )
      WHEN 'system_internal' THEN
        membership.role = 'owner'
        AND task.farm_id = membership.farm_id
      ELSE task.farm_id = membership.farm_id
    END
    FROM atlas.tasks task
    JOIN atlas.farm_memberships membership
      ON membership.id = p_membership_id
     AND membership.active = true
    WHERE task.id = p_task_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION atlas.can_read_task_for_membership_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.can_read_task_for_membership_v1(uuid, uuid)
  TO service_role;

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
    'contractVersion', 'home_day_for_membership_v1',
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
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION atlas.home_day_for_membership_v1(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.home_day_for_membership_v1(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION atlas.task_day_dispositions_for_membership_v1(
  p_membership_id uuid,
  p_day date DEFAULT (timezone('America/Chicago', now()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_farm_id uuid;
  v_role text;
  v_day date := coalesce(p_day, (timezone('America/Chicago', now()))::date);
  v_result jsonb;
BEGIN
  SELECT membership.farm_id, membership.role
  INTO v_farm_id, v_role
  FROM atlas.farm_memberships membership
  WHERE membership.id = p_membership_id
    AND membership.active = true;

  IF v_farm_id IS NULL THEN
    RAISE EXCEPTION 'Active farm membership required.' USING ERRCODE = '42501';
  END IF;

  WITH active AS (
    SELECT DISTINCT ON (disposition.task_id) disposition.*
    FROM atlas.task_day_dispositions disposition
    WHERE disposition.farm_id = v_farm_id
      AND disposition.service_date <= v_day
      AND disposition.returns_on > v_day
      AND disposition.disposition = 'set_aside'
    ORDER BY disposition.task_id, disposition.service_date DESC, disposition.created_at DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', disposition.id,
    'taskId', disposition.task_id,
    'serviceDate', disposition.service_date,
    'dueDate', disposition.due_date_snapshot,
    'safeBoundaryDate', disposition.safe_boundary_date,
    'requestedReturnDate', coalesce(disposition.requested_return_date, disposition.returns_on),
    'consequence', disposition.consequence,
    'overdueDays', disposition.overdue_days,
    'deferralCount', disposition.deferral_number,
    'returnsOn', disposition.returns_on,
    'createdAt', disposition.created_at,
    'taskTitle', task.title
  ) ORDER BY disposition.created_at), '[]'::jsonb)
  INTO v_result
  FROM active disposition
  JOIN atlas.tasks task ON task.id = disposition.task_id
  WHERE task.status IN ('open', 'blocked')
    AND (
      v_role = 'owner'
      OR (
        v_role IN ('farm_hand', 'manager')
        AND task.visibility_scope = 'assigned_worker'
        AND task.assigned_membership_id = p_membership_id
      )
    );

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION atlas.task_day_dispositions_for_membership_v1(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.task_day_dispositions_for_membership_v1(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION atlas.owner_operator_home_day_v1(
  p_effective_membership_id uuid,
  p_day date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_context jsonb;
  v_membership_id uuid;
BEGIN
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  RETURN atlas.home_day_for_membership_v1(v_membership_id, p_day);
END;
$function$;

REVOKE ALL ON FUNCTION atlas.owner_operator_home_day_v1(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.owner_operator_home_day_v1(uuid, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION atlas.owner_operator_task_day_dispositions_v1(
  p_effective_membership_id uuid,
  p_day date DEFAULT (timezone('America/Chicago', now()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_context jsonb;
  v_membership_id uuid;
BEGIN
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  RETURN atlas.task_day_dispositions_for_membership_v1(v_membership_id, p_day);
END;
$function$;

REVOKE ALL ON FUNCTION atlas.owner_operator_task_day_dispositions_v1(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas.owner_operator_task_day_dispositions_v1(uuid, date)
  TO authenticated, service_role;

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
VALUES
  (
    'atlas.owner_operator_home_day_v1(uuid, date)',
    'owner_admin_endpoint',
    'verified',
    'active',
    true,
    true,
    true,
    0,
    0,
    jsonb_build_object(
      'source', 'owner_switcher_exact_portal_parity_v1',
      'purpose', 'selected membership Living Day read'
    ),
    now()
  ),
  (
    'atlas.owner_operator_task_day_dispositions_v1(uuid, date)',
    'owner_admin_endpoint',
    'verified',
    'active',
    true,
    true,
    true,
    0,
    0,
    jsonb_build_object(
      'source', 'owner_switcher_exact_portal_parity_v1',
      'purpose', 'selected membership set-aside read'
    ),
    now()
  );

DO $verification$
DECLARE
  drift_count integer;
BEGIN
  IF has_function_privilege(
    'authenticated',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Membership task helper is directly exposed.';
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
    RAISE EXCEPTION 'Membership day helper is directly exposed.';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'atlas.task_day_dispositions_for_membership_v1(uuid,date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.task_day_dispositions_for_membership_v1(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Membership disposition helper is directly exposed.';
  END IF;

  SELECT count(*)
  INTO drift_count
  FROM atlas.authenticated_rpc_registry_drift_v1();

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'RPC registry drift after exact-parity migration: %', drift_count;
  END IF;
END
$verification$;
