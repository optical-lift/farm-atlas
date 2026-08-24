import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationName = "20260731211500_atlas_authenticated_rpc_registry_v1.sql";
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const migration = readMigration(migrationName);
const normalized = migration.replace(/\s+/g, " ").trim();
const liveProof = readFileSync(new URL("../supabase/tests/atlas_authenticated_rpc_registry_v1.sql", import.meta.url), "utf8");

const paired = {
  "20260804070500_thursday_morning_execution_checklist_v1.sql": "20260804070700_thursday_morning_execution_checklist_rpc_registry_v1.sql",
  "20260804074000_thursday_morning_checklist_clusters_v2.sql": "20260804075500_thursday_morning_clusters_rpc_registry_v2.sql",
  "20260804225015_task_notification_actions_v1.sql": "20260804225100_task_notification_actions_rpc_registry_v1.sql",
  "20260807134500_grey_couch_decision_selector_v1.sql": "20260807134600_grey_couch_decision_selector_rpc_registry_v1.sql",
  "20260807162500_contractor_service_visit_status_v1.sql": "20260807162600_contractor_service_visit_status_rpc_registry_v1.sql",
  "20260808023000_owner_week_projection_v1.sql": "20260808023100_owner_week_projection_rpc_registry_v1.sql",
  "20260808231140_atlas_sky_ledger_and_operation_rules_v1.sql": "20260808231809_atlas_sky_rpc_registry_v1.sql",
  "20260808231244_atlas_sky_ledger_ingest_boundary_v1.sql": "20260808231809_atlas_sky_rpc_registry_v1.sql",
  "20260808233130_atlas_sky_fitness_runtime_v2.sql": "20260808233332_atlas_sky_runtime_security_registry_v1.sql",
  "20260809011103_atlas_sky_deferrability_and_iris_window_v1.sql": "20260809012855_atlas_sky_deferral_rpc_registry_v1.sql",
  "20260809183000_real_project_hierarchy_and_shared_moves.sql": "20260809183100_project_move_context_rpc_registry_v1.sql",
  "20260809203000_owner_worker_day_plan_kernel_v1.sql": "20260809203200_owner_worker_day_plan_rpc_registry_v1.sql",
  "20260809203100_owner_worker_day_schedule_commit_v2.sql": "20260809203200_owner_worker_day_plan_rpc_registry_v1.sql",
  "20260810171500_add_buyer_contact_event_pipeline.sql": "20260810171600_buyer_outreach_rpc_registry_v1.sql",
  "20260811154000_atlas_day_choreography_foundation_v1.sql": "20260811162500_atlas_day_choreography_rpc_registry_v1.sql",
  "20260811160000_atlas_day_choreography_plan_overlay_v1.sql": "20260811162500_atlas_day_choreography_rpc_registry_v1.sql",
  "20260811162000_atlas_day_cue_mutations_v1.sql": "20260811162500_atlas_day_choreography_rpc_registry_v1.sql",
  "20260814133500_owner_day_reservation_commands_v1.sql": "20260814141600_owner_day_reservation_rpc_registry_v1.sql",
  "20260814141500_fixed_routine_projection_hardening_v1.sql": "20260814141600_owner_day_reservation_rpc_registry_v1.sql",
  "20260816001514_clock_placement_occurrence_provenance_v1.sql": "20260817151627_clock_occurrence_internal_rpc_reconciliation_v1.sql",
  "20260816220448_worker_week_projection_canonical_cutover_v1.sql": "20260817025000_worker_week_projection_rpc_registry_reconciliation_v1.sql",
  "20260817213537_reality_expression_spatial_truth_v1.sql": "20260817214322_reality_expression_spatial_rpc_registry_v1.sql",
  "20260817213813_refine_spatial_supersession_evidence_v1.sql": "20260817214322_reality_expression_spatial_rpc_registry_v1.sql",
  "20260818140510_worker_capacity_management_outcome_and_principal_gate_functions_v2.sql": "20260818140525_worker_capacity_management_rpc_registry_v1.sql",
  "20260820193337_worker_task_execution_readiness_api_v1.sql": "20260820193959_worker_task_execution_readiness_rpc_registry_v1.sql",
  "20260821161000_unify_weekly_harvest_card_v1.sql": "20260821163400_weekly_harvest_rpc_registry_and_privilege_hardening_v1.sql",
  "20260821162442_align_weekly_harvest_mockup_recording_v2.sql": "20260821163400_weekly_harvest_rpc_registry_and_privilege_hardening_v1.sql",
  "20260822154955_atlas_entity_identity_review_bridge_v1.sql": "20260822155702_entity_identity_review_rpc_registry_v1.sql",
  "20260822174152_worker_fast_path_execute_scope_v1.sql": "20260822175956_reconcile_recent_atlas_rpc_execute_surface_v1.sql",
  "20260823232012_farm_continuity_terminal_census_v1.sql": "20260823233407_farm_terminal_census_v2_rpc_registry_reconciliation_v1.sql",
  "20260823232534_farm_continuity_terminal_census_requirement_semantics_v2.sql": "20260823233407_farm_terminal_census_v2_rpc_registry_reconciliation_v1.sql",
  "20260823233129_farm_terminal_census_v2_release_contract.sql": "20260823233407_farm_terminal_census_v2_rpc_registry_reconciliation_v1.sql",
};

