import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the task-focus route owns one shared navigation boundary above every renderer", () => {
  const layout = read("app/task-focus/[taskId]/layout.tsx");

  assert.match(layout, /isValidAtlasTaskId\(taskId\)/);
  assert.match(layout, /if \(!isValidAtlasTaskId\(taskId\)\) notFound\(\)/);
  assert.match(layout, /<TaskFocusNavigationBoundary fallbackPath="\/" showCloseControl>\s*\{children\}\s*<\/TaskFocusNavigationBoundary>/s);
});

test("nested task navigation controls are owned by their nearest boundary", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");

  assert.match(boundary, /control\.closest\('\[data-atlas-task-focus-navigation="v1"\]'\)/);
  assert.match(boundary, /if \(owningBoundary !== event\.currentTarget\) return/);
  assert.match(boundary, /:has\(\.atlas-note-plus\) > \.atlas-task-focus-close/);
  assert.match(boundary, /:has\(\.atlas-task-focus-navigation-boundary \.atlas-task-focus-close\) > \.atlas-task-focus-close/);
});

test("route navigation accepts safe local origins and keeps returnTo ahead of history and fallback", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");
  const requested = boundary.indexOf("if (requested)");
  const history = boundary.indexOf("if (sameOriginHistoryAvailable())");
  const fallback = boundary.indexOf("window.location.assign(fallbackPath)");

  assert.match(boundary, /trimmed\.startsWith\("\/"\) && !trimmed\.startsWith\("\/\/"\)/);
  assert.ok(requested >= 0 && history > requested && fallback > history);
});
