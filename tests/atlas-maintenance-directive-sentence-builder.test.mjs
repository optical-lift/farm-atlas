import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");

test("object-first task sentence remains editable through pills and structured controls", () => {
  assert.match(composer, />Create</);
  assert.match(composer, />on</);
  assert.match(composer, />for</);
  assert.match(composer, />due</);
  assert.match(composer, />during</);
  assert.match(composer, /className=\{styles\.pill\}/);
  assert.match(composer, /Task title/);
  assert.match(composer, /Instructions/);
  assert.match(composer, /Assigned to/);
  assert.match(composer, /Due date/);
  assert.match(composer, /Lockscreen window/);
  assert.match(composer, /Attach crop cycles/);
  assert.match(composer, /Checklist/);
});

test("the composer states that persistent cards remain canonical", () => {
  assert.match(composer, /does not create a rival maintenance task/);
  assert.match(composer, /remains the perpetual record/);
  assert.match(composer, /This instruction lasts only until its real result is recorded/);
});
