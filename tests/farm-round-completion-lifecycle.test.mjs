import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frame = fs.readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const farmRound = fs.readFileSync("components/atlas/farm-round-task-detail.tsx", "utf8");

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
