import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attachCanonicalCapacityRequirements } from "../lib/atlas/task-move-capacity-enrichment.js";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

function baseAssembly() {
  return {
    version: 2,
    task: {
      id: "458ab3a9-6cae-457d-8bf2-ae718a9c3a5e",
      title: "Pot up · Snow in Summer",
      taskType: "pot_up",
      status: "open",
      priority: "high",
      dueDate: "2026-08-10",
      route: "propagation",
      workClass: null,
      updatedAt: null,
    },
    spine: {
      current: [{
        label: "720 Snow in Summer starts",
        status: "resolved",
        provenance: "task_record",
      }],
      move: {
        action: { label: "Pot up", status: "resolved", provenance: "task_record" },
        subject: { label: "Snow in Summer", status: "resolved", provenance: "task_record" },
        workSite: { label: "Grow Room", status: "resolved", provenance: "task_record" },
      },
      after: [{
        label: "720 starts potted and placed for continued growth",
        status: "resolved",
        provenance: "task_record",
      }],
      connection: "continuous",
    },
    requirements: [
      {
        id: "tray-200",
        kind: "container",
        label: "200-Cell Pot-Up Tray",
        required: true,
        quantity: 3,
        unit: "trays",
        provenance: "resource_requirement",
        status: "warning",
      },
      {
        id: "tray-120",
        kind: "container",
        label: "120-Cell Pot-Up Tray",
        required: true,
        quantity: 1,
        unit: "tray",
        provenance: "resource_requirement",
        status: "warning",
      },
      {
        id: "potting-mix",
        kind: "medium",
        label: "Potting Mix",
        required: true,
        quantity: null,
        unit: null,
        provenance: "resource_requirement",
        status: "warning",
      },
    ],
    linkedObjects: [],
    execution: {
      what: "Pot up · Snow in Summer",
      where: "Grow Room",
      how: [],
      doneWhen: "All 720 starts are potted up and placed.",
      details: null,
      dueLabel: "Today",
    },
    checklist: [],
    context: { projects: [], unlocks: [], whyNow: null, stateEffect: null },
    unresolved: [
      { kind: "container", label: "200-Cell Pot-Up Tray", provenance: "resource_requirement", status: "warning" },
      { kind: "container", label: "120-Cell Pot-Up Tray", provenance: "resource_requirement", status: "warning" },
      { kind: "medium", label: "Potting Mix", provenance: "resource_requirement", status: "warning" },
    ],
    readiness: { status: "warning", executable: true, unresolvedCount: 3 },
  };
}

function unconfirmedLitCapacity() {
  return [{
    requirement_id: "snow-lit-space",
    capacity_role: "destination",
    quantity_needed: 4,
    unit: "shelf_positions",
    window_start: "2026-08-10",
    window_end: null,
    requirement_status: "required",
    source: "task_move_capacity_pass_3",
    note: "Four pot-up trays need lit Grow Room shelf positions after pot-up.",
    pool_id: "lit-pool",
    pool_key: "grow_room_lit_shelf_positions",
    pool_label: "Grow Room Lit Shelf Positions",
    capacity_kind: "lit_shelf_positions",
    total_capacity: null,
    pool_unit: "shelf_positions",
    capacity_status: "unconfirmed",
    pool_source: "spring_2027_capacity_pilot",
    questions: [
      {
        question_id: "light-count",
        question_key: "functional_grow_light_sets",
        question_kind: "inventory_count",
        question_text: "How many grow-light sets are physically present and functional?",
        status: "open",
        blocker_role: "availability_input",
      },
      {
        question_id: "coverage",
        question_key: "shelf_positions_per_grow_light_set",
        question_kind: "conversion",
        question_text: "How many rack shelf positions does one grow-light set fully cover?",
        status: "open",
        blocker_role: "calculation_input",
      },
    ],
  }];
}

