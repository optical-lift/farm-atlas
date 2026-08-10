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
const executionShell = readFileSync(
  new URL("../components/atlas/assigned-task-execution-shell.tsx", import.meta.url),
  "utf8",
);
const dominionDetail = readFileSync(
  new URL("../components/atlas/dominion-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);
const primaryResults = readFileSync(
  new URL("../components/atlas/task-primary-result-controls.tsx", import.meta.url),
  "utf8",
);

test("Anna generic assigned tasks use the canonical regular result grammar", () => {
  assert.doesNotMatch(canonicalDetail, /StructuredUnfinishedControl/);
  assert.doesNotMatch(canonicalDetail, /assignee\.key === "anna"/);
  assert.doesNotMatch(canonicalDetail, /FarmHandConveyorTaskDetail/);
  assert.match(canonicalDetail, /return <AssignedTaskExecutionShell/);
  assert.match(canonicalDetail, /TransplantReadinessTaskDetail/);
  assert.match(executionShell, /"Partly done"/);
  assert.match(executionShell, /"Problem found"/);
});

test("the old conveyor remains available without owning Anna's ordinary task footer", () => {
  assert.match(conveyorDetail, /"Done"/);
  assert.match(conveyorDetail, /Made progress/);
  assert.match(conveyorDetail, /Need something/);
  assert.match(conveyorDetail, /Farm changed/);
  assert.match(conveyorDetail, /Need lighter work/);

  assert.match(primaryResults, /doneLabel = "Done"/);
  assert.match(primaryResults, />\s*Unfinished\s*</);
  assert.match(executionShell, /TaskPrimaryResultControls/);
  assert.match(executionShell, />Tomorrow</);
  assert.match(executionShell, />Next week</);
  assert.match(executionShell, />Pick a date</);
  assert.match(executionShell, /transition: "rescheduled"/);

  // Dominion no longer owns execution behavior; it only preserves old imports
  // until specialized task families migrate through the shell in Pass 6.
  assert.match(dominionDetail, /AssignedTaskExecutionShell/);
  assert.doesNotMatch(dominionDetail, /TaskPrimaryResultControls/);
});
