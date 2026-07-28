import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const taskFocus = fs.readFileSync("app/task-focus/[taskId]/page.tsx", "utf8");
const growRoomDoorway = fs.readFileSync("app/grow-room/page.tsx", "utf8");
const growRoomFocus = fs.readFileSync("components/atlas/grow-room/GrowRoomTaskFocus.tsx", "utf8");
const routing = fs.readFileSync("lib/atlas/task-routing-core.js", "utf8");

test("Grow Room Care resolves through the universal task-focus route", () => {
  assert.match(taskFocus, /import GrowRoomTaskFocus/);
  assert.match(taskFocus, /function isGrowRoomRoundTask/);
  assert.match(taskFocus, /<GrowRoomTaskFocus visitTaskId=\{task\.id\}/);
  assert.match(taskFocus, /round_completion_required/);
  assert.match(taskFocus, /manual_top_level_card/);
});

test("the old Grow Room route is only a doorway into canonical task focus", () => {
  assert.match(growRoomDoorway, /grow_room_round_v1/);
  assert.match(growRoomDoorway, /redirect\(taskFocusHref/);
  assert.doesNotMatch(growRoomDoorway, /resolve_request/);
  assert.doesNotMatch(growRoomDoorway, /finish_round/);
});

test("specialized Grow Room inputs remain inside the normal Atlas task shell", () => {
  assert.match(growRoomFocus, /data-atlas-task-workflow="grow-room-round"/);
  assert.match(growRoomFocus, /atlas-task-page-shell/);
  assert.match(growRoomFocus, /atlas-dominion-task-card/);
  assert.match(growRoomFocus, /Record live count/);
  assert.match(growRoomFocus, /Needs another day/);
  assert.match(growRoomFocus, /Problem found/);
  assert.match(growRoomFocus, /Finish task/);
});

test("the shared workflow classifier distinguishes a Grow Room round from ordinary Grow Room work", () => {
  assert.match(routing, /return "grow_room_round"/);
  assert.match(routing, /task\?\.task_type === "grow_room_care"/);
  assert.match(routing, /round_completion_required/);
  assert.match(routing, /manual_top_level_card/);
});
