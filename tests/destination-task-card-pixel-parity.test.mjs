import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveCard = readFileSync(new URL("../components/atlas/destination-assigned-task-card.tsx", import.meta.url), "utf8");
const liveDestination = readFileSync(new URL("../components/atlas/task-destination-contact.tsx", import.meta.url), "utf8");
const liveCss = readFileSync(new URL("../components/atlas/task-destination-contact.module.css", import.meta.url), "utf8");
const workerReady = readFileSync(new URL("../components/atlas/worker-ready-assigned-task-execution-shell.tsx", import.meta.url), "utf8");
const ownerMock = readFileSync(new URL("../app/owner/task-card-lab/DestinationContactCardSpecimen.tsx", import.meta.url), "utf8");

test("live destination tasks use the exact same card frame and destination component as the approved owner mock", () => {
  assert.match(liveCard, /<AtlasTaskCardFrame/);
  assert.match(liveCard, /<TaskDestinationContact destination=\{destination\}/);
  assert.match(ownerMock, /<DominionCardFrame/);
  assert.match(ownerMock, /<TaskDestinationContact destination=\{maryDestination\}/);
  assert.match(workerReady, /isDestinationTask\(props\.task\)/);
  assert.match(workerReady, /<DestinationAssignedTaskCard \{\.\.\.props\} \/>/);
});

test("destination block keeps the approved mock measurements instead of the Task Move trail layout", () => {
  assert.match(liveCss, /padding:\s*17px 18px/);
  assert.match(liveCss, /border-radius:\s*18px/);
  assert.match(liveCss, /font-size:\s*18px/);
  assert.match(liveCss, /font-size:\s*12px/);
  assert.match(liveCss, /display:\s*flex/);
  assert.doesNotMatch(liveCss, /--atlas-task-trail-x/);
  assert.doesNotMatch(liveCss, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
});

test("destination address keeps street on line one and city state zip together on line two", () => {
  assert.match(liveDestination, /const comma = address\.indexOf\(","\)/);
  assert.match(liveDestination, /const first = address\.slice\(0, comma\)/);
  assert.match(liveDestination, /const rest = address\.slice\(comma \+ 1\)/);
});

test("destination card does not render the generic Task Move work spine", () => {
  assert.doesNotMatch(liveCard, /TaskMoveSpine/);
  assert.doesNotMatch(liveCard, /TaskExecutionBrief/);
  assert.match(liveCard, /familyDetail="off-site"/);
  assert.match(liveCard, /maximum_total_minutes/);
});
