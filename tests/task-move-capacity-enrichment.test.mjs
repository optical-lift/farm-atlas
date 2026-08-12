import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { attachCanonicalCapacityRequirements } from "../lib/atlas/task-move-capacity-enrichment.js";

function baseAssembly() {
  return {
    requirements: [],
    unresolved: [],
    readiness: { status: "ready", executable: true, unresolvedCount: 0 },
    spine: { connection: "continuous" },
  };
}

function capacityRow(overrides = {}) {
  return {
    requirement_id: "capacity-1",
    pool_key: "grow_room_lit_tray_positions",
    pool_label: "Grow Room Lit Tray Positions",
    requirement_status: "required",
    capacity_status: "unconfirmed",
    capacity_role: "destination",
    quantity_needed: 4,
    unit: "tray_positions",
    pool_unit: "tray_positions",
    total_capacity: null,
    note: "4 physical pot-up trays require 4 lit positions.",
    questions: [],
    ...overrides,
  };
}

test("required but unconfirmed destination capacity stays a warning, not a fabricated blocker", () => {
  const result = attachCanonicalCapacityRequirements(baseAssembly(), [capacityRow()]);
  const capacity = result.requirements.find((requirement) => requirement.kind === "capacity");

  assert.equal(capacity.status, "warning");
  assert.equal(capacity.capacityStatus, "unconfirmed");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
});

test("a confirmed comparable shortfall is a real blocker", () => {
  const result = attachCanonicalCapacityRequirements(baseAssembly(), [capacityRow({
    capacity_status: "confirmed",
    total_capacity: 2,
  })]);
  const capacity = result.requirements.find((requirement) => requirement.kind === "capacity");

  assert.equal(capacity.status, "blocked");
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.readiness.executable, false);
  assert.equal(result.spine.connection, "stops_at_move");
});

test("unlike capacity units remain a blocker because the incompatibility is known", () => {
  const result = attachCanonicalCapacityRequirements(baseAssembly(), [capacityRow({
    capacity_status: "confirmed",
    total_capacity: 12,
    pool_unit: "shelf_feet",
  })]);
  const capacity = result.requirements.find((requirement) => requirement.kind === "capacity");

  assert.equal(capacity.unitCompatible, false);
  assert.equal(capacity.status, "blocked");
  assert.equal(result.readiness.executable, false);
});

test("confirmed total capacity still stays visible until Atlas knows actual availability", () => {
  const result = attachCanonicalCapacityRequirements(baseAssembly(), [capacityRow({
    capacity_status: "confirmed",
    total_capacity: 8,
  })]);
  const capacity = result.requirements.find((requirement) => requirement.kind === "capacity");

  assert.equal(capacity.status, "warning");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
});

test("Task Move renders unconfirmed capacity as a visual warning without exposing explanation prose", () => {
  const spine = readFileSync(new URL("../components/atlas/task-move-spine.tsx", import.meta.url), "utf8");
  assert.match(spine, /if \(status === "warning"\) return "○"/);
  assert.match(spine, /lit tray spots/);
  assert.doesNotMatch(spine, /Not yet confirmed/);
  assert.doesNotMatch(spine, /requirement\.note/);
});
