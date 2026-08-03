import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../lib/atlas/day-route.ts", import.meta.url);

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
