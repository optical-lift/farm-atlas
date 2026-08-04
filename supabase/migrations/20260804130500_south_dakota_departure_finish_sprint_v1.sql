-- The full reconciliation was applied to production as
-- south_dakota_departure_finish_sprint_v1 on 2026-08-04.
-- This durable contract preserves the resulting project/task truth and prevents
-- superseded umbrella cards or stale attic-door steps from becoming active again.

begin;

DO $contract$
DECLARE
  v_farm_id uuid;
  v_project_id uuid;
  v_now timestamptz := now();
  v_linked_count integer;
  v_checklist_count integer;
BEGIN
  PERFORM set_config('atlas.reservoir_migration', 'on', true);

  SELECT id INTO v_farm_id
  FROM atlas.farms
  WHERE stable_key = 'elm_farm';

  SELECT id INTO v_project_id
  FROM atlas.projects
  WHERE organization_id = (SELECT organization_id FROM atlas.farms WHERE id = v_farm_id)
    AND stable_key = 'elm_south_dakota_departure_finish_20260805';

  IF v_farm_id IS NULL OR v_project_id IS NULL THEN
    RAISE EXCEPTION 'The South Dakota departure finish sprint was not reconciled.';
  END IF;

  -- No duplicate master checklist: the project derives its state from the real tasks.
  UPDATE atlas.projects
  SET title = 'Finish Elm Before South Dakota Departure',
      status = 'active',
      current_milestone = 'Complete every linked task before Wednesday morning departure',
      target_date = date '2026-08-05',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'deadlineKind', 'departure_hard_stop',
        'departureDate', '2026-08-05',
        'source', 'marshall_handwritten_finish_list_20260804',
        'duplicatePolicy', 'link_real_tasks_do_not_create_master_checklist'
      ),
      updated_at = v_now
  WHERE id = v_project_id;

  -- Superseded umbrella cards and obsolete attic-door steps remain historical only.
  UPDATE atlas.tasks task
  SET status = 'archived',
      due_date = null,
      blocker_text = null,
      assigned_membership_id = null,
      assigned_user_id = null,
      visibility_scope = 'system_internal',
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_by', 'south_dakota_departure_finish_sprint_v1',
        'archived_at', v_now,
        'archive_reason', 'Scope is represented by specific canonical departure tasks.'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.status IN ('open', 'blocked')
    AND (
      task.title IN (
        'Marshall — Move Dryer Downstairs',
        'Owner + Marshall — Finish Entry Floor + Trim Around Laundry/Hutch',
        'Marshall — Complete Venue Bathroom Punch Items',
        'Owner — Marshall Finish Day'
      )
      OR task.metadata ->> 'task_key' IN (
        'marshall_attic_door_04_cut_frame_bottom',
        'marshall_attic_door_05_measure_doorway_gap',
        'marshall_attic_door_06_make_gap_filler',
        'marshall_attic_door_07_install_gap_filler',
        'marshall_attic_door_10_finish_gaps'
      )
    );

  UPDATE atlas.planned_work_occurrences occurrence
  SET state = 'completed',
      metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
        'completedBy', 'south_dakota_departure_finish_sprint_v1',
        'completedReason', 'The released task was superseded by canonical departure work.',
        'completedAt', v_now
      ),
      updated_at = v_now
  FROM atlas.tasks task
  WHERE task.farm_id = v_farm_id
    AND task.status = 'archived'
    AND task.metadata ->> 'archived_by' = 'south_dakota_departure_finish_sprint_v1'
    AND (occurrence.id = task.planned_occurrence_id OR occurrence.released_task_id = task.id);

  -- Every real departure task belongs to the project; the project owns no checklist rows.
  INSERT INTO atlas.project_task_links (
    project_id, task_id, link_role, sort_order, source, metadata
  )
  SELECT v_project_id,
         task.id,
         'belongs_to',
         coalesce((task.metadata ->> 'departure_sort_order')::integer, 1000),
         'owner_instruction_20260804',
         jsonb_build_object('departureSprintKey', 'south_dakota_departure_20260805')
  FROM atlas.tasks task
  WHERE task.farm_id = v_farm_id
    AND task.status IN ('open', 'blocked')
    AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805'
  ON CONFLICT (project_id, task_id) DO UPDATE
  SET link_role = 'belongs_to',
      sort_order = excluded.sort_order,
      source = excluded.source,
      metadata = atlas.project_task_links.metadata || excluded.metadata,
      updated_at = v_now;

  SELECT count(*)::integer INTO v_linked_count
  FROM atlas.project_task_links link
  JOIN atlas.tasks task ON task.id = link.task_id
  WHERE link.project_id = v_project_id
    AND task.status IN ('open', 'blocked')
    AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805';

  SELECT count(*)::integer INTO v_checklist_count
  FROM atlas.task_execution_checklist_items item
  JOIN atlas.tasks task ON task.id = item.task_id
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805';

  IF v_linked_count <> 23 THEN
    RAISE EXCEPTION 'Expected 23 real departure tasks; found %.', v_linked_count;
  END IF;

  IF v_checklist_count <> 21 THEN
    RAISE EXCEPTION 'Expected 21 checklist conditions inside coherent task clusters; found %.', v_checklist_count;
  END IF;

  IF EXISTS (
    SELECT task.metadata ->> 'task_key'
    FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805'
    GROUP BY task.metadata ->> 'task_key'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active departure task identities remain.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805'
      AND (task.due_date IS NULL OR task.due_date > date '2026-08-05')
  ) THEN
    RAISE EXCEPTION 'A departure task is scheduled after Wednesday morning.';
  END IF;

  IF (
    SELECT count(*)
    FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'departure_sprint_key' = 'south_dakota_departure_20260805'
      AND task.metadata ->> 'collection_label' = 'Plumbing'
  ) <> 5 THEN
    RAISE EXCEPTION 'The Plumbing cluster must contain five distinct repair tasks.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'task_key' = 'marshall_20260804_move_hutch_library_to_entry'
      AND task.title = 'Marshall — Move Hutch from Library to Entry'
  ) THEN
    RAISE EXCEPTION 'The existing hutch task was not reused.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'task_key' = 'owner_20260804_reimburse_melody'
      AND task.visibility_scope = 'management'
      AND task.assigned_membership_id = (
        SELECT id FROM atlas.farm_memberships
        WHERE farm_id = v_farm_id AND worker_key = 'lex' AND active
      )
  ) THEN
    RAISE EXCEPTION 'Melody reimbursement is not an Owner task shared with Marshall.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.farm_id = v_farm_id
      AND task.status IN ('open', 'blocked')
      AND task.metadata ->> 'task_key' = 'marshall_20260804_install_working_basement_dryer'
      AND task.title = 'Marshall — Install Working Dryer in Basement'
  ) THEN
    RAISE EXCEPTION 'The dryer outcome is not represented as a working basement installation.';
  END IF;
END;
$contract$;

commit;
