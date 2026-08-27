import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("spray task detail renders canonical worker surfaces instead of task prose", () => {
  const component = read("components/atlas/vegetation-control-task-detail.tsx");

  assert.match(component, /atlasWorkerResourceComponents\(task\.resource_requirements\)/);
  assert.match(component, /resources\.length\?<section className="atlas-treatment-resources"/);
  assert.match(component, /<strong>\{resource\.label\}<\/strong>/);
  assert.match(component, /card\?\.objectLabel\|\|target\?\.object_label\|\|"Treatment area"/);
  assert.match(component, /card\?\.zoneLabel\|\|text\(task\.zone_label\)\|\|"Elm Farm"/);
  assert.match(component, /step\.cropLabel\|\|"Treatment"/);

  for (const forbidden of [
    "execution_how",
    "execution_do",
    "display_detail",
    "sequence_restart_reason",
    "resource.note",
    "resource.status",
    "resource.requirement_status",
    "resource.resource_status",
    "Method resource not attached",
    "do not infer product",
    "step.title",
    "task.title",
    "metadata.display_location",
    "metadata.execution_place",
    "metadata.display_subject",
    "metadata.collection_zone",
  ]) {
    assert.equal(component.includes(forbidden), false, `worker prose escape returned: ${forbidden}`);
  }
});

test("worker resource resolver fails closed to canonical resource key plus canonical label", () => {
  const display = read("lib/atlas/worker-display.ts");

  assert.match(display, /export function atlasWorkerResourceComponent/);
  assert.match(display, /value\?\.resource_key/);
  assert.match(display, /value\?\.resource_label/);
  assert.match(display, /if \(!key \|\| !label\) return null;/);
  assert.match(display, /return \{ key, label \};/);
  assert.match(display, /\.map\(\(value\) => atlasWorkerResourceComponent\(value\)\)/);
});

test("spray display regression preserves the shared database custody boundary", () => {
  const custody = read("docs/architecture/shared-db-custody-consumer-v1.md");
  const self = read("tests/atlas-vegetation-worker-display-membrane.test.mjs");

  assert.match(custody, /noel-core-db` owns \*\*executable database migration source\*\*/i);
  assert.match(custody, /does not copy post-fence migrations back into Farm Atlas/i);
  assert.doesNotMatch(self, /supabase\/migrations\//);
});
