-- Let an Owner temporarily work alongside selected farm members without
-- changing who owns or completes their tasks.
--
-- The window is durable data. Task assignment remains canonical, while the
-- membership-scoped Home/Day reader includes a teammate's dated work for the
-- Owner during the selected visit window.

CREATE TABLE IF NOT EXISTS atlas.work_alongside_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES atlas.farms(id) ON DELETE CASCADE,
  observer_membership_id uuid NOT NULL REFERENCES atlas.farm_memberships(id) ON DELETE CASCADE,
  teammate_membership_id uuid NOT NULL REFERENCES atlas.farm_memberships(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_alongside_windows_date_order_check CHECK (starts_on <= ends_on),
  CONSTRAINT work_alongside_windows_distinct_memberships_check CHECK (observer_membership_id <> teammate_membership_id),
  CONSTRAINT work_alongside_windows_status_check CHECK (status IN ('active', 'ended')),
  CONSTRAINT work_alongside_windows_identity_unique UNIQUE (
    observer_membership_id,
    teammate_membership_id,
    starts_on,
    ends_on
  )
);

CREATE INDEX IF NOT EXISTS work_alongside_windows_observer_dates_idx
  ON atlas.work_alongside_windows (observer_membership_id, starts_on, ends_on)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS work_alongside_windows_teammate_dates_idx
  ON atlas.work_alongside_windows (teammate_membership_id, starts_on, ends_on)
  WHERE status = 'active';

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
  SELECT *
  INTO v_observer
  FROM atlas.farm_memberships
  WHERE id = NEW.observer_membership_id;

  SELECT *
  INTO v_teammate
  FROM atlas.farm_memberships
  WHERE id = NEW.teammate_membership_id;

  IF v_observer.id IS NULL OR v_teammate.id IS NULL THEN
    RAISE EXCEPTION 'Both work-alongside memberships must exist.' USING ERRCODE = '23503';
  END IF;

  IF v_observer.active IS DISTINCT FROM true OR v_teammate.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Work-alongside memberships must be active.' USING ERRCODE = '23514';
  END IF;

  IF v_observer.role <> 'owner' THEN
    RAISE EXCEPTION 'Only an Owner membership may observe a work-alongside window.' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION atlas.validate_work_alongside_window_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_alongside_windows_validate_v1
  ON atlas.work_alongside_windows;
CREATE TRIGGER work_alongside_windows_validate_v1
BEFORE INSERT OR UPDATE ON atlas.work_alongside_windows
FOR EACH ROW EXECUTE FUNCTION atlas.validate_work_alongside_window_v1();

ALTER TABLE atlas.work_alongside_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_alongside_windows_owner_select
  ON atlas.work_alongside_windows;
CREATE POLICY work_alongside_windows_owner_select
ON atlas.work_alongside_windows
FOR SELECT
TO authenticated
USING (atlas.is_farm_owner(farm_id));

DROP POLICY IF EXISTS work_alongside_windows_owner_insert
  ON atlas.work_alongside_windows;
CREATE POLICY work_alongside_windows_owner_insert
ON atlas.work_alongside_windows
FOR INSERT
TO authenticated
WITH CHECK (atlas.is_farm_owner(farm_id));

DROP POLICY IF EXISTS work_alongside_windows_owner_update
  ON atlas.work_alongside_windows;
CREATE POLICY work_alongside_windows_owner_update
ON atlas.work_alongside_windows
FOR UPDATE
TO authenticated
USING (atlas.is_farm_owner(farm_id))
WITH CHECK (atlas.is_farm_owner(farm_id));

DROP POLICY IF EXISTS work_alongside_windows_owner_delete
  ON atlas.work_alongside_windows;
