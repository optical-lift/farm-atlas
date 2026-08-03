import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../lib/atlas/day-route.ts", import.meta.url);
const orderPath = new URL("../lib/atlas/work-order.ts", import.meta.url);
const consequencePath = new URL("../lib/atlas/day-consequence.ts", import.meta.url);
const primitivesPath = new URL("../components/atlas/living-day-primitives.tsx", import.meta.url);

test("day task families are derived from canonical task fields, never title prose", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /work_category_label/);
  assert.match(source, /display_action/);
  assert.match(source, /canonicalActionKey/);
  assert.doesNotMatch(source, /task\.title/);
  assert.doesNotMatch(source, /value\.includes\("cut"\)/);
  assert.doesNotMatch(source, /value\.includes\("harvest"\)/);
});

test("care pulse classification uses controlled task fields rather than prose", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /normalized\(task\.task_type\)/);
  assert.match(source, /normalized\(task\.metadata\?\.work_rhythm\)/);
  assert.doesNotMatch(source, /taskSearchText/);
});

test("fallback work ordering reads canonical route and category fields, not task titles", async () => {
  const source = await readFile(orderPath, "utf8");

  assert.match(source, /atlasRouteKeyForTask\(task\)/);
  assert.match(source, /work_category_key/);
  assert.match(source, /work_collection_key/);
  assert.doesNotMatch(source, /task\.title/);
  assert.doesNotMatch(source, /function taskText/);
});

test("day playability uses action and task type rather than title prose", async () => {
  const source = await readFile(consequencePath, "utf8");
  const workClassifier = source.slice(
    source.indexOf("export function atlasIsDayWorkTask"),
    source.indexOf("export function atlasIsFlexibleDayDeal"),
  );

  assert.match(workClassifier, /canonicalAction\(task\)/);
  assert.match(workClassifier, /NON_EXECUTION_TASK_TYPES/);
  assert.doesNotMatch(workClassifier, /task\.title/);
  assert.doesNotMatch(workClassifier, /unlock_text/);
});

test("Living Day contains farm language rather than planner and database commentary", async () => {
  const source = await readFile(primitivesPath, "utf8");

  assert.match(source, /unlocks\.filter\(\(unlock\) => !unlock\.taskId\)/);
  assert.doesNotMatch(source, /denominator/i);
  assert.doesNotMatch(source, /canonical work is playable/i);
  assert.doesNotMatch(source, /source_table/i);
  assert.doesNotMatch(source, /no new task is released/i);
  assert.doesNotMatch(source, /physical condition is not inferred/i);
  assert.doesNotMatch(source, /added after morning plan/i);
});