test("unconfirmed destination capacity stays visible for Snow in Summer without inventing a stop at MOVE", () => {
  const result = attachCanonicalCapacityRequirements(baseAssembly(), unconfirmedLitCapacity());
  const capacity = result.requirements.find((item) => item.provenance === "capacity_pool");

  assert.equal(capacity.kind, "capacity");
  assert.equal(capacity.label, "Grow Room Lit Shelf Positions");
  assert.equal(capacity.quantity, 4);
  assert.equal(capacity.unit, "shelf_positions");
  assert.equal(capacity.capacityRole, "destination");
  assert.equal(capacity.status, "warning");
  assert.equal(capacity.questions.length, 2);
  assert.equal(capacity.questions[0].key, "functional_grow_light_sets");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
  assert.equal(result.spine.after[0].label, "720 starts potted and placed for continued growth");
  assert.equal(result.spine.after[0].status, "resolved");
});

test("confirmed pool total is not silently treated as currently available capacity", () => {
  const rows = unconfirmedLitCapacity();
  rows[0].capacity_status = "confirmed";
  rows[0].total_capacity = 20;
  rows[0].questions = [];

  const result = attachCanonicalCapacityRequirements(baseAssembly(), rows);
  const capacity = result.requirements.find((item) => item.provenance === "capacity_pool");

  assert.equal(capacity.status, "warning");
  assert.equal(capacity.totalCapacity, 20);
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
});

test("confirmed pool smaller than the required move remains blocked", () => {
  const rows = unconfirmedLitCapacity();
  rows[0].capacity_status = "confirmed";
  rows[0].total_capacity = 2;
  rows[0].questions = [];

  const result = attachCanonicalCapacityRequirements(baseAssembly(), rows);
  const capacity = result.requirements.find((item) => item.provenance === "capacity_pool");

  assert.equal(capacity.status, "blocked");
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.spine.connection, "stops_at_move");
});

test("optional unconfirmed capacity stays a warning rather than blocking the move", () => {
  const rows = unconfirmedLitCapacity();
  rows[0].requirement_status = "optional";

  const result = attachCanonicalCapacityRequirements(baseAssembly(), rows);
  const capacity = result.requirements.find((item) => item.provenance === "capacity_pool");

  assert.equal(capacity.required, false);
  assert.equal(capacity.status, "warning");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
});

test("Pass 3 creates a generic task-capacity seam instead of reusing labor or production-lot capacity", () => {
  const migration = read("supabase/migrations/20260810190000_task_move_capacity_requirements_v1.sql");

  assert.match(migration, /create table if not exists atlas\.task_capacity_requirements/i);
  assert.match(migration, /capacity_pool_id uuid not null references atlas\.capacity_pools/i);
  assert.match(migration, /capacity_role text not null default 'destination'/i);
  assert.match(migration, /create table if not exists atlas\.task_capacity_requirement_questions/i);
  assert.match(migration, /grow_room_lit_shelf_positions/);
  assert.match(migration, /quantity_needed,[\s\S]*4,[\s\S]*'shelf_positions'/);
  assert.match(migration, /functional_grow_light_sets/);
  assert.match(migration, /shelf_positions_per_grow_light_set/);
  assert.doesNotMatch(migration, /insert into atlas\.task_capacity_profiles/i);
  assert.doesNotMatch(migration, /insert into atlas\.production_capacity_requirements/i);
});

test("capacity RPC is viewer-scoped and registered as an authenticated composition helper", () => {
  const migration = read("supabase/migrations/20260810190000_task_move_capacity_requirements_v1.sql");

  assert.match(migration, /function atlas\.task_capacity_requirements_api_v1\(p_task_id uuid\)/i);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /atlas\.task_cards_v1\(v_farm_id, p_task_id\)/);
  assert.match(migration, /Task is not visible to the current Atlas viewer/);
  assert.match(migration, /'atlas\.task_capacity_requirements_api_v1\(uuid\)'/);
  assert.match(migration, /'policy_or_composition_helper'/);
  assert.match(migration, /'visibility_boundary', 'atlas\.task_cards_v1'/);
});

test("server resolver reads canonical capacity through authenticated Supabase and enriches the shared assembly", () => {
  const source = read("lib/atlas/task-move-resolver.ts");
  const types = read("lib/atlas/task-move-assembly.ts");

  assert.match(source, /task_capacity_requirements_api_v1/);
  assert.match(source, /readCanonicalTaskCapacity/);
  assert.match(source, /attachCanonicalCapacityRequirements/);
  assert.match(source, /Promise\.all/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(types, /\| "capacity_pool"/);
  assert.match(types, /questions\?: TaskMoveCapacityQuestion\[\]/);
});
