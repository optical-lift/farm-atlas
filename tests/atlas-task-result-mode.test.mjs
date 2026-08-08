import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const resultMode = readFileSync(
  new URL("../lib/atlas/task-result-mode.ts", import.meta.url),
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
const dominionDetail = readFileSync(
  new URL("../components/atlas/dominion-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);

test("ordinary task result grammar is selected by task shape instead of assignee", () => {
  assert.match(resultMode, /"standard_execution" \| "field_execution"/);
  assert.match(resultMode, /metadataText\(task, "task_result_mode"\)/);
  assert.match(resultMode, /metadataText\(task, "operation_class"\)/);
  assert.match(resultMode, /\? "field_execution"\s*:\s*"standard_execution"/);

  assert.match(canonicalDetail, /atlasTaskResultMode\(props\.task\)/);
  assert.match(canonicalDetail, /props\.assignee\.key === "anna" && resultMode === "field_execution"/);
  assert.match(canonicalDetail, /return <DominionAssignedTaskDetail/);
});

test("specialized task families resolve before ordinary result mode", () => {
  const resolverIndex = canonicalDetail.indexOf("const resultMode = atlasTaskResultMode(props.task)");
  for (const specialized of [
    "ContractorServiceTaskDetail",
    "DecisionSelectorTaskDetail",
    "WeedCardTaskLoader",
    "SeedInventoryTaskLoader",
    "NetworkInputsTaskDetail",
    "ExecutionChecklistTaskDetail",
    "ProjectPullTaskDetail",
  ]) {
    const routeIndex = canonicalDetail.lastIndexOf(`return <${specialized}`, resolverIndex);
    assert.ok(routeIndex >= 0 && routeIndex < resolverIndex, `${specialized} should route before ordinary result mode`);
  }
});

test("standard execution reuses the existing canonical result grammar", () => {
  assert.match(dominionDetail, />\s*\{saving === "done" \? "Finishing" : "Done"\}\s*</);
  assert.match(dominionDetail, /Unfinished/);
  assert.match(dominionDetail, /"Partly done"/);
  assert.match(dominionDetail, /"Problem found"/);
  assert.match(dominionDetail, />Tomorrow</);
  assert.match(dominionDetail, />Next week</);
  assert.match(dominionDetail, />Pick a date</);
  assert.match(dominionDetail, />Changed plan</);
  assert.match(dominionDetail, />Not relevant</);

  assert.doesNotMatch(conveyorDetail, /Some calls made|Follow-up needed|Couldn't call/);
  assert.match(conveyorDetail, /Made progress/);
  assert.match(conveyorDetail, /Need something/);
  assert.match(conveyorDetail, /Farm changed/);
  assert.match(conveyorDetail, /Need lighter work/);
});
