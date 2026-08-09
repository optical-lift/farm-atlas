-- Keep Anna's canonical event work visible in her worker Day and expose the projects
-- that her assigned Moves actually advance. This is intentionally derived from the
-- existing canonical task and farm identities instead of generated UUIDs.

DO $$
DECLARE
  v_farm_id uuid;
  v_organization_id uuid;
  v_worker_user_id uuid;
  v_worker_membership_id uuid;
BEGIN
  SELECT f.id, f.organization_id
  INTO v_farm_id, v_organization_id
  FROM atlas.farms f
  WHERE f.stable_key = 'elm_farm'
  LIMIT 1;

  SELECT t.assigned_user_id
  INTO v_worker_user_id
  FROM atlas.tasks t
  WHERE t.farm_id = v_farm_id
    AND t.title = 'Hang conference-room café lights + porch solar lights'
    AND t.task_scope = 'farm_operation'
    AND t.status IN ('open', 'blocked')
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF v_farm_id IS NULL OR v_worker_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT fm.id
  INTO v_worker_membership_id
  FROM atlas.farm_memberships fm
  WHERE fm.farm_id = v_farm_id
    AND fm.user_id = v_worker_user_id
    AND fm.active = true
  ORDER BY fm.created_at
  LIMIT 1;

  -- Owner correction: the cafe/porch lights are Tuesday prep, not Thursday setup.
  UPDATE atlas.tasks t
  SET due_date = DATE '2026-08-11',
      assigned_membership_id = COALESCE(t.assigned_membership_id, v_worker_membership_id),
      metadata = COALESCE(t.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'execution_date', '2026-08-11',
          'reservoir_planned_due_date', '2026-08-11'
        ),
      updated_at = now()
  WHERE t.farm_id = v_farm_id
    AND t.title = 'Hang conference-room café lights + porch solar lights'
    AND t.task_scope IN ('farm_operation', 'project');

  UPDATE atlas.planned_work_occurrences pwo
  SET planned_due_date = DATE '2026-08-11',
      task_payload = jsonb_set(
        jsonb_set(
          COALESCE(pwo.task_payload, '{}'::jsonb),
          '{due_date}',
          '"2026-08-11"'::jsonb,
          true
        ),
        '{assigned_membership_id}',
        to_jsonb(v_worker_membership_id::text),
        true
      ),
      metadata = COALESCE(pwo.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'releasedExecutionDate', '2026-08-11',
          'scheduleCorrection', 'Owner confirmed Tuesday 2026-08-11'
        ),
      updated_at = now()
  WHERE pwo.released_task_id IN (
    SELECT t.id
    FROM atlas.tasks t
    WHERE t.farm_id = v_farm_id
      AND t.title = 'Hang conference-room café lights + porch solar lights'
      AND t.task_scope = 'farm_operation'
  );

  -- The nine canonicalized Bloom Bar tasks were moved out of project-only copies.
  -- Ensure their real Day tasks carry Anna's farm membership as well as user assignment.
  UPDATE atlas.tasks t
  SET assigned_membership_id = v_worker_membership_id,
      updated_at = now()
  WHERE t.farm_id = v_farm_id
    AND t.assigned_user_id = v_worker_user_id
    AND t.assigned_membership_id IS NULL
    AND t.status IN ('open', 'blocked');

  UPDATE atlas.planned_work_occurrences pwo
  SET task_payload = jsonb_set(
        COALESCE(pwo.task_payload, '{}'::jsonb),
        '{assigned_membership_id}',
        to_jsonb(v_worker_membership_id::text),
        true
      ),
      updated_at = now()
  WHERE pwo.released_task_id IN (
    SELECT t.id
    FROM atlas.tasks t
    WHERE t.farm_id = v_farm_id
      AND t.assigned_user_id = v_worker_user_id
      AND t.assigned_membership_id = v_worker_membership_id
      AND t.status IN ('open', 'blocked')
  );

  -- Portfolio reads are organization-scoped. Give this farm worker a narrow member
  -- membership; project_contributors below still limits her to contributed projects.
  IF NOT EXISTS (
    SELECT 1
    FROM atlas.organization_memberships om
    WHERE om.organization_id = v_organization_id
      AND om.user_id = v_worker_user_id
  ) THEN
    INSERT INTO atlas.organization_memberships (
      organization_id, user_id, role, active, permissions
    ) VALUES (
      v_organization_id,
      v_worker_user_id,
      'member',
      true,
      '{"portfolio_scope":"contributed_projects"}'::jsonb
    );
  ELSE
    UPDATE atlas.organization_memberships om
    SET active = true,
        role = 'member',
        permissions = COALESCE(om.permissions, '{}'::jsonb)
          || '{"portfolio_scope":"contributed_projects"}'::jsonb,
        updated_at = now()
    WHERE om.organization_id = v_organization_id
      AND om.user_id = v_worker_user_id;
  END IF;

  -- A worker should see every active project containing one of her Moves plus the
  -- ancestor projects required to make the hierarchy intelligible.
  WITH RECURSIVE direct_projects AS (
    SELECT DISTINCT p.id, p.parent_project_id
    FROM atlas.project_task_links ptl
    JOIN atlas.projects p ON p.id = ptl.project_id
    JOIN atlas.tasks t ON t.id = ptl.task_id
    WHERE t.farm_id = v_farm_id
      AND t.assigned_user_id = v_worker_user_id
      AND t.status IN ('open', 'blocked')
      AND p.status <> 'archived'
  ), visible_projects AS (
    SELECT * FROM direct_projects
    UNION
    SELECT parent.id, parent.parent_project_id
    FROM atlas.projects parent
    JOIN visible_projects child ON child.parent_project_id = parent.id
    WHERE parent.status <> 'archived'
  )
  INSERT INTO atlas.project_contributors (
    project_id,
    user_id,
    contribution_role,
    active,
    can_create_tasks,
    can_complete_tasks,
    can_submit_results,
    permissions
  )
  SELECT
    vp.id,
    v_worker_user_id,
    'contributor',
    true,
    false,
    true,
    true,
    '{"visibility":"assigned_work_and_project_context"}'::jsonb
  FROM visible_projects vp
  WHERE NOT EXISTS (
    SELECT 1
    FROM atlas.project_contributors pc
    WHERE pc.project_id = vp.id
      AND pc.user_id = v_worker_user_id
  );

  WITH RECURSIVE direct_projects AS (
    SELECT DISTINCT p.id, p.parent_project_id
    FROM atlas.project_task_links ptl
    JOIN atlas.projects p ON p.id = ptl.project_id
    JOIN atlas.tasks t ON t.id = ptl.task_id
    WHERE t.farm_id = v_farm_id
      AND t.assigned_user_id = v_worker_user_id
      AND t.status IN ('open', 'blocked')
      AND p.status <> 'archived'
  ), visible_projects AS (
    SELECT * FROM direct_projects
    UNION
    SELECT parent.id, parent.parent_project_id
    FROM atlas.projects parent
    JOIN visible_projects child ON child.parent_project_id = parent.id
    WHERE parent.status <> 'archived'
  )
  UPDATE atlas.project_contributors pc
  SET active = true,
      contribution_role = 'contributor',
      can_create_tasks = false,
      can_complete_tasks = true,
      can_submit_results = true,
      permissions = COALESCE(pc.permissions, '{}'::jsonb)
        || '{"visibility":"assigned_work_and_project_context"}'::jsonb,
      updated_at = now()
  WHERE pc.user_id = v_worker_user_id
    AND pc.project_id IN (SELECT id FROM visible_projects);
END
$$;
