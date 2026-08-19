import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const foundation = readFileSync(
  "supabase/migrations/20260818045533_worker_weekly_labor_claims_and_optional_capacity_guard_v1.sql",
  "utf8",
);
const composition = readFileSync(
  "supabase/migrations/20260818135842_worker_labor_claims_physical_load_contract_v6_and_conflict_v2.sql",
  "utf8",
);
const management = readFileSync(
  "supabase/migrations/20260818140312_worker_capacity_management_occurrence_boundary_v1.sql",
  "utf8",
);
const principalGate = readFileSync(
  "supabase/migrations/20260818140510_worker_capacity_management_outcome_and_principal_gate_functions_v2.sql",
  "utf8",
);
const registry = readFileSync(
  "supabase/migrations/20260818140525_worker_capacity_management_rpc_registry_v1.sql",
  "utf8",
);

test("Phase 11 composes labor claims from native capacity, reservation, contract, and placement rails", () => {
  assert.match(foundation, /worker_weekly_labor_claims_v1/i);
  assert.match(foundation, /worker_weekly_farm_contract_v5/i);
  assert.match(foundation, /worker_capacity_window_v1/i);
  assert.match(foundation, /worker_day_task_placements/i);
  assert.match(foundation, /humanTime,reservations/i);
  assert.match(foundation, /requiredWeeklyWork/i);
  assert.match(foundation, /protectedRequiredClaimMinutes/i);
  assert.match(foundation, /remainingOptionalPlannedAvailabilityMinutes/i);
  assert.match(foundation, /estimatedMinutesAreCapacityClaimsNotLaborActuals/i);
  assert.match(foundation, /humanReservationsReduceSourceCapacityAndAreNotSubtractedTwice/i);
  assert.doesNotMatch(foundation, /create table/i);
});

test("optional Worker Day placement is guarded at the canonical placement write boundary", () => {
  assert.match(foundation, /validate_worker_day_optional_capacity_claim_v1/i);
  assert.match(foundation, /worker_day_task_placements_optional_capacity_claim_v1/i);
  assert.match(foundation, /before insert or update on atlas\.worker_day_task_placements/i);
  assert.match(foundation, /Optional work would consume weekly capacity already claimed by required\/protected work/i);
  assert.match(foundation, /Required\/protected work may acquire capacity/i);
  assert.match(foundation, /principalEscalationWarrant',false/i);
});

test("physical-load capacity is an independent claim dimension", () => {
  assert.match(composition, /worker_weekly_labor_claims_v2/i);
  assert.match(composition, /requiredHeavyClaimMinutes/i);
  assert.match(composition, /remainingOptionalHeavyAvailabilityMinutes/i);
  assert.match(composition, /plannedHeavyMinutesSoftCap/i);
  assert.match(composition, /physicalLoadCapacityIsClaimedSeparatelyFromTotalMinutes/i);
  assert.match(composition, /optionalHeavyWorkCannotConsumeHeavyCapacityReservedForRequiredWork/i);
  assert.match(composition, /physicalLoadCapacityIsIndependentlyGuarded/i);
});

test("Weekly Farm Contract v6 exposes claim custody while estimates remain non-actual", () => {
  assert.match(composition, /worker_weekly_farm_contract_v6/i);
  assert.match(composition, /laborClaims/i);
  assert.match(composition, /fixedCommitmentsAndHumanTimeReduceCapacityAtSource/i);
  assert.match(composition, /protectedMinimumsClaimBeforeOptionalWork/i);
  assert.match(composition, /requiredWorkClaimsBeforeOptionalWork/i);
  assert.match(composition, /optionalWorkClaimsOnlyWhenPlaced/i);
  assert.match(composition, /estimatesAreCapacityClaimsNotLaborActuals/i);
  assert.match(composition, /return atlas\.worker_weekly_farm_contract_v6/i);
});

test("capacity conflict v2 does not double-count placed required work or create Principal warrant", () => {
  assert.match(composition, /worker_weekly_capacity_conflict_v2/i);
  assert.match(composition, /management_conflict/i);
  assert.match(composition, /recovery_required/i);
  assert.match(composition, /placedRequiredWorkIsNotDoubleCountedAgainstRemainingCapacity/i);
  assert.match(composition, /optionalClaimsAreDisplaceableBeforeDeclaringRequiredWorkImpossible/i);
  assert.match(composition, /managementConflictDoesNotCreatePrincipalWorkByItself/i);
  assert.match(composition, /'principalEscalationWarrant',false/i);
});

test("over-capacity is routed to a Farm Operations management occurrence first", () => {
  assert.match(management, /worker_weekly_capacity_management_state_v1/i);
  assert.match(management, /ensure_worker_weekly_capacity_management_v1/i);
  assert.match(management, /source_kind='worker_weekly_capacity_management'/i);
  assert.match(management, /atlas\.planned_work_occurrences/i);
  assert.match(management, /'worker_weekly_capacity_management'/i);
  assert.match(management, /'management'\s*\)/i);
  assert.match(management, /'ownership_consequence_unresolved',false/i);
  assert.match(management, /Farm Operations owns this labor-capacity exception first/i);
  assert.doesNotMatch(management, /record_operational_escalation_v1/i);
});

test("only an explicit management ownership consequence grants Principal warrant", () => {
  assert.match(principalGate, /mark_worker_weekly_capacity_owner_decision_v1/i);
  assert.match(principalGate, /management_mark_worker_weekly_capacity_owner_decision_api_v1/i);
  assert.match(principalGate, /role in \('owner','manager'\)/i);
  assert.match(principalGate, /ownership_consequence_unresolved',true/i);
  assert.match(principalGate, /principalEscalationWarrant',true/i);
  assert.match(principalGate, /sync_worker_weekly_capacity_escalation_v2/i);
  assert.match(principalGate, /v_conflict->>'state'<>'management_conflict' or not coalesce\(\(v_management->>'ownershipConsequenceUnresolved'\)::boolean,false\)/i);
  assert.match(principalGate, /'action','contained_in_farm_operations'/i);
  assert.match(principalGate, /record_operational_escalation_v1/i);
  assert.match(principalGate, /managementBoundarySatisfied/i);
});

test("legacy weekly escalation callers are forced through the new management gate", () => {
  assert.match(principalGate, /create or replace function atlas\.sync_worker_weekly_capacity_escalation_v1/i);
  assert.match(principalGate, /select atlas\.sync_worker_weekly_capacity_escalation_v2/i);
  assert.match(principalGate, /return atlas\.worker_weekly_capacity_conflict_v2/i);
  assert.match(principalGate, /principal_farm_capacity_escalation_tick_v2/i);
});

test("the only new authenticated Phase 11 mutation endpoint is registry-governed", () => {
  assert.match(registry, /atlas\.management_mark_worker_weekly_capacity_owner_decision_api_v1\(uuid, uuid, date, text, text, text\)/i);
  assert.match(registry, /'owner_admin_endpoint','verified','active',true,true,true/i);
  assert.match(registry, /only new Phase 11 action that grants a Principal escalation warrant/i);
  assert.match(registry, /worker_weekly_farm_contract_v6/i);
  assert.match(registry, /worker_weekly_capacity_conflict_v2/i);
});
