import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/atlas/mowing-card-view-model.ts", import.meta.url), "utf8");

test("production Mow card keeps the approved recurrence-first anatomy", () => {
  assert.match(source, /family: "Mow"/);
  assert.match(source, /last: clean\(input\.lastMowedAt\)/);
  assert.match(source, /current: clean\(input\.dueDate\)/);
  assert.match(source, /next: clean\(input\.nextCheckDate\)/);
  assert.match(source, /height:/);
  assert.match(source, /equipment:/);
});

test("production Mow card never invents specimen resource truth", () => {
  assert.doesNotMatch(source, /resource:\s*"Gas"/);
  assert.doesNotMatch(source, /resource:\s*"2 batteries"/);
  assert.doesNotMatch(source, /Aug 12|Aug 19|Aug 26|U-Pick Walkways/);
  assert.match(source, /Resources are supplied by the canonical execution\/readiness contract/);
});

test("production Mow card refuses to manufacture a future recurrence", () => {
  assert.match(source, /Do not manufacture a future recurrence/);
  assert.doesNotMatch(source, /setDate|getDate\(\) \+/);
});

test("Mow equipment labels normalize presentation without changing resource state", () => {
  assert.match(source, /Battery-powered push mower/);
  assert.match(source, /Riding mower/);
  assert.match(source, /status: clean\(resource\.status\)/);
  assert.match(source, /reason: clean\(resource\.reason\)/);
});