const batchedPresentedWorkMigrations = new Set([
  "20260802124000_atlas_presented_work_contract_v1.sql",
  "20260802125000_atlas_presented_work_reader_cutover_v1.sql",
  "20260802130000_atlas_work_reservoir_backlog_reconciliation_v1.sql",
  "20260802131000_atlas_owner_tomorrow_preflight_v1.sql",
]);

const dayAcceptanceRpcMigrations = new Set([
  "20260811180500_atlas_day_cue_observation_result_contract_v1.sql",
  "20260811183000_atlas_departure_requirement_cues_v1.sql",
  "20260811185000_atlas_event_day_briefing_v1.sql",
  "20260811190000_atlas_owner_cue_edit_preserves_result_contract_v1.sql",
]);

const workerHarvestHistoricalRpcMigrations = new Set([
  "20260816001514_clock_placement_occurrence_provenance_v1.sql",
  "20260816003305_work_occurrence_temporal_contract_v1.sql",
  "20260816010010_day_aware_human_capacity_v1.sql",
  "20260816025802_worker_day_deferrability_v1.sql",
  "20260816025928_worker_day_real_day_synthetic_cleanup_v1.sql",
  "20260816041034_worker_day_chronology_foundation_v1.sql",
  "20260816041346_worker_day_chronology_ordering_hardening_v1.sql",
  "20260816132822_worker_weekly_farm_contract_boolean_classification_fix_v1.sql",
  "20260816133225_worker_weekly_farm_contract_exclude_personal_noncounting_v1.sql",
  "20260816133340_worker_weekly_farm_contract_no_silent_hard_date_carry_v1.sql",
  "20260816133532_worker_delay_consequence_classifier_v1.sql",
  "20260816133707_worker_dependency_consequence_inheritance_v1.sql",
  "20260816133801_worker_weekly_farm_contract_consequence_overlay_v1.sql",
  "20260816134246_protected_farm_minimum_classifier_v1.sql",
  "20260816134337_worker_weekly_farm_contract_protected_minimum_v2.sql",
  "20260816141452_clock_functional_taxonomy_v1.sql",
  "20260816141523_worker_weekly_farm_contract_clock_traits_v3.sql",
  "20260816141729_worker_human_time_reservation_contract_v1.sql",
  "20260816141937_worker_farm_admin_lane_v1.sql",
  "20260816142156_clock_functional_taxonomy_location_environment_fix_v1.sql",
  "20260816142426_worker_living_propagation_lane_v1.sql",
  "20260816142732_worker_next_up_contract_v1.sql",
  "20260816142939_execution_destination_readiness_v1.sql",
  "20260816142959_clock_functional_taxonomy_transplant_execution_v2.sql",
  "20260816143105_worker_next_up_contract_v2.sql",
  "20260816143411_worker_weekly_farm_contract_readiness_protected_promotion_v5.sql",
  "20260816143506_worker_living_propagation_lane_readiness_v2.sql",
  "20260816144147_worker_capacity_window_and_farm_clock_conflict_v1.sql",
  "20260816154444_farm_continuity_auditor_v1.sql",
  "20260816155032_production_actual_reforecast_v1.sql",
  "20260816155520_production_operation_actuals_v1.sql",
  "20260816155555_production_clear_turnover_actuals_v1.sql",
  "20260816155741_farm_continuity_auditor_reforecast_v2.sql",
  "20260816162548_harvest_flower_independent_demand_schema_v1.sql",
  "20260816162649_harvest_flower_demand_commands_v1.sql",
  "20260816163428_harvest_flower_demand_allocation_truth_v1.sql",
  "20260816163512_harvest_flower_demand_allocation_commands_v1.sql",
  "20260816163711_harvest_flower_demand_to_sale_conversion_v1.sql",
  "20260816163953_harvest_flower_standing_demand_materialization_v1.sql",
  "20260816164306_harvest_flower_prospect_route_commands_v1.sql",
  "20260816164704_harvest_flower_prospect_to_sale_conversion_v1.sql",
]);

