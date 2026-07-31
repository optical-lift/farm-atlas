-- Phase 2 stabilization: consolidate the four Atlas tables that currently
-- evaluate multiple permissive authenticated SELECT policies for each row.
--
-- Each replacement policy is the logical OR of the reviewed policies it
-- replaces. A rollback-only production rehearsal compared 32 exact row-ID
-- snapshots across an Owner, manager, farm hand, and non-member identity and
-- found zero visibility differences.

DO $preflight$
DECLARE
  expected RECORD;
  current_policy RECORD;
  normalized_qual TEXT;
  actual_count INTEGER;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('user_profiles','user_profiles_read_operations',
       '(EXISTS ( SELECT 1 FROM atlas.farm_memberships target_membership WHERE ((target_membership.user_id = user_profiles.user_id) AND (target_membership.active = true) AND atlas.can_read_farm_operations(target_membership.farm_id))))'),
      ('user_profiles','user_profiles_read_self',
       '(user_id = ( SELECT auth.uid() AS uid))'),
      ('farm_memberships','farm_memberships_read_operations',
       'atlas.can_read_farm_operations(farm_id)'),
      ('farm_memberships','farm_memberships_read_self',
       '(user_id = ( SELECT auth.uid() AS uid))'),
      ('organization_memberships','organization_memberships_read_owner',
       'atlas.is_organization_owner(organization_id)'),
      ('organization_memberships','organization_memberships_read_self',
       '(user_id = ( SELECT auth.uid() AS uid))'),
      ('tasks','tasks_read_manager',
       '((atlas.current_farm_role(farm_id) = ''manager''::text) AND (visibility_scope = ANY (ARRAY[''management''::text, ''assigned_worker''::text, ''farm_shared''::text])))'),
      ('tasks','tasks_read_owner',
       'atlas.is_farm_owner(farm_id)'),
      ('tasks','tasks_read_project_contributor',
       '((assigned_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM atlas.project_task_links ptl WHERE ((ptl.task_id = tasks.id) AND atlas.can_read_project(ptl.project_id)))))')
    ) AS reviewed(table_name, policy_name, expected_qual)
  LOOP
    SELECT *
    INTO current_policy
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND tablename = expected.table_name
      AND policyname = expected.policy_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reviewed Atlas policy %.% does not exist.',
        expected.table_name, expected.policy_name;
    END IF;

    IF current_policy.roles <> ARRAY['authenticated']::name[]
       OR current_policy.cmd <> 'SELECT'
       OR current_policy.permissive <> 'PERMISSIVE'
       OR current_policy.with_check IS NOT NULL THEN
      RAISE EXCEPTION 'Reviewed Atlas policy %.% changed its role, command, permissiveness, or check contract.',
        expected.table_name, expected.policy_name;
    END IF;

    normalized_qual := regexp_replace(current_policy.qual, '[[:space:]]+', ' ', 'g');
    IF normalized_qual <> expected.expected_qual THEN
      RAISE EXCEPTION 'Reviewed Atlas policy %.% has drifted: %',
        expected.table_name, expected.policy_name, normalized_qual;
    END IF;
  END LOOP;

  FOR expected IN
    SELECT * FROM (VALUES
      ('user_profiles', 2),
      ('farm_memberships', 2),
      ('organization_memberships', 2),
      ('tasks', 3)
    ) AS reviewed(table_name, expected_count)
  LOOP
    SELECT count(*)
    INTO actual_count
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND tablename = expected.table_name
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[];

    IF actual_count <> expected.expected_count THEN
      RAISE EXCEPTION 'Atlas table % has % authenticated SELECT policies; expected %.',
        expected.table_name, actual_count, expected.expected_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND policyname IN (
        'user_profiles_read_authorized',
        'farm_memberships_read_authorized',
        'organization_memberships_read_authorized',
        'tasks_read_authorized'
      )
  ) THEN
    RAISE EXCEPTION 'One or more replacement Atlas policies already exist.';
  END IF;
END
$preflight$;

CREATE POLICY user_profiles_read_authorized
  ON atlas.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM atlas.farm_memberships target_membership
      WHERE target_membership.user_id = user_profiles.user_id
        AND target_membership.active = true
        AND atlas.can_read_farm_operations(target_membership.farm_id)
    )
  );

DROP POLICY user_profiles_read_operations ON atlas.user_profiles;
DROP POLICY user_profiles_read_self ON atlas.user_profiles;

CREATE POLICY farm_memberships_read_authorized
  ON atlas.farm_memberships
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR atlas.can_read_farm_operations(farm_id)
  );

DROP POLICY farm_memberships_read_operations ON atlas.farm_memberships;
DROP POLICY farm_memberships_read_self ON atlas.farm_memberships;

CREATE POLICY organization_memberships_read_authorized
  ON atlas.organization_memberships
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR atlas.is_organization_owner(organization_id)
  );

DROP POLICY organization_memberships_read_owner ON atlas.organization_memberships;
DROP POLICY organization_memberships_read_self ON atlas.organization_memberships;

CREATE POLICY tasks_read_authorized
  ON atlas.tasks
  FOR SELECT
  TO authenticated
  USING (
    atlas.is_farm_owner(farm_id)
    OR (
      atlas.current_farm_role(farm_id) = 'manager'::text
      AND visibility_scope = ANY (
        ARRAY['management'::text, 'assigned_worker'::text, 'farm_shared'::text]
      )
    )
    OR assigned_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM atlas.project_task_links ptl
      WHERE ptl.task_id = tasks.id
        AND atlas.can_read_project(ptl.project_id)
    )
  );

DROP POLICY tasks_read_manager ON atlas.tasks;
DROP POLICY tasks_read_owner ON atlas.tasks;
DROP POLICY tasks_read_project_contributor ON atlas.tasks;

DO $verification$
DECLARE
  expected RECORD;
  actual_count INTEGER;
  current_policy RECORD;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('user_profiles','user_profiles_read_authorized'),
      ('farm_memberships','farm_memberships_read_authorized'),
      ('organization_memberships','organization_memberships_read_authorized'),
      ('tasks','tasks_read_authorized')
    ) AS reviewed(table_name, policy_name)
  LOOP
    SELECT *
    INTO current_policy
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND tablename = expected.table_name
      AND policyname = expected.policy_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Replacement Atlas policy %.% was not created.',
        expected.table_name, expected.policy_name;
    END IF;

    IF current_policy.roles <> ARRAY['authenticated']::name[]
       OR current_policy.cmd <> 'SELECT'
       OR current_policy.permissive <> 'PERMISSIVE'
       OR current_policy.with_check IS NOT NULL
       OR current_policy.qual IS NULL THEN
      RAISE EXCEPTION 'Replacement Atlas policy %.% has an invalid contract.',
        expected.table_name, expected.policy_name;
    END IF;

    SELECT count(*)
    INTO actual_count
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND tablename = expected.table_name
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[];

    IF actual_count <> 1 THEN
      RAISE EXCEPTION 'Atlas table % still has % authenticated SELECT policies.',
        expected.table_name, actual_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'atlas'
      AND policyname IN (
        'user_profiles_read_operations',
        'user_profiles_read_self',
        'farm_memberships_read_operations',
        'farm_memberships_read_self',
        'organization_memberships_read_owner',
        'organization_memberships_read_self',
        'tasks_read_manager',
        'tasks_read_owner',
        'tasks_read_project_contributor'
      )
  ) THEN
    RAISE EXCEPTION 'One or more superseded Atlas policies still exist.';
  END IF;
END
$verification$;
