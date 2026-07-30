import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker-facing task cues describe effort without clock-hour estimates", () => {
  const route = read("lib/atlas/day-route.ts");
  const week = read("app/overview/week/page.tsx");

  assert.match(week, /atlasDayTaskCues/);
  assert.match(route, /workClass/);
  assert.match(route, /resource_requirements/);
  assert.match(route, /internal capacity math/);
  assert.doesNotMatch(route, /durationLabel/);
  assert.doesNotMatch(route, /estimated_minutes/);
  assert.doesNotMatch(route, /duration_minutes/);
  assert.doesNotMatch(route, /\$\{rounded\} hr/);
  assert.doesNotMatch(route, /\$\{Math\.round\(minutes\)\} min/);
});
