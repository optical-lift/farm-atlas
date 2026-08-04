import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canonicalDetail = readFileSync(
  new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);
const dominionDetail = readFileSync(
  new URL("../components/atlas/dominion-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);

test("Anna uses the same canonical unfinished and move controls as ordinary assigned tasks", () => {
  assert.doesNotMatch(canonicalDetail, /StructuredUnfinishedControl/);
  assert.doesNotMatch(canonicalDetail, /assignee\.key === "anna"/);
  assert.match(canonicalDetail, /return <DominionAssignedTaskDetail \{\.\.\.props\} \/>/);

  assert.match(dominionDetail, />Partly done</);
  assert.match(dominionDetail, />Problem found</);
  assert.match(dominionDetail, /Move or close this card/);
  assert.match(dominionDetail, />Tomorrow</);
  assert.match(dominionDetail, />Next week</);
  assert.match(dominionDetail, />Pick a date</);
  assert.match(dominionDetail, />Changed plan</);
  assert.match(dominionDetail, />Not relevant</);
});
