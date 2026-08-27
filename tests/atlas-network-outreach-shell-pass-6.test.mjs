import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/network-outreach-task-detail.tsx", import.meta.url),
  "utf8",
);

test("network outreach executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-method-instrument="network-outreach"/);
  assert.match(source, /data-atlas-result-instrument="network-outreach"/);
  assert.doesNotMatch(source, /TaskDominionTrail/);
  assert.doesNotMatch(source, /import Link from "next\/link"/);
  assert.doesNotMatch(source, /\/api\/atlas\/weather/);
  assert.doesNotMatch(source, /<main className="atlas-phone-shell/);
});

test("network outreach keeps its specialized contact workflow without duplicating the generic child checklist", () => {
  assert.match(source, /childTasks=\{\[\]\}/);
  assert.match(source, /\/api\/atlas\/network-outreach/);
  assert.match(source, /network-outreach-v1/);
  assert.match(source, /action: "save_result"/);
  assert.match(source, /note_kind: "network_outreach_result"/);
  assert.match(source, /completion_source: "network_outreach_checklist"/);
  assert.match(source, /action: "release_next_batch"/);
  assert.match(source, /completion_source: "network_outreach_batch"/);
});

test("network outreach completion requires every contact and canonical completion capability", () => {
  assert.match(source, /if \(!allContactsDone\)/);
  assert.match(source, /!allContactsDone/);
  assert.match(source, /!completion\.canComplete/);
  assert.match(source, /!context\.completion\.canComplete/);
  assert.match(source, /disabled=\{moveBlocked\}/);
  assert.match(source, /window\.location\.assign\(returnHref\)/);
});
