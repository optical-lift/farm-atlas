import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Task Focus navigation makes explicit returnTo authoritative before history fallback", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");

  assert.match(boundary, /new URLSearchParams\(window\.location\.search\)\.get\("returnTo"\)/);
  assert.match(boundary, /trimmed\.startsWith\("\/"\) && !trimmed\.startsWith\("\/\/"\)/);
  assert.match(boundary, /if \(requested\) \{\s*window\.location\.assign\(requested\);\s*return;/s);
  assert.match(boundary, /new URL\(document\.referrer\)\.origin === window\.location\.origin/);
  assert.match(boundary, /window\.history\.back\(\)/);
  assert.match(boundary, /window\.location\.assign\(fallbackPath\)/);
});

test("Task Focus navigation normalizes the legacy top control to an X", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");

  assert.match(boundary, /target\.closest\("\.atlas-note-plus"\)/);
  assert.match(boundary, /data-atlas-task-focus-navigation="v1"/);
  assert.match(boundary, /\.atlas-task-focus-navigation-boundary \.atlas-note-plus::before/);
  assert.match(boundary, /content: "×"/);
});

test("canonical generic execution and Farm Round both consume Task Focus navigation without sharing execution semantics", () => {
  const workerReady = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
  const registry = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(workerReady, /function CanonicalAssignedTaskExecutionSurface/);
  assert.match(workerReady, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.match(workerReady, /return <WaitingScreen/);
  assert.match(workerReady, /return <ReadinessFailureScreen/);
  assert.match(workerReady, /<TaskFocusNavigationBoundary fallbackPath=\{props\.assignee\.listPath\}>\s*<CanonicalAssignedTaskExecutionSurface \{\.\.\.props\} \/>/s);
  assert.match(registry, /if \(isFarmRoundTask\(props\.task\)\) \{[\s\S]*<TaskFocusNavigationBoundary fallbackPath=\{props\.assignee\.listPath\} showCloseControl>[\s\S]*<FarmRoundTaskDetail \{\.\.\.props\} \/>[\s\S]*<\/TaskFocusNavigationBoundary>/);
  assert.match(registry, /return <WorkerReadyAssignedTaskExecutionShell/);
});