const principalHistoricalRpcMigrations = new Set([
  "20260816184935_principal_foundation_domains_v1.sql",
  "20260816185233_principal_foundation_authoring_contracts_v1.sql",
  "20260816203751_principal_clock_arbitration_v1.sql",
  "20260816203924_principal_clock_api_identity_fix_v1.sql",
  "20260816204206_principal_self_context_clock_v1.sql",
  "20260816204459_principal_office_attention_foundation_v1.sql",
  "20260816204719_principal_office_functions_scoreboards_v1.sql",
  "20260816204816_principal_house_position_treasury_v1.sql",
  "20260816204934_principal_office_context_v1.sql",
  "20260816205006_principal_self_context_office_v1.sql",
]);

const presentedWorkRegistry = "20260802133000_atlas_presented_work_rpc_registry_v1.sql";
const dayAcceptanceRegistry = "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql";
const workerHarvestRegistry = "20260817153523_worker_harvest_rpc_registry_reconciliation_v1.sql";
const principalRegistry = "20260817005100_principal_rpc_registry_reconciliation_v1.sql";
const rpcPrivilegeStart = "20260813174114_worker_clock_exact_task_time_v1.sql";
const rpcPrivilegeRegistry = "20260819225913_atlas_rpc_privilege_registry_reconciliation_v2.sql";
const structuredWorkRpcStart = "20260823002136_add_structured_work_execution_grammar_v1.sql";
const structuredWorkRpcRegistry = "20260823023849_structured_work_rpc_registry_v1.sql";
const futurePreflightTransientGrant = "20260823220114_future_transplant_truth_preflight_v1.sql";
const futurePreflightScopeRestoration = "20260823220700_future_truth_preflight_snapshot_execute_scope_v1.sql";

function pairedRegistryFor(name) {
  if (paired[name]) return paired[name];
  if (batchedPresentedWorkMigrations.has(name)) return presentedWorkRegistry;
  if (dayAcceptanceRpcMigrations.has(name)) return dayAcceptanceRegistry;
  if (workerHarvestHistoricalRpcMigrations.has(name)) return workerHarvestRegistry;
  if (principalHistoricalRpcMigrations.has(name)) return principalRegistry;
  if (name >= rpcPrivilegeStart && name < rpcPrivilegeRegistry) return rpcPrivilegeRegistry;
  if (name >= structuredWorkRpcStart && name < structuredWorkRpcRegistry) return structuredWorkRpcRegistry;
  return null;
}

test("registry freezes the complete signed-in Atlas RPC surface", () => {
  assert.match(normalized, /authenticated_count <> 198/i);
  assert.match(normalized, /anonymous_count <> 0/i);
  assert.match(normalized, /pending_internal_count <> 23/i);
  assert.match(normalized, /CREATE TABLE atlas\.authenticated_rpc_registry/i);
  assert.match(normalized, /oidvectortypes\(p\.proargtypes\)/i);
  assert.match(normalized, /authenticated_execute_expected BOOLEAN NOT NULL/i);
});

test("registry records the four RPC classes and review confidence", () => {
  for (const classification of ["app_endpoint", "owner_admin_endpoint", "policy_or_composition_helper", "service_internal"]) assert.ok(migration.includes(`'${classification}'`));
  for (const confidence of ["verified", "provisional"]) assert.ok(migration.includes(`'${confidence}'`));
  for (const status of ["active", "pending_revoke", "revoked"]) assert.ok(migration.includes(`'${status}'`));
});

test("registry and drift inspection remain service-only", () => {
  assert.match(normalized, /REVOKE ALL ON TABLE atlas\.authenticated_rpc_registry FROM PUBLIC, anon, authenticated/i);
  assert.match(normalized, /GRANT SELECT ON TABLE atlas\.authenticated_rpc_registry TO service_role/i);
  assert.match(normalized, /REVOKE ALL ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(normalized, /GRANT EXECUTE ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) TO service_role/i);
  assert.match(normalized, /SET search_path = pg_catalog, atlas/i);
});

