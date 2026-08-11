import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("root layout no longer mounts retired no-op or Home visibility patches", () => {
  const layout = read("app/layout.tsx");

  for (const retired of [
    "FutureDayProjectionBridge",
    "HomeQuietTaskHeroPatch",
    "TaskResultAnchorPatch",
    "WeekDayNavigation",
    "HomeSundayNavigationPatch",
    "HomeTodayCompletePatch",
    "OwnerHomeLinkPatch",
    "AnnaPaidScheduleHomePatch",
    "OwnerTaskReturnPatch",
    "ProjectTaskDestinationGuard",
  ]) {
    assert.doesNotMatch(layout, new RegExp(retired));
  }

  for (const retiredFile of [
    "app/FutureDayProjectionBridge.tsx",
    "app/HomeQuietTaskHeroPatch.tsx",
    "app/TaskResultAnchorPatch.tsx",
    "app/WeekDayNavigation.tsx",
    "app/HomeSundayNavigationPatch.tsx",
    "app/HomeTodayCompletePatch.tsx",
    "app/OwnerHomeLinkPatch.tsx",
    "app/AnnaPaidScheduleHomePatch.tsx",
    "app/OwnerTaskReturnPatch.tsx",
    "app/ProjectTaskDestinationGuard.tsx",
  ]) {
    assert.equal(existsSync(join(root, retiredFile)), false);
  }
});

test("Home owns quiet-task visibility before rendering instead of mutating DOM cards", () => {
  const home = read("app/page.tsx");

  assert.match(home, /const quietTaskIds = new Set/);
  assert.match(home, /hide_from_home_hero \?\? task\.metadata\?\.quiet_task/);
  assert.match(home, /move\.kind !== "farm_task"/);
  assert.match(home, /return !quietTaskIds\.has\(taskId\)/);
  assert.match(home, /moves: visibleTaskOverview\.moves/);
});

test("the universal execution shell owns result anchoring and correction evidence context", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.match(shell, /window\.location\.hash !== "#result"/);
  assert.match(shell, /params\.get\("correction"\) === "1"/);
  assert.match(shell, /document\.getElementById\("result"\)/);
  assert.match(shell, /id="result" className="atlas-task-result-footer"/);
  assert.match(shell, /This completion has linked farm evidence\. Review the recorded result before correcting it\./);
});

test("legacy single-task links hand return context to the canonical task-focus route", () => {
  const taskLayout = read("app/task/layout.tsx");
  const projectFocus = read("components/atlas/project-task-focus.tsx");

  assert.match(taskLayout, /function canonicalTaskHref/);
  assert.match(taskLayout, /source\.get\("returnTo"\)/);
  assert.match(taskLayout, /target\.set\("returnTo", returnTo\)/);
  assert.match(taskLayout, /source\.get\("correction"\)/);
  assert.match(taskLayout, /window\.location\.replace\(canonicalTaskHref\(taskId, params\)\)/);
  assert.doesNotMatch(taskLayout, /\?taskId=\$\{encoded\}/);
  assert.match(projectFocus, /const destination = returnTo \|\| `\/project\/\$\{encodeURIComponent\(project\.projectId\)\}`/);
});

test("superseded bed and germination DOM patches stay retired behind their canonical surfaces", () => {
  assert.equal(existsSync(join(root, "app/CollapsibleBedCropPatch.tsx")), false);
  assert.equal(existsSync(join(root, "app/GerminationCheckTaskPatch.tsx")), false);
  assert.equal(existsSync(join(root, "app/RouteAwareGerminationCheckTaskPatch.tsx")), false);
  assert.equal(existsSync(join(root, "app/SafeBedCropAccordionPatch.tsx")), true);
  assert.equal(existsSync(join(root, "app/task-focus/[taskId]/GerminationFocusPage.tsx")), true);
});
