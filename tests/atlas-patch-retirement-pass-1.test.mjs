import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("root layout no longer mounts retired no-op or Home visibility patches", () => {
  const layout = read("app/layout.tsx");

  assert.doesNotMatch(layout, /FutureDayProjectionBridge/);
  assert.doesNotMatch(layout, /HomeQuietTaskHeroPatch/);
  assert.doesNotMatch(layout, /TaskResultAnchorPatch/);
  assert.equal(existsSync(join(root, "app/FutureDayProjectionBridge.tsx")), false);
  assert.equal(existsSync(join(root, "app/HomeQuietTaskHeroPatch.tsx")), false);
  assert.equal(existsSync(join(root, "app/TaskResultAnchorPatch.tsx")), false);
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
