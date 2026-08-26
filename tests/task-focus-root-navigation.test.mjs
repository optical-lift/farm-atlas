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

test("the server task registry no longer interprets or filters return destinations", () => {
  const page = read("app/task-focus/[taskId]/page.tsx");

  assert.doesNotMatch(page, /SAFE_RETURN_PATHS/);
  assert.doesNotMatch(page, /safeReturnPath/);
  assert.doesNotMatch(page, /searchParams/);
  assert.doesNotMatch(page, /query\.returnTo/);
  assert.doesNotMatch(page, /returnTo:/);
  assert.doesNotMatch(page, /listPath:\s*returnTo/);
});

test("the route shell accepts any safe local origin and keeps returnTo ahead of history and fallback", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");
  const requested = boundary.indexOf("if (requested)");
  const history = boundary.indexOf("if (sameOriginHistoryAvailable())");
  const fallback = boundary.indexOf("window.location.assign(fallbackPath)");

  assert.match(boundary, /trimmed\.startsWith\("\/"\) && !trimmed\.startsWith\("\/\/"\)/);
  assert.match(boundary, /useTaskFocusNavigation/);
  assert.match(boundary, /requestedReturnPath/);
  assert.ok(requested >= 0 && history > requested && fallback > history);
});
