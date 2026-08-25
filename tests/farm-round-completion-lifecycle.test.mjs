import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frame = fs.readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const farmRound = fs.readFileSync("components/atlas/farm-round-task-detail.tsx", "utf8");
const farmRoundCss = fs.readFileSync("components/atlas/farm-round-task-detail.module.css", "utf8");

test("shared task-card footer requires executable completion actions", () => {
  assert.match(frame, /type InteractiveCompletionProps = \{[\s\S]*?onDone: \(\) => void;[\s\S]*?onUnfinished: \(\) => void;/);
  assert.match(frame, /onClick=\{props\.onDone\}>Done<\/button>/);
  assert.match(frame, /onClick=\{props\.onUnfinished\}>Unfinished<\/button>/);
});

test("Farm Round terminal completion uses canonical child transitions then returns to the day feed", () => {
  assert.match(farmRound, /async function completeRound\(\)/);
  assert.match(farmRound, /transition: "done"/);
  assert.match(farmRound, /farmRoundTerminalAction: true/);
  assert.match(farmRound, /window\.location\.assign\(returnPath\(assignee\)\)/);
  assert.match(farmRound, /onDone=\{\(\) => void completeRound\(\)\}/);
  assert.match(farmRound, /onUnfinished=\{leaveUnfinished\}/);
});

test("checking the final Farm Round member still follows the same terminal return path", () => {
  assert.match(farmRound, /nextMembers\.every\(\(candidate\) => isDone\(candidate\)\)/);
  assert.match(farmRound, /window\.setTimeout\(\(\) => window\.location\.assign\(returnPath\(assignee\)\), 120\)/);
});

test("Farm Round member completion is a full-row mobile toggle rather than a tiny native checkbox", () => {
  assert.match(farmRound, /role="checkbox"/);
  assert.match(farmRound, /aria-checked=\{done\}/);
  assert.match(farmRound, /className=\{roundStyles\.itemToggle\}/);
  assert.match(farmRound, /onClick=\{\(\) => void toggle\(member\)\}/);
  assert.doesNotMatch(farmRound, /type="checkbox"/);
  assert.match(farmRoundCss, /\.itemToggle \{[\s\S]*?min-height: 44px;[\s\S]*?touch-action: manipulation;/);
  assert.match(farmRoundCss, /\.stop::before \{[\s\S]*?pointer-events: none;/);
  assert.match(farmRoundCss, /\.stop::after \{[\s\S]*?pointer-events: none;/);
});
