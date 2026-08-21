import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/task-card-frame.tsx");
const editorFrame = read("app/owner/task-card-lab/DominionCardFrame.tsx");
const mowingPage = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
const mowing = read("components/atlas/mowing-focus-card.tsx");
const mowingBody = read("components/atlas/mowing-task-card-body.tsx");
const mowingViewModel = read("lib/atlas/mowing-card-view-model.ts");

test("Task Card Editor and live task cards now share one production frame", () => {
  assert.match(frame, /data-atlas-task-card-frame="true"/);
  assert.match(editorFrame, /@\/components\/atlas\/task-card-frame/);
  assert.match(mowingPage, /MowingFocusCard/);
  assert.match(mowing, /AtlasTaskCardFrame/);
});

test("live Mow uses approved recurrence, height, and route-specific equipment grammar", () => {
  assert.match(mowing, /buildMowingCardViewModel/);
  assert.match(mowing, /MowingTaskCardBody/);
  assert.match(mowingBody, /Mowed/);
  assert.match(mowingBody, /Next mow/);
  assert.match(mowingBody, /Mow height/);
  assert.match(mowingBody, /Equipment/);
  assert.match(mowingViewModel, /Battery-powered push mower/);
  assert.match(mowingViewModel, /Riding mower/);
  assert.doesNotMatch(mowingViewModel, /Gas|2 batteries/);
});

test("live Mow card stays visible while canonical readiness controls execution", () => {
  assert.match(mowing, /task-execution-readiness/);
  assert.match(mowing, /completion=\{completion\}/);
  assert.match(mowing, /readiness === null \? null/);
  assert.match(mowing, /data-atlas-task-readiness="blocked"/);
  assert.match(mowing, /Task unavailable/);
  assert.doesNotMatch(mowing, /TaskExecutionBrief/);
});