test("drift proof covers privilege and security-mode drift", () => {
  for (const issue of ["unregistered_authenticated", "missing_expected_authenticated", "unexpected_authenticated", "security_mode_mismatch", "service_execute_mismatch", "anonymous_execute"]) assert.ok(migration.includes(`'${issue}'`));
  assert.match(liveProof, /authenticated_rpc_registry_drift_v1/i);
});

test("future authenticated EXECUTE changes are registered in-place, reconciled, or explicitly restored before release", () => {
  const laterMigrations = readdirSync(migrationsDirectory, { encoding: "utf8" }).filter((name) => name.endsWith(".sql") && name > migrationName).sort();

  for (const name of laterMigrations) {
    const sql = readMigration(name);
    const changesAuthenticatedExecute = /\b(?:GRANT|REVOKE)\s+EXECUTE\b[\s\S]{0,400}\b(?:TO|FROM)\s+authenticated\b/i.test(sql);

    if (changesAuthenticatedExecute && !/atlas\.authenticated_rpc_registry/i.test(sql)) {
      if (name === futurePreflightTransientGrant) {
        assert.match(sql, /grant execute on function atlas\.crop_cycle_requirement_snapshot_v1\(uuid,date\) to authenticated,service_role/i);
        const restorationSql = readMigration(futurePreflightScopeRestoration);
        assert.ok(name < futurePreflightScopeRestoration, `${name} must precede its scope restoration`);
        assert.match(restorationSql, /revoke all on function atlas\.crop_cycle_requirement_snapshot_v1\(uuid,date\) from public,anon,authenticated/i);
        assert.match(restorationSql, /grant execute on function atlas\.crop_cycle_requirement_snapshot_v1\(uuid,date\) to service_role/i);
      } else {
        const registryName = pairedRegistryFor(name);
        assert.ok(registryName, `${name} changes authenticated EXECUTE without updating the registry`);
        assert.ok(name < registryName, `${name} must be followed by its ordered RPC registry reconciliation`);
        const registrySql = readMigration(registryName);
        assert.match(registrySql, /atlas\.authenticated_rpc_registry/i, `${registryName} must update the authenticated RPC registry`);
      }
    }

    assert.doesNotMatch(sql, /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS[\s\S]{0,200}\bauthenticated\b/i, `${name} must not broadly grant authenticated function execution`);
  }
});

test("new Atlas functions are stripped of inherited PUBLIC execute at DDL time", () => {
  const guard = readMigration("20260822180124_enforce_atlas_function_private_default_v1.sql");
  assert.match(guard, /returns event_trigger/i);
  assert.match(guard, /pg_event_trigger_ddl_commands\(\)/i);
  assert.match(guard, /command\.schema_name = 'atlas'/i);
  assert.match(guard, /revoke execute on function %s from public/i);
  assert.match(guard, /create event trigger atlas_private_function_default_v1/i);
});

test("the current weekly Harvest RPC boundary is explicit, least-privilege, and versioned", () => {
  const registry = readMigration("20260821163400_weekly_harvest_rpc_registry_and_privilege_hardening_v1.sql");
  for (const signature of [
    "atlas.weekly_harvest_task_state_for_member_v1(uuid, uuid)",
    "atlas.owner_operator_weekly_harvest_task_state_v1(uuid, uuid)",
    "atlas.record_weekly_harvest_row_for_member_v1(uuid, uuid, uuid, text, text, text, text, text)",
    "atlas.owner_operator_record_weekly_harvest_row_v1(uuid, uuid, uuid, text, text, text, text, text)",
    "atlas.record_weekly_harvest_row_for_member_v2(uuid, uuid, uuid, text, integer, text)",
    "atlas.owner_operator_record_weekly_harvest_row_v2(uuid, uuid, uuid, text, integer, text)",
  ]) assert.ok(registry.includes(signature));
  assert.match(registry, /from public, anon, authenticated/i);
  assert.match(registry, /'revoked',false,true,true/);
  assert.match(registry, /'active',true,true,true/);
  assert.match(registry, /anonymous_execute_expected/);
  assert.match(registry, /weekly_harvest_round_v2/);
});

test("latest generic readiness endpoint remains registered as an app endpoint", () => {
  const registry = readMigration("20260820193959_worker_task_execution_readiness_rpc_registry_v1.sql");
  assert.ok(registry.includes("atlas.worker_task_execution_readiness_api_v1(uuid)"));
  assert.match(registry, /app_endpoint/);
});
