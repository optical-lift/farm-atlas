-- Reconcile Marshall's handwritten finish list into canonical Atlas work.
-- The project is a derived view over real tasks, not a duplicate master checklist.

begin;

DO $migration$
DECLARE
  v_farm_id uuid;
  v_organization_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_marshall_membership_id uuid;
  v_marshall_user_id uuid;
  v_project_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT farm.id, farm.organization_id
  INTO v_farm_id, v_organization_id
  FROM atlas.farms farm
  WHERE farm.stable_key = 'elm_farm';

  SELECT membership.id, membership.user_id
  INTO v_owner_membership_id, v_owner_user_id
  FROM atlas.farm_memberships membership
  WHERE membership.farm_id = v_farm_id
    AND membership.worker_key = 'lex'
    AND membership.active;

  SELECT membership.id, membership.user_id
  INTO v_marshall_membership_id, v_marshall_user_id
  FROM atlas.farm_memberships membership
  WHERE membership.farm_id = v_farm_id
    AND membership.worker_key = 'marshall'
    AND membership.active;

  IF v_farm_id IS NULL OR v_organization_id IS NULL
     OR v_owner_membership_id IS NULL OR v_marshall_membership_id IS NULL THEN
    RAISE EXCEPTION 'Elm Farm, Owner, or Marshall membership could not be resolved.';
  END IF;

  INSERT INTO atlas.projects (
    organization_id, farm_id, stable_key, title, status, goal_text,
    workstream, project_kind, outcome_text, current_milestone,
    health_status, target_date, sort_order, last_movement_at, metadata
  ) VALUES (
    v_organization_id,
    v_farm_id,
    'elm_south_dakota_departure_finish_20260805',
    'Finish Elm Before South Dakota Departure',
    'active',
    'Complete Marshall’s venue, house, equipment, plumbing, laundry, attic, and departure-admin work before the family drives away Wednesday morning.',
    'hospitality',
    'farm',
    'Every item Marshall identified is complete in its real Atlas task, with no duplicate departure checklist left behind.',
    'Complete every linked task before Wednesday morning departure',
    'moving',
    date '2026-08-05',
    -100,
    v_now,
    jsonb_build_object(
      'deadlineKind', 'departure_hard_stop',
      'departureDate', '2026-08-05',
      'departureTimeSpecified', false,
      'source', 'marshall_handwritten_finish_list_20260804',
      'ownerInstructionAt', v_now,
      'duplicatePolicy', 'link_real_tasks_do_not_create_master_checklist'
    )
  )
  ON CONFLICT (organization_id, stable_key) DO UPDATE
  SET title = excluded.title,
      status = 'active',
      goal_text = excluded.goal_text,
      outcome_text = excluded.outcome_text,
      current_milestone = excluded.current_milestone,
      health_status = excluded.health_status,
      target_date = excluded.target_date,
      last_movement_at = excluded.last_movement_at,
      metadata = atlas.projects.metadata || excluded.metadata,
      updated_at = v_now
  RETURNING id INTO v_project_id;

  INSERT INTO atlas.project_contributors (
    project_id, user_id, contribution_role, active,
    can_create_tasks, can_complete_tasks, can_submit_results, permissions
  ) VALUES
    (v_project_id, v_marshall_user_id, 'lead', true, true, true, true,
      jsonb_build_object('scope','departure_finish_sprint')),
    (v_project_id, v_owner_user_id, 'decision_maker', true, true, true, true,
      jsonb_build_object('scope','departure_finish_sprint'))
  ON CONFLICT (project_id, user_id) DO UPDATE
  SET contribution_role = excluded.contribution_role,
      active = true,
      can_create_tasks = excluded.can_create_tasks,
      can_complete_tasks = excluded.can_complete_tasks,
      can_submit_results = excluded.can_submit_results,
      permissions = atlas.project_contributors.permissions || excluded.permissions,
      updated_at = v_now;

  -- Give reusable stable identities to the existing work that Marshall's list clarified.
  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_cut_departure_trim_pieces')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Cut Remaining Necessary Trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_router_departure_trim')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Router Remaining Necessary Trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_stain_departure_trim')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Owner — Stain Routed Trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_install_existing_trim_rooms')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Hang Remaining Trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260805_install_new_trim_bathroom_kitchen')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Add White Trim to Venue Bathroom Ceiling'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_hang_venue_mirrors_acrylic')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Hang Acrylic Board in Living Room'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_fix_basement_sink_plumbing')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Fix Basement Bathroom Sink Plumbing'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260805_install_flooring_patches')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Install Cured Oak Plywood Floor Patches + Safe Transitions'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_install_working_basement_dryer')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Wire Dryer Circuit + 4-Prong Outlet'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET metadata = task.metadata || jsonb_build_object('task_key','marshall_20260804_move_hutch_library_to_entry')
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Move Hutch to Entryway'
    AND task.status IN ('open','blocked');

  -- Canonical trim fabrication and installation chain.
  UPDATE atlas.tasks task
  SET title = 'Marshall — Cut 2×2 Corner Blocks + 94-Inch Trim Board',
      task_type = 'venue_trim_fabrication',
      priority = 'high',
      due_date = date '2026-08-04',
      action_key = 'build',
      work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker',
      work_lane = 'required',
      commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_cut_departure_trim_pieces',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','build','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Trim fabrication','display_location','Trim shop',
        'display_action','Cut','display_subject','2×2 corner blocks + 94-inch trim board',
        'display_detail','Cut the corner joint blocks and the 94-inch board',
        'execution_checklist_template_key','departure_trim_cut_v1',
        'execution_checklist_title','Cut new trim pieces',
        'execution_checklist_completion_label','Trim pieces are cut',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805',
        'departure_sort_order',100,'must_complete_before_departure',true,
        'schedule_reconciled_at',v_now,'schedule_reconciled_to','2026-08-04',
        'created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_cut_departure_trim_pieces'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Router One Edge of New Trim Boards',
      task_type = 'venue_trim_fabrication',
      priority = 'high', due_date = date '2026-08-04',
      action_key = 'build', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_router_departure_trim',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','build','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Trim fabrication','display_location','Trim shop',
        'display_action','Router','display_subject','One edge of every new trim board',
        'display_detail','Match the profile of the existing trim',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',110,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_router_departure_trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Stain Routed Trim',
      task_type = 'venue_trim_finish', priority = 'high', due_date = date '2026-08-04',
      action_key = 'finish', work_class = 'light',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_stain_departure_trim',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','finish','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Trim fabrication','display_location','Trim shop',
        'display_action','Stain','display_subject','Routed trim',
        'display_detail','Stain every routed board needed for installation',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',120,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_stain_departure_trim'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Install Existing Trim in Venue Rooms',
      task_type = 'venue_trim_installation', priority = 'high', due_date = date '2026-08-04',
      action_key = 'install', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_install_existing_trim_rooms',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','install','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Trim installation','display_location','Bathroom · Library · Dining/Living · Kitchen pantry',
        'display_action','Install','display_subject','Existing trim in venue rooms',
        'display_detail','Reuse the existing trim in each named room',
        'execution_checklist_template_key','departure_existing_trim_v1',
        'execution_checklist_title','Existing trim round',
        'execution_checklist_completion_label','Existing trim is installed',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',130,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_install_existing_trim_rooms'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Install New Trim in Bathroom + Kitchen',
      task_type = 'venue_trim_installation', priority = 'high', due_date = date '2026-08-05',
      action_key = 'install', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260805_install_new_trim_bathroom_kitchen',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','install','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Wednesday finish','display_location','Bathroom · Kitchen',
        'display_action','Install','display_subject','New trim in Bathroom + Kitchen',
        'display_detail','Wednesday installation before departure',
        'execution_checklist_template_key','departure_new_trim_v1',
        'execution_checklist_title','Wednesday trim installation',
        'execution_checklist_completion_label','New trim is installed',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',140,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-05','created_source','owner_instruction_20260804',
        'merged_prior_scope','White trim at venue bathroom ceiling'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260805_install_new_trim_bathroom_kitchen'
    AND task.status IN ('open','blocked');

  -- One coherent hanging round, rather than four duplicate cards.
  UPDATE atlas.tasks task
  SET title = 'Marshall — Hang Venue Mirrors + Acrylic Board',
      task_type = 'venue_furnishings', priority = 'high', due_date = date '2026-08-04',
      action_key = 'install', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_hang_venue_mirrors_acrylic',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','install','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Hanging round','display_location','Living room · Lounge · Bathroom',
        'display_action','Hang','display_subject','Venue mirrors + acrylic board',
        'execution_checklist_template_key','departure_hanging_round_v1',
        'execution_checklist_title','Venue hanging round',
        'execution_checklist_completion_label','Fixtures are hung',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',400,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_hang_venue_mirrors_acrylic'
    AND task.status IN ('open','blocked');

  -- Existing physical tasks receive the clarified deadline and cluster truth.
  UPDATE atlas.tasks task
  SET title = 'Marshall — Fix Basement Bathroom Sink Plumbing',
      task_type = 'marshall_plumbing', priority = 'high', due_date = date '2026-08-04',
      action_key = 'repair', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = task.metadata || jsonb_build_object(
        'task_key','marshall_20260804_fix_basement_sink_plumbing',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','repair','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Plumbing','display_location','Basement bathroom sink',
        'display_action','Fix','display_subject','Basement bathroom sink plumbing',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',300,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_fix_basement_sink_plumbing'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Fix Venue Toilet Plumbing',
      task_type = 'venue_plumbing', priority = 'high', due_date = date '2026-08-04',
      action_key = 'repair', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = task.metadata || jsonb_build_object(
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','repair','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Plumbing','display_location','Venue bathroom',
        'display_action','Fix','display_subject','Venue toilet plumbing',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',310,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804',
        'scope_clarified_from','Install Venue Bathroom Toilet'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260802_install_venue_toilet'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Install Flooring Patches in Marked Areas',
      task_type = 'venue_flooring', priority = 'high', due_date = date '2026-08-05',
      action_key = 'install', work_class = 'heavy',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'process_continuation', commitment_kind = 'dependency',
      metadata = task.metadata || jsonb_build_object(
        'task_key','marshall_20260805_install_flooring_patches',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','install','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Flooring','display_location','Basement stairs · Entry · marked repair locations',
        'display_action','Install','display_subject','Flooring patches in marked areas',
        'display_detail','One Wednesday flooring job across the marked rooms',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',510,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-05','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260805_install_flooring_patches'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Install Working Dryer in Basement',
      task_type = 'marshall_laundry_installation', priority = 'high', due_date = date '2026-08-04',
      action_key = 'install', work_class = 'heavy',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading') || jsonb_build_object(
        'task_key','marshall_20260804_install_working_basement_dryer',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','install','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Basement dryer','display_location','Basement laundry',
        'display_action','Install','display_subject','Working dryer in the basement',
        'display_detail','Wire, breaker, cord, vent, and final move',
        'execution_checklist_template_key','departure_working_dryer_v1',
        'execution_checklist_title','Working dryer installation',
        'execution_checklist_completion_label','Dryer is working downstairs',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',620,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_install_working_basement_dryer'
    AND task.status IN ('open','blocked');

  UPDATE atlas.tasks task
  SET title = 'Marshall — Move Hutch from Library to Entry',
      task_type = 'marshall_house_finish', priority = 'high', due_date = date '2026-08-04',
      action_key = 'move', work_class = 'heavy',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = task.metadata || jsonb_build_object(
        'task_key','marshall_20260804_move_hutch_library_to_entry',
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','move','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Furniture move','display_location','Library → Entry',
        'display_action','Move','display_subject','Hutch from Library to Entry',
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',700,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260804_move_hutch_library_to_entry'
    AND task.status IN ('open','blocked');

  -- The installed attic door's current remaining truth is drywall plus its existing trim.
  UPDATE atlas.tasks task
  SET title = 'Marshall — Finish Attic Bathroom Door Surround',
      task_type = 'marshall_attic_finish', priority = 'high', due_date = date '2026-08-04',
      action_key = 'finish', work_class = 'moderate',
      assigned_membership_id = v_marshall_membership_id,
      assigned_user_id = v_marshall_user_id,
      visibility_scope = 'assigned_worker', work_lane = 'required', commitment_kind = 'hard_date',
      metadata = (task.metadata - 'detail_lines' - 'detail_heading' - 'has_subtasks' - 'subtask_count') || jsonb_build_object(
        'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
        'work_route','finish','work_rhythm','South Dakota Departure Sprint',
        'collection_label','Attic finish','display_location','Attic bathroom door',
        'display_action','Finish','display_subject','Attic bathroom door surround',
        'display_detail','Drywall both sides, then install the existing trim',
        'execution_checklist_template_key','departure_attic_door_surround_v1',
        'execution_checklist_title','Attic bathroom door surround',
        'execution_checklist_completion_label','Attic door surround is finished',
        'checklist_visibility','fully_visible_on_task_card','hide_details',true,
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',800,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804',
        'physical_truth_basis','Doorframe and door are already installed; remaining scope came from Marshall’s current list.'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'marshall_20260725_install_attic_bathroom_door'
    AND task.status IN ('open','blocked');

  -- Existing owner cure check is a real prerequisite, not another floor checklist line.
  UPDATE atlas.tasks task
  SET priority = 'high', due_date = date '2026-08-04',
      work_lane = 'process_continuation', commitment_kind = 'dependency',
      metadata = task.metadata || jsonb_build_object(
        'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',505,
        'must_complete_before_departure',true,'schedule_reconciled_at',v_now,
        'schedule_reconciled_to','2026-08-04','created_source','owner_instruction_20260804'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.metadata ->> 'task_key' = 'owner_20260801_inspect_floor_boards'
    AND task.status IN ('open','blocked');

  -- New real tasks that were absent from Atlas.
  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Replace Part on Elm Mower','equipment_repair','open','high',date '2026-08-04',
    'repair','moderate','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_replace_part_on_elm_mower',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','repair','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Mowers','display_location','Elm mower',
      'display_action','Replace','display_subject','Part on Elm mower',
      'display_detail','Install the replacement part already obtained for Elm’s mower',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',200,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_replace_part_on_elm_mower'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Call Hampton’s About Sheila’s Mower','equipment_call','open','high',date '2026-08-04',
    'call','light','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_call_hamptons_sheila_mower',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','call','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Mowers','display_location','Hampton’s',
      'display_action','Call','display_subject','Hampton’s about Sheila’s mower',
      'display_detail','Ask about the borrowed mower’s blade repair',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',210,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_call_hamptons_sheila_mower'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Owner — Reimburse Melody','owner_reimbursement','open','high',date '2026-08-04',
    'owner','light','management',v_owner_membership_id,v_owner_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','owner_20260804_reimburse_melody',
      'assigned_to','owner','assignee_key','owner','owner_task',true,'marshall_task',true,
      'work_route','owner','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Departure admin','display_location','Reimbursement',
      'display_action','Reimburse','display_subject','Melody',
      'shared_task',true,'shared_with_worker_keys',jsonb_build_array('lex','marshall'),
      'shared_with_membership_ids',jsonb_build_array(v_owner_membership_id,v_marshall_membership_id),
      'shared_visibility_reason','Owner is accountable; Marshall needs shared visibility before departure.',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',900,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='owner_20260804_reimburse_melody'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Remove Damaged Flooring for Patches','venue_flooring_removal','open','high',date '2026-08-04',
    'remove','heavy','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_remove_damaged_flooring_for_patches',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','remove','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Flooring','display_location','Basement stairs · Entry',
      'display_action','Remove','display_subject','Damaged flooring for patches',
      'execution_checklist_template_key','departure_floor_removal_v1',
      'execution_checklist_title','Flooring removal round',
      'execution_checklist_completion_label','Damaged flooring is removed',
      'checklist_visibility','fully_visible_on_task_card','hide_details',true,
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',500,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_remove_damaged_flooring_for_patches'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Buy 20 ft Dryer Vent Hose','purchase','open','high',date '2026-08-04',
    'buy','light','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_buy_20ft_dryer_vent_hose',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','buy','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Departure supplies','display_location','Purchase',
      'display_action','Buy','display_subject','20 ft dryer vent hose',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',600,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_buy_20ft_dryer_vent_hose'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Buy Bolts + Washers for Game/Card Table','purchase','open','high',date '2026-08-04',
    'buy','light','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_buy_card_table_bolts_washers',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','buy','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Departure supplies','display_location','Purchase',
      'display_action','Buy','display_subject','Bolts + washers for game/card table',
      'display_detail','For the dining-room table beside the coffee bar',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',610,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_buy_card_table_bolts_washers'
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    desired.title,'marshall_plumbing','open','high',date '2026-08-04',
    'repair','moderate','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key',desired.task_key,
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','repair','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Plumbing','display_location',desired.location,
      'display_action',desired.display_action,'display_subject',desired.subject,
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',desired.sort_order,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  FROM (VALUES
    ('marshall_20260804_fix_basement_wall_elbow','Marshall — Fix Basement Wall Elbow','Basement wall elbow','Fix','Basement wall elbow',320),
    ('marshall_20260804_replace_leaky_basement_ceiling_pipe','Marshall — Replace Leaky Basement Ceiling Pipe','Basement ceiling','Replace','Leaky basement ceiling pipe',330),
    ('marshall_20260804_replace_valve_sealant','Marshall — Replace Valve Sealant','Plumbing','Replace','Valve sealant',340)
  ) AS desired(task_key,title,location,display_action,subject,sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'=desired.task_key
      AND existing.status IN ('open','blocked')
  );

  INSERT INTO atlas.tasks (
    farm_id, organization_id, title, task_type, status, priority, due_date,
    action_key, work_class, visibility_scope, assigned_membership_id, assigned_user_id,
    created_by_user_id, origin_kind, work_lane, commitment_kind, effort_units, metadata
  )
  SELECT v_farm_id, v_organization_id,
    'Marshall — Move Mini Fridge to Attic Kitchenette','marshall_attic_move','open','high',date '2026-08-04',
    'move','heavy','assigned_worker',v_marshall_membership_id,v_marshall_user_id,
    v_owner_user_id,'owner_assigned','required','hard_date',1,
    jsonb_build_object(
      'task_key','marshall_20260804_move_mini_fridge_attic_kitchenette',
      'assigned_to','marshall','assignee_key','marshall','marshall_task',true,'owner_task',false,
      'work_route','move','work_rhythm','South Dakota Departure Sprint',
      'collection_label','Attic finish','display_location','Attic kitchenette',
      'display_action','Move','display_subject','Mini fridge to attic kitchenette',
      'departure_sprint_key','south_dakota_departure_20260805','departure_sort_order',810,
      'must_complete_before_departure',true,'created_source','owner_instruction_20260804'
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas.tasks existing
    WHERE existing.farm_id=v_farm_id
      AND existing.metadata->>'task_key'='marshall_20260804_move_mini_fridge_attic_kitchenette'
      AND existing.status IN ('open','blocked')
  );

  -- Remove duplicate umbrellas and obsolete steps, while preserving their history.
  UPDATE atlas.tasks task
  SET status = 'archived', due_date = null, blocker_text = null,
      assigned_membership_id = null, assigned_user_id = null,
      visibility_scope = 'system_internal',
      metadata = task.metadata || jsonb_build_object(
        'archived_by','south_dakota_departure_finish_sprint_v1',
        'archived_at',v_now,
        'archive_reason','Scope merged into a more specific canonical departure task.',
        'merged_into_task_key', CASE task.title
          WHEN 'Marshall — Move Dryer Downstairs' THEN 'marshall_20260804_install_working_basement_dryer'
          WHEN 'Owner + Marshall — Finish Entry Floor + Trim Around Laundry/Hutch' THEN 'marshall_20260805_install_flooring_patches'
          WHEN 'Marshall — Complete Venue Bathroom Punch Items' THEN 'specific_venue_bathroom_tasks'
          WHEN 'Owner — Marshall Finish Day' THEN 'elm_south_dakota_departure_finish_20260805'
          ELSE 'specific_departure_tasks'
        END
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.status IN ('open','blocked')
    AND task.title IN (
      'Marshall — Move Dryer Downstairs',
      'Owner + Marshall — Finish Entry Floor + Trim Around Laundry/Hutch',
      'Marshall — Complete Venue Bathroom Punch Items',
      'Owner — Marshall Finish Day'
    );

  UPDATE atlas.tasks child
  SET status = 'archived', due_date = null, blocker_text = null,
      assigned_membership_id = null, assigned_user_id = null,
      visibility_scope = 'system_internal',
      metadata = child.metadata || jsonb_build_object(
        'archived_by','south_dakota_departure_finish_sprint_v1',
        'archived_at',v_now,
        'archive_reason','The door and frame are installed; Marshall’s current list defines drywall and existing trim as the remaining physical scope.',
        'merged_into_task_key','marshall_20260725_install_attic_bathroom_door'
      ),
      updated_at = v_now
  WHERE child.farm_id = v_farm_id
    AND child.status IN ('open','blocked')
    AND child.metadata ->> 'task_key' IN (
      'marshall_attic_door_04_cut_frame_bottom',
      'marshall_attic_door_05_measure_doorway_gap',
      'marshall_attic_door_06_make_gap_filler',
      'marshall_attic_door_07_install_gap_filler',
      'marshall_attic_door_10_finish_gaps'
    );

  -- Bathroom-window trim now lives in the room trim round; leave the actual screen/exterior work intact.
  UPDATE atlas.tasks task
  SET title = 'Marshall — Finish Bathroom Window Screen + Exterior',
      due_date = date '2026-08-04',
      metadata = (task.metadata - 'detail_lines') || jsonb_build_object(
        'detail_lines',jsonb_build_array('Spray outside for wasps','Remove ripped screen'),
        'display_action','Finish','display_subject','Bathroom window screen + exterior',
        'display_detail','Wasps + ripped screen',
        'trim_scope_moved_to','marshall_20260804_install_existing_trim_rooms',
        'schedule_reconciled_at',v_now,'schedule_reconciled_to','2026-08-04'
      ),
      updated_at = v_now
  WHERE task.farm_id = v_farm_id
    AND task.title = 'Marshall — Finish Venue Bathroom Window'
    AND task.status IN ('open','blocked');

  -- Canonical checklist conditions for small, coherent work clusters.
  INSERT INTO atlas.task_execution_checklist_items (
    farm_id, task_id, item_key, section_key, section_label,
    item_label, sort_order, required, checked, metadata
  )
  SELECT v_farm_id, task.id, item.item_key, item.section_key, item.section_label,
         item.item_label, item.sort_order, true, false,
         jsonb_build_object('templateKey',item.template_key,'source','marshall_handwritten_finish_list_20260804')
  FROM (VALUES
    ('marshall_20260804_cut_departure_trim_pieces','departure_trim_cut_v1','cut_corner_blocks','trim_cut','Trim fabrication','Cut the 2×2 corner joint blocks',10),
    ('marshall_20260804_cut_departure_trim_pieces','departure_trim_cut_v1','cut_94_inch_board','trim_cut','Trim fabrication','Cut the 94-inch trim board',20),
    ('marshall_20260804_hang_venue_mirrors_acrylic','departure_hanging_round_v1','hang_living_room_mirror','hanging','Venue fixtures','Hang the living room mirror',10),
    ('marshall_20260804_hang_venue_mirrors_acrylic','departure_hanging_round_v1','hang_lounge_mirror','hanging','Venue fixtures','Hang the Lounge mirror',20),
    ('marshall_20260804_hang_venue_mirrors_acrylic','departure_hanging_round_v1','hang_bathroom_mirror','hanging','Venue fixtures','Hang the bathroom mirror',30),
    ('marshall_20260804_hang_venue_mirrors_acrylic','departure_hanging_round_v1','hang_acrylic_board','hanging','Venue fixtures','Hang the acrylic board',40),
    ('marshall_20260804_remove_damaged_flooring_for_patches','departure_floor_removal_v1','remove_basement_stairs_flooring','floor_removal','Floor removal','Remove the damaged flooring at the basement stairs',10),
    ('marshall_20260804_remove_damaged_flooring_for_patches','departure_floor_removal_v1','remove_entry_flooring','floor_removal','Floor removal','Remove the damaged flooring in the Entry',20),
    ('marshall_20260804_install_working_basement_dryer','departure_working_dryer_v1','run_dryer_wire','dryer','Working dryer','Run wire from the breaker box to the dryer location',10),
    ('marshall_20260804_install_working_basement_dryer','departure_working_dryer_v1','install_dryer_breaker','dryer','Working dryer','Install the dryer breaker',20),
    ('marshall_20260804_install_working_basement_dryer','departure_working_dryer_v1','install_dryer_cord','dryer','Working dryer','Install the new dryer cord',30),
    ('marshall_20260804_install_working_basement_dryer','departure_working_dryer_v1','install_dryer_vent','dryer','Working dryer','Install the dryer vent',40),
    ('marshall_20260804_install_working_basement_dryer','departure_working_dryer_v1','move_dryer_downstairs','dryer','Working dryer','Move the dryer down to the basement and confirm it works',50),
    ('marshall_20260804_install_existing_trim_rooms','departure_existing_trim_v1','existing_trim_bathroom_window','existing_trim','Existing trim','Install the existing trim at the bathroom window',10),
    ('marshall_20260804_install_existing_trim_rooms','departure_existing_trim_v1','existing_trim_library','existing_trim','Existing trim','Install the existing trim in the Library',20),
    ('marshall_20260804_install_existing_trim_rooms','departure_existing_trim_v1','existing_trim_dining_living','existing_trim','Existing trim','Install the existing trim in the dining room/living room',30),
    ('marshall_20260804_install_existing_trim_rooms','departure_existing_trim_v1','existing_trim_kitchen_pantry','existing_trim','Existing trim in the kitchen pantry area',40),
    ('marshall_20260805_install_new_trim_bathroom_kitchen','departure_new_trim_v1','new_trim_bathroom','new_trim','Wednesday trim','Install the new trim in the Bathroom',10),
    ('marshall_20260805_install_new_trim_bathroom_kitchen','departure_new_trim_v1','new_trim_kitchen','new_trim','Wednesday trim','Install the new trim in the Kitchen',20),
    ('marshall_20260725_install_attic_bathroom_door','departure_attic_door_surround_v1','drywall_both_sides','attic_door','Attic bathroom door','Drywall both sides of the attic bathroom door',10),
    ('marshall_20260725_install_attic_bathroom_door','departure_attic_door_surround_v1','install_existing_door_trim','attic_door','Attic bathroom door','Install the existing trim around the attic bathroom door',20)
  ) AS item(task_key,template_key,item_key,section_key,section_label,item_label,sort_order)
  JOIN atlas.tasks task
    ON task.farm_id = v_farm_id
   AND task.metadata ->> 'task_key' = item.task_key
   AND task.status IN ('open','blocked')
  ON CONFLICT (task_id,item_key) DO UPDATE
  SET section_key = excluded.section_key,
      section_label = excluded.section_label,
      item_label = excluded.item_label,
      sort_order = excluded.sort_order,
      required = true,
      metadata = atlas.task_execution_checklist_items.metadata || excluded.metadata,
      updated_at = v_now;

  -- Private owner planning weights. These are not rendered on worker task cards.
  INSERT INTO atlas.task_capacity_profiles (
    task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
    micro_round_key, estimate_source, estimate_confidence, owner_locked, owner_note, metadata
  )
  SELECT task.id, v_farm_id, profile.minutes, profile.load, 'hard_window',
         profile.round_key, 'owner_scope:marshall_departure_list_20260804',
         'owner_confirmed', true,
         'Private owner estimate for the South Dakota departure finish sprint.',
         jsonb_build_object('departureSprintKey','south_dakota_departure_20260805')
  FROM (VALUES
    ('marshall_20260804_cut_departure_trim_pieces',40,'moderate','departure_trim_fabrication'),
    ('marshall_20260804_router_departure_trim',45,'moderate','departure_trim_fabrication'),
    ('marshall_20260804_stain_departure_trim',30,'light','departure_trim_fabrication'),
    ('marshall_20260804_install_existing_trim_rooms',120,'moderate','departure_trim_installation'),
    ('marshall_20260805_install_new_trim_bathroom_kitchen',90,'moderate','departure_trim_installation'),
    ('marshall_20260804_replace_part_on_elm_mower',45,'moderate','departure_mowers'),
    ('marshall_20260804_call_hamptons_sheila_mower',10,'light','departure_mowers'),
    ('owner_20260804_reimburse_melody',10,'light','departure_admin'),
    ('marshall_20260804_hang_venue_mirrors_acrylic',75,'moderate','departure_hanging_round'),
    ('marshall_20260804_fix_basement_sink_plumbing',45,'moderate','departure_plumbing'),
    ('marshall_20260802_install_venue_toilet',60,'moderate','departure_plumbing'),
    ('marshall_20260804_fix_basement_wall_elbow',30,'moderate','departure_plumbing'),
    ('marshall_20260804_replace_leaky_basement_ceiling_pipe',60,'heavy','departure_plumbing'),
    ('marshall_20260804_replace_valve_sealant',30,'moderate','departure_plumbing'),
    ('marshall_20260804_remove_damaged_flooring_for_patches',60,'heavy','departure_flooring'),
    ('owner_20260801_inspect_floor_boards',5,'light','departure_flooring'),
    ('marshall_20260805_install_flooring_patches',120,'heavy','departure_flooring'),
    ('marshall_20260804_buy_20ft_dryer_vent_hose',30,'light','departure_supplies'),
    ('marshall_20260804_buy_card_table_bolts_washers',20,'light','departure_supplies'),
    ('marshall_20260804_install_working_basement_dryer',180,'heavy','departure_dryer'),
    ('marshall_20260804_move_hutch_library_to_entry',20,'heavy','departure_furniture'),
    ('marshall_20260725_install_attic_bathroom_door',90,'moderate','departure_attic_finish'),
    ('marshall_20260804_move_mini_fridge_attic_kitchenette',20,'heavy','departure_attic_finish')
  ) AS profile(task_key,minutes,load,round_key)
  JOIN atlas.tasks task
    ON task.farm_id=v_farm_id
   AND task.metadata->>'task_key'=profile.task_key
   AND task.status IN ('open','blocked')
  ON CONFLICT (task_id) DO UPDATE
  SET expected_active_minutes=excluded.expected_active_minutes,
      physical_load=excluded.physical_load,
      base_obligation_class=excluded.base_obligation_class,
      micro_round_key=excluded.micro_round_key,
      estimate_source=excluded.estimate_source,
      estimate_confidence=excluded.estimate_confidence,
      owner_locked=true,
      owner_note=excluded.owner_note,
      metadata=atlas.task_capacity_profiles.metadata || excluded.metadata,
      updated_at=v_now;

  -- True physical prerequisites, not arbitrary checklist ordering.
  INSERT INTO atlas.task_prerequisites (
    farm_id, downstream_task_id, prerequisite_task_id,
    required_status, hold_mode, sequence_order, active, metadata
  )
  SELECT v_farm_id, downstream.id, prerequisite.id, 'done', 'blocked_visible', gate.sequence_order, true,
         jsonb_build_object('source','south_dakota_departure_finish_sprint_v1','reason',gate.reason)
  FROM (VALUES
    ('marshall_20260804_router_departure_trim','marshall_20260804_cut_departure_trim_pieces',100,'The boards must be cut before the routing task can be complete.'),
    ('marshall_20260804_stain_departure_trim','marshall_20260804_router_departure_trim',110,'The trim must be routed before staining.'),
    ('marshall_20260805_install_new_trim_bathroom_kitchen','marshall_20260804_stain_departure_trim',120,'The new trim must be stained before installation.'),
    ('marshall_20260805_install_flooring_patches','marshall_20260804_remove_damaged_flooring_for_patches',500,'The damaged flooring must be removed before patches are installed.'),
    ('marshall_20260805_install_flooring_patches','owner_20260801_inspect_floor_boards',505,'The finished boards must be approved as cured before installation.')
  ) AS gate(downstream_key,prerequisite_key,sequence_order,reason)
  JOIN atlas.tasks downstream
    ON downstream.farm_id=v_farm_id
   AND downstream.metadata->>'task_key'=gate.downstream_key
   AND downstream.status IN ('open','blocked')
  JOIN atlas.tasks prerequisite
    ON prerequisite.farm_id=v_farm_id
   AND prerequisite.metadata->>'task_key'=gate.prerequisite_key
  ON CONFLICT (downstream_task_id,prerequisite_task_id) DO UPDATE
  SET required_status='done', hold_mode='blocked_visible',
      sequence_order=excluded.sequence_order, active=true,
      satisfied_at=CASE WHEN atlas.task_prerequisites.satisfied_at IS NOT NULL
                        AND prerequisite.status='done' THEN atlas.task_prerequisites.satisfied_at
                        ELSE NULL END,
      metadata=atlas.task_prerequisites.metadata || excluded.metadata,
      updated_at=v_now;

  PERFORM atlas.reconcile_task_prerequisite_gate_v1(task.id,v_now)
  FROM atlas.tasks task
  WHERE task.farm_id=v_farm_id
    AND task.metadata->>'task_key' IN (
      'marshall_20260804_router_departure_trim',
      'marshall_20260804_stain_departure_trim',
      'marshall_20260805_install_new_trim_bathroom_kitchen',
      'marshall_20260805_install_flooring_patches'
    );

  -- Link the real tasks to the departure project. The project itself has no duplicate completion checklist.
  INSERT INTO atlas.project_task_links (
    project_id, task_id, link_role, sort_order, source, metadata
  )
  SELECT v_project_id, task.id, 'belongs_to',
         coalesce((task.metadata->>'departure_sort_order')::integer,1000),
         'owner_instruction_20260804',
         jsonb_build_object('departureSprintKey','south_dakota_departure_20260805')
  FROM atlas.tasks task
  WHERE task.farm_id=v_farm_id
    AND task.status IN ('open','blocked')
    AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805'
  ON CONFLICT (project_id,task_id) DO UPDATE
  SET link_role='belongs_to', sort_order=excluded.sort_order,
      source=excluded.source,
      metadata=atlas.project_task_links.metadata || excluded.metadata,
      updated_at=v_now;

  -- Keep occurrence truth aligned with the repurposed task cards.
  UPDATE atlas.planned_work_occurrences occurrence
  SET title=task.title,
      planned_due_date=task.due_date,
      work_lane=task.work_lane,
      commitment_kind=task.commitment_kind,
      task_payload=coalesce(occurrence.task_payload,'{}'::jsonb) || jsonb_build_object(
        'title',task.title,'task_type',task.task_type,'priority',task.priority,
        'due_date',task.due_date,'action_key',task.action_key,'work_class',task.work_class,
        'visibility_scope',task.visibility_scope,
        'assigned_membership_id',task.assigned_membership_id,
        'assigned_user_id',task.assigned_user_id,
        'work_lane',task.work_lane,'commitment_kind',task.commitment_kind,
        'metadata',task.metadata
      ),
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'reconciledBy','south_dakota_departure_finish_sprint_v1',
        'reconciledAt',v_now
      ),
      updated_at=v_now
  FROM atlas.tasks task
  WHERE task.farm_id=v_farm_id
    AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805'
    AND (occurrence.id=task.planned_occurrence_id OR occurrence.released_task_id=task.id);

  UPDATE atlas.planned_work_occurrences occurrence
  SET state='completed',
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'completedBy','south_dakota_departure_finish_sprint_v1',
        'completedReason','Released task was archived after its scope was merged into a canonical specific task.',
        'completedAt',v_now
      ),
      updated_at=v_now
  FROM atlas.tasks task
  WHERE task.farm_id=v_farm_id
    AND task.status='archived'
    AND task.metadata->>'archived_by'='south_dakota_departure_finish_sprint_v1'
    AND (occurrence.id=task.planned_occurrence_id OR occurrence.released_task_id=task.id);
END;
$migration$;

DO $verify$
DECLARE
  v_farm_id uuid;
  v_project_id uuid;
  v_linked_count integer;
  v_checklist_count integer;
BEGIN
  SELECT id INTO v_farm_id FROM atlas.farms WHERE stable_key='elm_farm';
  SELECT id INTO v_project_id
  FROM atlas.projects
  WHERE organization_id=(SELECT organization_id FROM atlas.farms WHERE id=v_farm_id)
    AND stable_key='elm_south_dakota_departure_finish_20260805';

  SELECT count(*)::integer INTO v_linked_count
  FROM atlas.project_task_links link
  JOIN atlas.tasks task ON task.id=link.task_id
  WHERE link.project_id=v_project_id
    AND task.status IN ('open','blocked')
    AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805';

  IF v_linked_count <> 23 THEN
    RAISE EXCEPTION 'Expected 23 real departure tasks linked to the project; found %.',v_linked_count;
  END IF;

  SELECT count(*)::integer INTO v_checklist_count
  FROM atlas.task_execution_checklist_items item
  JOIN atlas.tasks task ON task.id=item.task_id
  WHERE task.farm_id=v_farm_id
    AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805';

  IF v_checklist_count <> 21 THEN
    RAISE EXCEPTION 'Expected 21 checklist conditions across coherent task clusters; found %.',v_checklist_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.farm_id=v_farm_id
      AND task.status IN ('open','blocked')
      AND task.title IN (
        'Marshall — Move Dryer Downstairs',
        'Owner + Marshall — Finish Entry Floor + Trim Around Laundry/Hutch',
        'Marshall — Complete Venue Bathroom Punch Items',
        'Owner — Marshall Finish Day'
      )
  ) THEN
    RAISE EXCEPTION 'A superseded umbrella or duplicate task remains active.';
  END IF;

  IF EXISTS (
    SELECT task.metadata->>'task_key'
    FROM atlas.tasks task
    WHERE task.farm_id=v_farm_id
      AND task.status IN ('open','blocked')
      AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805'
    GROUP BY task.metadata->>'task_key'
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Duplicate active departure task identities remain.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM atlas.tasks task
    WHERE task.farm_id=v_farm_id
      AND task.status IN ('open','blocked')
      AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805'
      AND (task.due_date IS NULL OR task.due_date>date '2026-08-05')
  ) THEN
    RAISE EXCEPTION 'A departure task is scheduled after the Wednesday departure date.';
  END IF;

  IF (SELECT count(*) FROM atlas.tasks task
      WHERE task.farm_id=v_farm_id
        AND task.status IN ('open','blocked')
        AND task.metadata->>'departure_sprint_key'='south_dakota_departure_20260805'
        AND task.metadata->>'collection_label'='Plumbing') <> 5 THEN
    RAISE EXCEPTION 'The Plumbing cluster must contain five distinct real repair tasks.';
  END IF;
END;
$verify$;

commit;
