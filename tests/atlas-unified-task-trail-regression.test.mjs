import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const stateful = read("components/atlas/stateful-child-checklist.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("worker task sections share one continuous rail grammar", () => {
  assert.match(spine, /atlas-worker-move__requirements::before/);
  assert.match(spine, /atlas-worker-move__flow::before/);
  assert.match(brief, /atlas-worker-method::before/);
  assert.match(brief, /atlas-worker-facts::before/);
  assert.match(stateful, /atlas-stateful-children::before/);
  assert.match(shell, /atlas-task-result-footer::before/);
  assert.match(shell, /atlas-task-finish-node/);
});

test("stateful child steps are checkpoint controls instead of visible Mark complete links", () => {
  assert.match(stateful, /atlas-stateful-children__checkpoint/);
  assert.match(stateful, /data-state=\{done \? "done" : "open"\}/);
  assert.match(stateful, /aria-label=\{accessibleAction\}/);
  assert.match(stateful, /toggle\(task, done \? "open" : "done"\)/);
  assert.doesNotMatch(stateful, />\s*\{saving \? "Saving…" : done \? "Reopen" : actionLabel\(task\)\}\s*<\/button>/);
});

test("generic child checklist is flattened into the task document rather than a nested card", () => {
  assert.match(shell, /\.atlas-assigned-task-execution-card \.atlas-plant-check \{/);
  assert.match(shell, /border-radius:0 !important/);
  assert.match(shell, /box-shadow:none !important/);
  assert.match(shell, /background:#fff !important/);
});

test("canonical task move loading never flashes the compatibility task UI", () => {
  assert.match(shell, /assemblyLoading/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} assemblyLoading=\{assemblyLoading\} \/>/);
  assert.match(brief, /function StableTaskMoveLoading/);
  assert.match(brief, /if \(assemblyLoading \|\| selfLoading\)/);
  assert.match(brief, /aria-busy="true"/);
});
