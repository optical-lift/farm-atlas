import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy /task is collection-only and opens canonical Task Focus", () => {
  const page = read("app/task/page.tsx");

  assert.match(page, /data-atlas-task-collection="true"/);
  assert.match(page, /\/task-focus\/\$\{encodeURIComponent\(task\.task_id\)\}/);
  assert.doesNotMatch(page, /postAtlasTaskTransition/);
  assert.doesNotMatch(page, /ActiveTaskCard/);
  assert.doesNotMatch(page, /transition: "rescheduled"/);
});

test("root template no longer classifies tasks or mutates rendered Home markup", () => {
  const template = read("app/template.tsx");

  assert.match(template, /return <>\{children\}<\/>/);
  assert.doesNotMatch(template, /MutationObserver/);
  assert.doesNotMatch(template, /task-cards/);
  assert.doesNotMatch(template, /document\.querySelector/);
  assert.doesNotMatch(template, /window\.location/);
});
