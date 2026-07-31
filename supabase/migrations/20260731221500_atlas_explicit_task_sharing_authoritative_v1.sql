-- Explicit task membership lists are narrower than broad farm visibility.
--
-- A task may remain `farm_shared` for legacy routing while also carrying an
-- explicit `shared_with_membership_ids` list. When that list is present and
-- non-empty, it is authoritative for non-Owner memberships. This keeps one
-- task contract across an account's ordinary portal and the Owner switcher.

DO $preflight$
BEGIN
  IF md5(pg_get_functiondef(
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure
  )) <> '3c8dee3c4aa0d5e3bc3d44851c5d18c2' THEN
    RAISE EXCEPTION 'home_task_cards_for_membership_v2 definition drifted before explicit-sharing migration.';
  END IF;

  IF md5(pg_get_functiondef(
    'atlas.can_read_task_for_membership_v1(uuid,uuid)'::regprocedure
  )) <> '698264e732023ab634c2d82f656a63b6' THEN
    RAISE EXCEPTION 'can_read_task_for_membership_v1 definition drifted before explicit-sharing migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has drift before explicit-sharing migration.';
  END IF;
END
$preflight$;

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
    SELECT CASE
      WHEN task.farm_id IS DISTINCT FROM membership.farm_id THEN false
      WHEN membership.role = 'owner' THEN true
      WHEN jsonb_array_length(
        CASE
          WHEN jsonb_typeof(task.metadata -> 'shared_with_membership_ids') = 'array'
            THEN task.metadata -> 'shared_with_membership_ids'
          ELSE '[]'::jsonb
        END
      ) > 0 THEN
        (task.metadata -> 'shared_with_membership_ids') ? membership.id::text
      ELSE CASE task.visibility_scope
        WHEN 'owner' THEN false
        WHEN 'management' THEN membership.role = 'manager'
        WHEN 'assigned_worker' THEN
          membership.role = 'manager'
          OR task.assigned_user_id = membership.user_id
          OR task.assigned_membership_id = membership.id
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
        WHEN 'system_internal' THEN false
        ELSE true
      END
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

DO $postcondition$
DECLARE
  v_cards_definition text;
  v_membership_definition text;
BEGIN
  v_cards_definition := pg_get_functiondef(
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure
  );
  v_membership_definition := pg_get_functiondef(
    'atlas.can_read_task_for_membership_v1(uuid,uuid)'::regprocedure
  );

  IF position('shared_with_membership_ids' IN v_cards_definition) = 0
     OR position('shared_with_membership_ids' IN v_membership_definition) = 0 THEN
    RAISE EXCEPTION 'Explicit membership sharing was not installed in both membership readers.';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'atlas.can_read_task_for_membership_v1(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.can_read_task_for_membership_v1(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Membership-targeted task readers became directly callable.';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'atlas.can_read_task_for_membership_v1(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Service-role execution was not preserved for membership-targeted task readers.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry drifted after explicit-sharing migration.';
  END IF;
END
$postcondition$;