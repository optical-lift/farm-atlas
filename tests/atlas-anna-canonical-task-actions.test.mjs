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

test("Anna gets conveyor support without replacing canonical task truth", () => {
  assert.doesNotMatch(canonicalDetail, /StructuredUnfinishedControl/);
  assert.match(canonicalDetail, /assignee\.key === "anna"/);
  assert.match(canonicalDetail, /FarmHandConveyorTaskDetail/);
  assert.match(conveyorDetail, /Need lighter work/);
  assert.match(conveyorDetail, /reportAtlasNeedLighterWork/);
  assert.match(conveyorDetail, /DominionAssignedTaskDetail/);
  assert.match(dominionDetail, /"Partly done"/);
  assert.match(dominionDetail, /"Problem found"/);
});

test("Anna reports reality while retaining the reschedule controls she asked to keep", () => {
  assert.match(conveyorDetail, /"Done"/);
  assert.match(conveyorDetail, /Made progress/);
  assert.match(conveyorDetail, /Need something/);
  assert.match(conveyorDetail, /Farm changed/);
  assert.match(conveyorDetail, /Need lighter work/);
  assert.match(conveyorDetail, /atlas-task-result-footer\{display:none!important\}/);
  assert.match(conveyorDetail, />Tomorrow</);
  assert.match(conveyorDetail, />Next week</);
  assert.match(conveyorDetail, />Pick a date</);
  assert.match(conveyorDetail, /transition: "rescheduled"/);
});