CREATE POLICY work_alongside_windows_owner_delete
ON atlas.work_alongside_windows
FOR DELETE
TO authenticated
USING (atlas.is_farm_owner(farm_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON atlas.work_alongside_windows TO authenticated;
GRANT ALL ON atlas.work_alongside_windows TO service_role;

-- Keep a stable executor identity on each task card without changing the title
-- or category vocabulary. The UI can render this as an independent badge.
CREATE OR REPLACE FUNCTION atlas.decorate_task_executor_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_worker_key text;
  v_role text;
  v_display_name text;
BEGIN
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
    - 'executor_membership_id'
    - 'executor_worker_key'
    - 'executor_role'
    - 'executor_label';

  IF NEW.assigned_membership_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT membership.worker_key,
         membership.role,
         profile.display_name
  INTO v_worker_key,
       v_role,
       v_display_name
  FROM atlas.farm_memberships membership
  LEFT JOIN atlas.user_profiles profile
    ON profile.user_id = membership.user_id
  WHERE membership.id = NEW.assigned_membership_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.metadata := NEW.metadata || jsonb_strip_nulls(jsonb_build_object(
    'executor_membership_id', NEW.assigned_membership_id,
    'executor_worker_key', v_worker_key,
    'executor_role', v_role,
    'executor_label', coalesce(
      nullif(btrim(v_display_name), ''),
      initcap(replace(coalesce(v_worker_key, v_role), '_', ' '))
    )
  ));

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.decorate_task_executor_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_tasks_decorate_executor_v1 ON atlas.tasks;
CREATE TRIGGER zz_tasks_decorate_executor_v1
BEFORE INSERT OR UPDATE OF assigned_membership_id ON atlas.tasks
FOR EACH ROW EXECUTE FUNCTION atlas.decorate_task_executor_v1();

UPDATE atlas.tasks task
SET metadata = coalesce(task.metadata, '{}'::jsonb)
  - 'executor_membership_id'
  - 'executor_worker_key'
  - 'executor_role'
  - 'executor_label'
  || jsonb_strip_nulls(jsonb_build_object(
    'executor_membership_id', membership.id,
    'executor_worker_key', membership.worker_key,
    'executor_role', membership.role,
    'executor_label', coalesce(
      nullif(btrim(profile.display_name), ''),
      initcap(replace(coalesce(membership.worker_key, membership.role), '_', ' '))
    )
  )),
    updated_at = now()
FROM atlas.farm_memberships membership
LEFT JOIN atlas.user_profiles profile
  ON profile.user_id = membership.user_id
WHERE task.assigned_membership_id = membership.id;

-- Preserve the established membership reader and add one narrow Owner overlay:
-- an assigned-worker task is visible when its executor is selected in an
-- active work-alongside window and its due date falls inside that window.
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
      OR (
        v_role = 'owner'
        AND task.visibility_scope = 'assigned_worker'
        AND task.due_date IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM atlas.work_alongside_windows window
          WHERE window.farm_id = p_farm_id
            AND window.observer_membership_id = p_membership_id
            AND window.teammate_membership_id = task.assigned_membership_id
            AND window.status = 'active'
            AND task.due_date BETWEEN window.starts_on AND window.ends_on
        )
      )
    )
    AND CASE
      WHEN v_role = 'owner' THEN true
      WHEN jsonb_array_length(
        CASE
          WHEN jsonb_typeof(task.metadata -> 'shared_with_membership_ids') = 'array'
            THEN task.metadata -> 'shared_with_membership_ids'
          ELSE '[]'::jsonb
        END
      ) > 0 THEN
        (task.metadata -> 'shared_with_membership_ids') ? p_membership_id::text
      ELSE true
    END
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

DO $verification$
BEGIN
  IF to_regclass('atlas.work_alongside_windows') IS NULL THEN
    RAISE EXCEPTION 'Work-alongside window table was not installed.';
  END IF;

  IF position(
    'work_alongside_windows'
    IN pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'Membership task reader does not include the work-alongside overlay.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND tablename = 'work_alongside_windows'
      AND policyname = 'work_alongside_windows_owner_select'
  ) THEN
    RAISE EXCEPTION 'Work-alongside RLS policy was not installed.';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Membership task reader became directly callable.';
  END IF;
END
$verification$;
