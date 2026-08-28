import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

test("directed flower prep uses owner QTY and worker Made tally", () => {
  const card = read("components/atlas/directed-flower-preparation-task-detail.tsx");
  assert.match(card, /Condition \+ Bunch/);
  assert.match(card, /Record final tally/);
  assert.match(card, />QTY</);
  assert.match(card, />Made</);
  assert.match(card, /requestedQuantity/);
  assert.match(card, /actualQuantity/);
  assert.match(card, /Remaining stems/);
  assert.match(card, /Flowers are ready/);
  assert.match(card, /flower_preparation_directive_final_tally_v1/);
  assert.match(card, /\/api\/atlas\/task-transition/);
  assert.doesNotMatch(card, /What is Ready now\?/);
});

test("flower preparation context exposes immutable directive lines", () => {
  const route = read("app/api/atlas/flower-preparation-context/route.ts");
  assert.match(route, /flower_preparation_directive_id/);
  assert.match(route, /flower_preparation_directive_lines/);
  assert.match(route, /requested_quantity/);
  assert.match(route, /stems_per_unit/);
});

test("flower preparation context accepts the real Condition + Bunch UUID shape", () => {
  const route = read("app/api/atlas/flower-preparation-context/route.ts");
  const literal = route.match(/const UUID_PATTERN = (\/\^.*?\/i);/)?.[1];
  assert.ok(literal, "flower preparation UUID pattern must remain inspectable");
  const pattern = Function(`return ${literal}`)();
  assert.equal(pattern.test("9defb370-7c61-4d72-9200-cbfa2a51700d"), true);
  assert.equal(pattern.test("9a13dbf4-6fa1-4483-aab7-42b852ca05dd"), true);
});

test("flower preparation loader preserves Task Focus route identity", () => {
  const loader = read("components/atlas/flower-preparation-task-loader.tsx");
  assert.match(loader, /window\.location\.pathname/);
  assert.ok(loader.includes("window.location.pathname.match(/^\\/task-focus\\/"));
  assert.match(loader, /const routeTaskId = focusedTaskId\(\)/);
  assert.match(loader, /if \(routeTaskId\) return routeTaskId/);
  assert.match(loader, /flower-preparation-context\?taskId=\$\{encodeURIComponent\(taskId\)\}/);
});
