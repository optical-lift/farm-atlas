import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attachCanonicalCapacityRequirements } from "../lib/atlas/task-move-capacity-enrichment.js";
import { attachCanonicalMoveRoles } from "../lib/atlas/task-move-role-enrichment.js";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

function baseAssembly() {
  return {
    version: 2,
    task: { id: "task", title: "Task", status: "open" },
    spine: {
      current: [{ label: "Current", status: "resolved", provenance: "task_record" }],
      move: {
        action: { label: "Move", status: "resolved", provenance: "derived" },
        subject: { label: "Subject", status: "resolved", provenance: "derived" },
        workSite: { label: "Grow Room", status: "resolved", provenance: "derived" },
      },
      after: [{ label: "After", status: "resolved", provenance: "task_record" }],
      connection: "continuous",
    },
    requirements: [],
    linkedObjects: [],
    unresolved: [],
    readiness: { status: "ready", executable: true, unresolvedCount: 0 },
  };
}

test("Pass 3 correction models Snow in Summer as tray-position capacity without converting shelves", () => {
  const migration = read("supabase/migrations/20260810191500_task_move_capacity_unit_truth_and_object_roles_v1.sql");

  assert.match(migration, /grow_room_lit_tray_positions/);
  assert.match(migration, /'lit_tray_positions'/);
  assert.match(migration, /'tray_positions'/);
  assert.match(migration, /quantity_needed,[\s\S]*4,[\s\S]*'tray_positions'/);
  assert.match(migration, /shelf-position conversion is intentionally not assumed/i);
  assert.match(migration, /delete from atlas\.task_capacity_requirements[\s\S]*grow_room_lit_shelf_positions/i);
  assert.match(migration, /'role', tro\.role/);
});

test("capacity enrichment blocks unlike physical units instead of inventing a conversion", () => {
  const rows = [{
    requirement_id: "capacity",
    capacity_role: "destination",
    quantity_needed: 4,
    unit: "tray_positions",
    requirement_status: "required",
    pool_key: "grow_room_lit_shelf_positions",
    pool_label: "Grow Room Lit Shelf Positions",
    total_capacity: 20,
    pool_unit: "shelf_positions",
    capacity_status: "confirmed",
    questions: [],
  }];

  const result = attachCanonicalCapacityRequirements(baseAssembly(), rows);
  const capacity = result.requirements[0];

  assert.equal(capacity.unitCompatible, false);
  assert.equal(capacity.status, "blocked");
  assert.equal(result.readiness.executable, false);
  assert.equal(result.spine.connection, "stops_at_move");
});

test("matching tray-position units stay visible but executable until the pool itself is confirmed", () => {
  const rows = [{
    requirement_id: "capacity",
    capacity_role: "destination",
    quantity_needed: 4,
    unit: "tray_positions",
    requirement_status: "required",
    pool_key: "grow_room_lit_tray_positions",
    pool_label: "Grow Room Lit Tray Positions",
    total_capacity: null,
    pool_unit: "tray_positions",
    capacity_status: "unconfirmed",
    questions: [{
      question_id: "question",
      question_key: "grow_room_lit_tray_positions_available",
      question_kind: "inventory_count",
      question_text: "How many tray positions are usable?",
      status: "open",
      blocker_role: "availability_input",
    }],
  }];

  const result = attachCanonicalCapacityRequirements(baseAssembly(), rows);
  const capacity = result.requirements[0];

  assert.equal(capacity.unitCompatible, true);
  assert.equal(capacity.status, "warning");
  assert.equal(capacity.questions[0].key, "grow_room_lit_tray_positions_available");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
  assert.equal(result.spine.after[0].label, "After");
});

test("canonical resource move_role beats heuristic requirement classification", () => {
  const assembly = baseAssembly();
  assembly.requirements = [{
    id: "mix",
    kind: "resource",
    label: "Potting Mix",
    required: true,
    quantity: null,
    unit: null,
    provenance: "resource_requirement",
    status: "warning",
  }];
  assembly.unresolved = [{
    kind: "resource",
    label: "Potting Mix",
    provenance: "resource_requirement",
    status: "warning",
  }];

  const result = attachCanonicalMoveRoles(assembly, {
    resource_requirements: [{ requirement_id: "mix", move_role: "growing_medium" }],
    objects: [],
  });

  assert.equal(result.requirements[0].kind, "medium");
  assert.equal(result.unresolved[0].kind, "medium");
});

test("canonical task_object destination roles become resolved MOVE branches", () => {
  const assembly = baseAssembly();
  assembly.linkedObjects = [{
    id: "mg10",
    key: "mg10",
    label: "MG10",
    objectType: "bed",
    objectMode: "row_bed",
    lifeStatus: "active",
    provenance: "task_object",
  }];

  const result = attachCanonicalMoveRoles(assembly, {
    resource_requirements: [],
    objects: [{
      object_id: "mg10",
      role: "destination",
      object_label: "MG10",
    }],
  });

  const destination = result.requirements.find((item) => item.kind === "destination");
  assert.equal(destination.label, "MG10");
  assert.equal(destination.provenance, "task_object");
  assert.equal(destination.status, "resolved");
  assert.equal(result.linkedObjects[0].role, "destination");
});
