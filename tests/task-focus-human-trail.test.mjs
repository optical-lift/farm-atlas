import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");
const weed = read("components/atlas/weed-card-task-focus.tsx");

test("canonical Task Move data renders as a compact human trail instead of schema labels", () => {
  assert.match(spine, /aria-label="Task trail"/);
  assert.match(spine, />Right now</);
  assert.match(spine, />Do this</);
  assert.match(spine, /"Target held" : "Finished"/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
  assert.match(spine, /atlas-human-task-trail__requirements/);
  assert.doesNotMatch(spine, />Task move</i);
  assert.doesNotMatch(spine, />Current</);
  assert.doesNotMatch(spine, />Move</);
  assert.doesNotMatch(spine, />After</);
  assert.doesNotMatch(spine, /Ready to do/);
  assert.doesNotMatch(spine, /Check before doing/);
});

test("instructions stay explicit while duplicate architecture furniture is removed", () => {
  assert.match(brief, /<h2>Instructions<\/h2>/);
  assert.match(brief, /atlas-human-task-instructions__note/);
  assert.doesNotMatch(brief, /More instructions/);
  assert.doesNotMatch(shell, /Before the move/);
  assert.doesNotMatch(shell, /data-atlas-task-readiness/);
  assert.match(shell, /This can&apos;t move yet/);
});

test("Weed Card stops rendering the fake geometry bed map", () => {
  assert.doesNotMatch(weed, /CropOccupancyBedMap/);
  assert.match(weed, /CropOccupancyList/);
  assert.match(weed, /condition-summary/);
});
