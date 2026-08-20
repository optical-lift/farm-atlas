import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routingMigration = readFileSync(
  new URL("../supabase/migrations/20260820182136_worker_selected_day_routing_bridge_v1.sql", import.meta.url),
  "utf8",
);

const openingRoutineMigration = readFileSync(
  new URL("../supabase/migrations/20260820182457_chicken_chore_opening_routine_clock_semantics_v1.sql", import.meta.url),
  "utf8",
);

const routing = routingMigration.replace(/\s+/g, " ").trim();
const openingRoutine = openingRoutineMigration.replace(/\s+/g, " ").trim();

test("selected ordinary Worker Day work can bridge a missing persisted placement without inventing Clock time", () => {
  assert.match(routingMigration, /create or replace function atlas\.worker_state_transition_selection_bridge_v1/);
  assert.match(routing, /transition,state.*not_routed/);
  assert.match(routing, /routing,state.*not_placed_for_worker_day/);
  assert.match(routing, /currentReality,subjectCount.*<> 0/);
  assert.match(routingMigration, /atlas\.presented_work_selection_rows_v1/);
  assert.match(routingMigration, /selection\.presentation_state='presented'/);
  assert.match(routingMigration, /coalesce\(selection\.overload,false\)=false/);
  assert.match(routingMigration, /atlas\.task_execution_readiness_v1\(p_task_id\)/);
  assert.match(routingMigration, /definiteCapacityConflict/);
  assert.match(routingMigration, /'exactTimeClaim',false/);
  assert.match(routingMigration, /'plannedStartAt',null/);
  assert.match(routingMigration, /'doesNotCreateClockPlacement',true/);
  assert.match(routingMigration, /'doesNotBypassCropOrProductionReality',true/);
});

test("the canonical transition card actually invokes the selected-day bridge", () => {
  assert.match(routingMigration, /v_card:=atlas\.worker_state_transition_card_pre_or4_v2/);
  assert.match(routingMigration, /v_card:=atlas\.worker_state_transition_selection_bridge_v1/);
  assert.match(routingMigration, /authorized_for_routed_day/);
});

test("selected-day routing cannot bypass real readiness, subject, overload, or capacity gates", () => {
  assert.match(routingMigration, /subjectCount/);
  assert.match(routingMigration, /v_selected boolean := false/);
  assert.match(routingMigration, /if not v_selected then\s+return v_card;/s);
  assert.match(routingMigration, /if not coalesce\(\(v_readiness->>'ready'\)::boolean,false\)/);
  assert.match(routingMigration, /or coalesce\(\(v_card#>>'\{clock,definiteCapacityConflict\}'\)::boolean,false\)/);
  assert.doesNotMatch(routingMigration, /insert into atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(routingMigration, /update atlas\.worker_day_task_placements/i);
});

test("Chicken Chore data repair expresses opening-routine truth through generic Clock semantics", () => {
  const openingFlags = openingRoutineMigration.match(/'opening_routine',true/g) ?? [];
  const topAnchors = openingRoutineMigration.match(/'work_order_anchor','top'/g) ?? [];

  assert.ok(openingFlags.length >= 3, "definition, planned occurrence payload, and current task must carry opening-routine truth");
  assert.ok(topAnchors.length >= 3, "definition, planned occurrence payload, and current task must carry top-of-day anchoring");
  assert.match(openingRoutineMigration, /update atlas\.work_definitions/);
  assert.match(openingRoutineMigration, /update atlas\.planned_work_occurrences/);
  assert.match(openingRoutineMigration, /update atlas\.tasks/);
  assert.match(openingRoutineMigration, /clockOpeningRoutine/);
  assert.match(openingRoutineMigration, /owner_clock_choreography_20260820/);
  assert.doesNotMatch(openingRoutineMigration, /planned_start_at/i);
  assert.doesNotMatch(openingRoutineMigration, /Chicken Chore/i);
});

test("one-time Chicken Chore repair is identity-targeted data provenance, not a runtime title rule", () => {
  assert.match(openingRoutine, /work_definitions.*3199c7cc-d4d4-4838-9de2-a200a92a4615/);
  assert.match(openingRoutine, /tasks.*b8ce42aa-387f-4f8c-8ce9-cc5384efbdae/);
  assert.doesNotMatch(openingRoutineMigration, /where\s+title\s*=/i);
  assert.doesNotMatch(routingMigration, /Chicken Chore/i);
});
