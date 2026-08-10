import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const resultMode = readFileSync(
  new URL("../lib/atlas/task-result-mode.ts", import.meta.url),
  "utf8",
);
const taskCardsClient = readFileSync(
  new URL("../lib/atlas/task-cards-client.ts", import.meta.url),
  "utf8",
);
const taskCardMigration = readFileSync(
  new URL("../supabase/migrations/20260808162000_expose_task_operation_class_on_task_cards.sql", import.meta.url),
  "utf8",
);
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
const primaryResults = readFileSync(
  new URL("../components/atlas/task-primary-result-controls.tsx", import.meta.url),
  "utf8",
);

test("operation class remains available without replacing the canonical result grammar", () => {
  assert.match(resultMode, /"standard_execution" \| "field_execution"/);
  assert.match(resultMode, /metadataText\(task, "task_result_mode"\)/);
  assert.match(resultMode, /task\.operation_class \|\| metadataText\(task, "operation_class"\)/);
  assert.match(resultMode, /operationClass \? "field_execution" : "standard_execution"/);

  assert.match(taskCardsClient, /operation_class\?: string \| null/);
  assert.match(taskCardsClient, /operation_class_source\?: string \| null/);
  assert.match(taskCardMigration, /t\.operation_class,/);
  assert.match(taskCardMigration, /t\.operation_class_source/);

  assert.doesNotMatch(canonicalDetail, /atlasTaskResultMode\(props\.task\)/);
  assert.doesNotMatch(canonicalDetail, /props\.assignee\.key === "anna" && resultMode === "field_execution"/);
  assert.match(canonicalDetail, /return <AssignedTaskExecutionShell/);
});

test("specialized task families resolve before ordinary canonical result fallback", () => {
  const fallbackIndex = canonicalDetail.indexOf("return <AssignedTaskExecutionShell");
  assert.ok(fallbackIndex >= 0, "ordinary task fallback should use AssignedTaskExecutionShell");
  for (const specialized of [
    "ContractorServiceTaskDetail",
    "DecisionSelectorTaskDetail",
    "WeedCardTaskLoader",
    "SeedInventoryTaskLoader",
    "BuyerOutreachTaskDetail",
    "NetworkOutreachTaskDetail",
    "NetworkInputsTaskDetail",
    "ExecutionChecklistTaskDetail",
    "ProjectPullTaskDetail",
    "TransplantReadinessTaskDetail",
  ]) {
    const routeIndex = canonicalDetail.lastIndexOf(`return <${specialized}`, fallbackIndex);
    assert.ok(routeIndex >= 0 && routeIndex < fallbackIndex, `${specialized} should route before ordinary result fallback until Pass 6 migrates it`);
  }
});

test("ordinary execution uses the existing canonical result grammar", () => {
  assert.match(primaryResults, /doneLabel = "Done"/);
  assert.match(primaryResults, /doneBusyLabel = "Finishing"/);
  assert.match(primaryResults, />\s*Unfinished\s*</);
  assert.match(executionShell, /"Partly done"/);
  assert.match(executionShell, /"Problem found"/);
  assert.match(executionShell, />Tomorrow</);
  assert.match(executionShell, />Next week</);
  assert.match(executionShell, />Pick a date</);
  assert.match(executionShell, />Changed plan</);
  assert.match(executionShell, />Not relevant</);

  // The adaptive conveyor remains available as a component, but it is no longer
  // the default result grammar for Anna's ordinary field_execution tasks.
  assert.match(conveyorDetail, /Made progress/);
  assert.match(conveyorDetail, /Need something/);
  assert.match(conveyorDetail, /Farm changed/);
  assert.match(conveyorDetail, /Need lighter work/);
});
