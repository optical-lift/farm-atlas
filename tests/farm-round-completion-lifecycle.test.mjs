import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frame = fs.readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const farmRound = fs.readFileSync("components/atlas/farm-round-task-detail.tsx", "utf8");

test("shared task-card footer can execute supplied completion actions", () => {
  assert.match(frame, /onDone\?: \(\) => void/);
  assert.match(frame, /onUnfinished\?: \(\) => void/);
  assert.match(frame, /onClick=\{onDone\}>Done<\/button>/);
  assert.match(frame, /onClick=\{onUnfinished\}>Unfinished<\/button>/);
});

test("Farm Round terminal completion uses canonical child transitions then returns to the day feed", () => {
  assert.match(farmRound, /async function completeRound\(\)/);
  assert.match(farmRound, /transition: "done"/);
  assert.match(farmRound, /farmRoundTerminalAction: true/);
  assert.match(farmRound, /window\.location\.assign\(returnPath\(assignee\)\)/);
  assert.match(farmRound, /onDone=\{\(\) => void completeRound\(\)\}/);
});

test("checking the final Farm Round member still follows the same terminal return path", () => {
  assert.match(farmRound, /nextMembers\.every\(\(candidate\) => isDone\(candidate\)\)/);
  assert.match(farmRound, /window\.setTimeout\(\(\) => window\.location\.assign\(returnPath\(assignee\)\), 120\)/);
});
