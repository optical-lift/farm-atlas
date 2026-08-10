import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canonicalDetail = readFileSync(
  new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);
const conveyorDetail = readFileSync(
  new URL("../components/atlas/farm-hand-conveyor-task-detail.tsx", import.meta.url),
  "utf8",
);
const dominionDetail = readFileSync(
  new URL("../components/atlas/dominion-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);

test("Anna generic assigned tasks use the canonical regular result grammar", () => {
  assert.doesNotMatch(canonicalDetail, /StructuredUnfinishedControl/);
  assert.doesNotMatch(canonicalDetail, /assignee\.key === "anna"/);
  assert.doesNotMatch(canonicalDetail, /FarmHandConveyorTaskDetail/);
  assert.match(canonicalDetail, /return <DominionAssignedTaskDetail/);
  assert.match(canonicalDetail, /TransplantReadinessTaskDetail/);
  assert.match(dominionDetail, /"Partly done"/);
  assert.match(dominionDetail, /"Problem found"/);
});

test("the old conveyor remains available without owning Anna's ordinary task footer", () => {
  assert.match(conveyorDetail, /"Done"/);
  assert.match(conveyorDetail, /Made progress/);
  assert.match(conveyorDetail, /Need something/);
  assert.match(conveyorDetail, /Farm changed/);
  assert.match(conveyorDetail, /Need lighter work/);

  assert.match(dominionDetail, /"Done"/);
  assert.match(dominionDetail, /Unfinished/);
  assert.match(dominionDetail, />Tomorrow</);
  assert.match(dominionDetail, />Next week</);
  assert.match(dominionDetail, />Pick a date</);
  assert.match(dominionDetail, /transition: "rescheduled"/);
});
