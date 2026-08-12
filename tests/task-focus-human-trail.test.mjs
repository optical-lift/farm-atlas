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

test("canonical Task Move data renders as compact worker cues instead of schema explanation", () => {
  assert.match(spine, /aria-label="Task move"/);
  assert.match(spine, />Needs</);
  assert.match(spine, />Do this</);
  assert.match(spine, />Done</);
  assert.match(spine, /requirementGlyph/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.doesNotMatch(spine, />Right now</);
  assert.doesNotMatch(spine, /Target held/);
  assert.doesNotMatch(spine, /atlas-human-task-trail__requirements/);
  assert.doesNotMatch(spine, /requirement\.note/);
  assert.doesNotMatch(spine, /requirement\.questions/);
  assert.doesNotMatch(spine, /Ready to do/);
  assert.doesNotMatch(spine, /Check before doing/);
});

test("instructions are collapsed and duplicate explanatory prose is removed", () => {
  assert.match(brief, /<details className="atlas-worker-instructions">/);
  assert.match(brief, /<summary>Instructions<\/summary>/);
  assert.match(brief, /fallbackDetail = !lines\.length/);
  assert.doesNotMatch(brief, /atlas-human-task-instructions__note/);
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
