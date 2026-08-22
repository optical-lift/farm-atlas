-- Reconcile Atlas functions that inherited PostgreSQL's default PUBLIC EXECUTE.
--
-- The schema-scoped ALTER DEFAULT PRIVILEGES below is retained to mirror the
-- production migration. PostgreSQL does not let a per-schema REVOKE override
-- the global PUBLIC function default; migration 20260822180124 installs the
-- effective Atlas-only DDL guard.

alter default privileges for role postgres in schema atlas
  revoke execute on functions from public;

-- Trigger-only and database-internal helpers. Their trigger / SECURITY DEFINER /
-- owner execution continues; they are not direct PostgREST RPC surfaces.
revoke all on function atlas.attach_apply_treatment_target_trigger_v1() from public, anon, authenticated;
revoke all on function atlas.attach_apply_treatment_target_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.attach_farm_round_member_task_v1() from public, anon, authenticated;
revoke all on function atlas.canonicalize_weekly_harvest_occurrence_title_v1() from public, anon, authenticated;
revoke all on function atlas.canonicalize_weekly_harvest_task_title_v1() from public, anon, authenticated;
revoke all on function atlas.community_event_worker_display_name_v1(text) from public, anon, authenticated;
revoke all on function atlas.community_event_worker_time_label_v1(date, time without time zone, time without time zone) from public, anon, authenticated;
revoke all on function atlas.complete_farm_round_parent_v1() from public, anon, authenticated;
revoke all on function atlas.complete_task_execution_components_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function atlas.ensure_community_thursday_venue_cycle_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.ensure_farm_round_for_date_v1(uuid, uuid, date) from public, anon, authenticated;
revoke all on function atlas.ensure_venue_reset_checklist_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.materialize_farm_round_members_trigger_v1() from public, anon, authenticated;
revoke all on function atlas.materialize_farm_round_members_v1(uuid, date) from public, anon, authenticated;
revoke all on function atlas.normalize_execution_checklist_quick_complete_v1() from public, anon, authenticated;
revoke all on function atlas.owner_worker_day_plan_choreographed_v1(uuid, uuid, date) from public, anon, authenticated;
revoke all on function atlas.presented_work_selection_rows_v3(uuid, uuid, date) from public, anon, authenticated;
revoke all on function atlas.reconcile_farm_round_completion_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.refresh_farm_round_preview_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.roll_expired_farm_worker_tasks_v1() from public, anon, authenticated;
revoke all on function atlas.roll_expired_worker_tasks_v1(uuid, uuid, date) from public, anon, authenticated;
revoke all on function atlas.seed_community_thursday_venue_cycle_checklist_trigger_v1() from public, anon, authenticated;
revoke all on function atlas.seed_community_thursday_venue_cycle_checklist_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.sync_community_event_worker_identity_trigger_v1() from public, anon, authenticated;
revoke all on function atlas.sync_community_event_worker_identity_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.sync_community_thursday_venue_cycle_v1() from public, anon, authenticated;
revoke all on function atlas.sync_event_blooms_from_flower_task_v1() from public, anon, authenticated;
revoke all on function atlas.sync_farm_round_from_occurrence_v1() from public, anon, authenticated;
revoke all on function atlas.sync_venue_reset_checklist_v1() from public, anon, authenticated;
revoke all on function atlas.task_component_scope_snapshot_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.worker_day_selection_overlay_v1(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function atlas.worker_day_temporal_mode_v1(uuid, date) from public, anon, authenticated;
revoke all on function atlas.worker_historical_day_plan_v1(uuid, uuid, date) from public, anon, authenticated;

-- v2 was an intermediate production fast-path experiment. The source/runtime
-- Worker Day reader uses worker_self_day_bundle_api_v1, so v2 remains callable
-- only from database-owner context rather than as a second client aperture.
revoke all on function atlas.worker_self_day_bundle_api_v2(uuid, uuid, date) from public, anon, authenticated;

-- Reassert the two intentional authenticated read membranes added by #491/#492.
revoke all on function atlas.day_reservations_api_v2(uuid, uuid, date) from public, anon, authenticated;
grant execute on function atlas.day_reservations_api_v2(uuid, uuid, date) to authenticated;

revoke all on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) from public, anon, authenticated;
grant execute on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) to authenticated;

insert into atlas.authenticated_rpc_registry(
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
  registered_at,
  reviewed_at,
  anonymous_execute_expected
)
values
  (
    'atlas.day_reservations_api_v2(uuid, uuid, date)',
    'app_endpoint',
    'verified',
    'active',
    true,
    true,
    false,
    1,
    0,
    jsonb_build_object(
      'purpose','Read active dated Worker Day reservations through one authenticated reconciliation/read boundary.',
      'caller','lib/atlas/day-reservations-server.ts',
      'authorizationBoundary','Function derives auth.uid() and requires the target active Farm Hand or an active farm Owner.',
      'performance','Skips fixed-routine reconciliation when no applicable routine or stale fixed-routine reservation exists.',
      'publicInheritanceRemoved',true,
      'contractVersion','day_reservations_api_v2'
    ),
    now(),
    now(),
    false
  ),
  (
    'atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date)',
    'app_endpoint',
    'verified',
    'active',
    true,
    true,
    false,
    0,
    0,
    jsonb_build_object(
      'purpose','Read canonical Worker Day choreography and reservations in one authenticated round trip.',
      'authorizationBoundary','Delegates choreography authorization to worker_day_choreography_api_v1 before reservation composition.',
      'performance','Prepared replacement for the current two parallel choreography/reservation RPCs; not yet wired at this reconciliation.',
      'publicInheritanceRemoved',true,
      'contractVersion','worker_day_choreography_bundle_v2'
    ),
    now(),
    now(),
    false
  )
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();