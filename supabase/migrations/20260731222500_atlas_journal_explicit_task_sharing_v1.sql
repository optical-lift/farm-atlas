-- Keep the ordinary signed-in Living Day aligned with membership-scoped Home.
--
-- Non-empty `shared_with_membership_ids` metadata is authoritative for
-- non-Owner accounts before the legacy visibility-scope fallback is applied.

DO $preflight$
BEGIN
  IF md5(pg_get_functiondef(
    'atlas.can_read_task_in_journal_v1(uuid)'::regprocedure
  )) <> '94f54ffdc3e659750c05e5dbf7181a4e' THEN
    RAISE EXCEPTION 'can_read_task_in_journal_v1 definition drifted before explicit-sharing migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry has drift before journal explicit-sharing migration.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION atlas.can_read_task_in_journal_v1(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN jsonb_array_length(
        CASE
          WHEN jsonb_typeof(task.metadata -> 'shared_with_membership_ids') = 'array'
            THEN task.metadata -> 'shared_with_membership_ids'
          ELSE '[]'::jsonb
        END
      ) > 0
      AND NOT atlas.is_farm_owner(task.farm_id)
      THEN EXISTS (
        SELECT 1
        FROM atlas.farm_memberships membership
        WHERE membership.id = atlas.current_membership_id(task.farm_id)
          AND membership.active = true
          AND (task.metadata -> 'shared_with_membership_ids') ? membership.id::text
      )
      ELSE CASE task.visibility_scope
        WHEN 'owner' THEN
          task.farm_id IS NOT NULL
          AND atlas.is_farm_owner(task.farm_id)
        WHEN 'management' THEN
          task.farm_id IS NOT NULL
          AND atlas.is_farm_manager_or_owner(task.farm_id)
        WHEN 'assigned_worker' THEN
          (
            task.farm_id IS NOT NULL
            AND atlas.is_farm_manager_or_owner(task.farm_id)
          )
          OR task.assigned_user_id = auth.uid()
        WHEN 'project_shared' THEN EXISTS (
          SELECT 1
          FROM atlas.project_task_links project_task
          WHERE project_task.task_id = task.id
            AND atlas.can_read_project(project_task.project_id)
        )
        WHEN 'system_internal' THEN
          task.farm_id IS NOT NULL
          AND atlas.is_farm_owner(task.farm_id)
        ELSE
          task.farm_id IS NOT NULL
          AND atlas.is_farm_member(task.farm_id)
      END
    END
    FROM atlas.tasks task
    WHERE task.id = p_task_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION atlas.can_read_task_in_journal_v1(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION atlas.can_read_task_in_journal_v1(uuid)
  TO authenticated;

DO $postcondition$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'atlas.can_read_task_in_journal_v1(uuid)'::regprocedure
  );

  IF position('shared_with_membership_ids' IN v_definition) = 0
     OR position('current_membership_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Journal task visibility did not install explicit membership sharing.';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'atlas.can_read_task_in_journal_v1(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'atlas.can_read_task_in_journal_v1(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'atlas.can_read_task_in_journal_v1(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Journal task visibility grants no longer match the governed registry.';
  END IF;

  IF EXISTS (SELECT 1 FROM atlas.authenticated_rpc_registry_drift_v1()) THEN
    RAISE EXCEPTION 'Atlas authenticated RPC registry drifted after journal explicit-sharing migration.';
  END IF;
END
$postcondition$;