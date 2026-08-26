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

test("renderers consume the route shell instead of creating nested navigation authorities", () => {
  const workerReady = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
  const registry = read("components/atlas/canonical-assigned-task-detail.tsx");
  const generic = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.doesNotMatch(workerReady, /<TaskFocusNavigationBoundary/);
  assert.doesNotMatch(registry, /TaskFocusNavigationBoundary/);
  assert.match(generic, /useTaskFocusNavigation\(assignee\.listPath\)/);
  assert.match(generic, /navigation\.complete\(task\.task_id\)/);
  assert.match(generic, /navigation\.leave\(\)/);
});

test("specialized task surfaces use the same shell return contract", () => {
  const files = [
    "app/task-focus/[taskId]/GerminationFocusPage.tsx",
    "app/task-focus/[taskId]/GuestReadinessFocusPage.tsx",
    "app/task-focus/[taskId]/SowingFocusPage.tsx",
    "components/atlas/grow-room/GrowRoomTaskFocus.tsx",
    "components/atlas/mowing-focus-card.tsx",
    "components/atlas/project-task-focus.tsx",
    "components/atlas/portfolio/ProjectReviewTaskFocus.tsx",
  ];

  for (const file of files) {
    const source = read(file);
    assert.match(source, /useTaskFocusNavigation/);
    assert.doesNotMatch(source, /new URLSearchParams\(window\.location\.search\)\.get\("returnTo"\)/);
  }
});
