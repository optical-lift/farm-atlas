import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the task Trail follows client-side navigation into task focus", () => {
  const source = read("components/atlas/task-focus-tending-trail.tsx");

  assert.match(source, /usePathname/);
  assert.match(source, /const pathname = usePathname\(\)/);
  assert.match(source, /pathname\.match/);
  assert.match(source, /\}, \[pathname\]\);/);
  assert.match(source, /atlas-task-page-active/);
  assert.match(source, /TendingTaskTrailPanel/);
});
