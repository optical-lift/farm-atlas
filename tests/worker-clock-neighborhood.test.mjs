import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/atlas/worker-clock-neighborhood.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { buildWorkerClockNeighborhood } = await import(moduleUrl);

function item(id, title, status, sequenceOrder, plannedStartAt = "2026-08-29T12:00:00Z") {
  return {
    kind: "committed_task",
    id,
    sourceRowId: id,
    sourceKind: "task",
    sourceId: id,
    taskId: id,
    title,
    note: null,
    status,
    workRoute: "repair",
    location: "Barn",
    environment: null,
    estimatedMinutes: null,
    dayWindow: "afternoon",
    sequenceOrder,
    commitmentState: "committed",
    automatic: false,
    reason: null,
    commitmentKind: null,
    preferredWindowStart: null,
    preferredWindowEnd: null,
    safeWindowEnd: null,
    timingWarning: null,
    placementId: null,
    plannedStartAt,
    plannedDurationMinutes: 30,
    mobility: {},
    positionResolved: true,
  };
}

function range(work, startMinute, endMinute) {
  return { item: work, startMinute, endMinute, span: { minutes: Math.max(0, endMinute - startMinute), source: "planned" } };
}

test("past-due open timed work becomes NOW instead of disappearing", () => {
  const overdue = item("overdue", "Adjust barn door", "open", 1);
  const future = item("future", "Replace gate latch", "open", 2);
  const result = buildWorkerClockNeighborhood({
    committed: [overdue, future],
    ranges: [range(overdue, 600, 630), range(future, 720, 750)],
    reservations: [],
    nowMinute: 690,
  });
  assert.equal(result.moves[0].role, "now");
  assert.equal(result.moves[0].id, "overdue");
  assert.match(result.moves[0].timeLabel, /^Overdue · planned/);
  assert.equal(result.moves[1].role, "next");
  assert.equal(result.moves[1].id, "future");
});

test("an active task owns NOW while older unresolved work remains carried forward", () => {
  const overdue = item("overdue", "Clear fence line", "open", 1);
  const active = item("active", "Adjust barn door", "open", 2);
  const future = item("future", "Replace gate latch", "open", 3);
  const result = buildWorkerClockNeighborhood({
    committed: [overdue, active, future],
    ranges: [range(overdue, 600, 630), range(active, 680, 720), range(future, 740, 770)],
    reservations: [],
    nowMinute: 690,
  });
  assert.deepEqual(result.moves.map((move) => [move.role, move.id]), [["now", "active"], ["next", "overdue"], ["then", "future"]]);
  assert.match(result.moves[1].timeLabel, /^Carry · planned/);
});

test("latest completed work is LAST and the next fixed reservation becomes the hard edge", () => {
  const olderDone = item("older", "Property round", "completed", 1);
  const latestDone = item("latest", "Mow orchard edge", "done", 2);
  const future = item("future", "Adjust barn door", "open", 3);
  const result = buildWorkerClockNeighborhood({
    committed: [olderDone, latestDone, future],
    ranges: [range(olderDone, 540, 570), range(latestDone, 600, 645), range(future, 720, 750)],
    reservations: [{ id: "meeting", entityId: "meeting", title: "Meet electrician", source: "external_commitment", kind: "span", startMinute: 780, endMinute: 810, blocking: true, reason: "fixed", reservation: null }],
    nowMinute: 690,
  });
  assert.equal(result.moves[0].role, "last");
  assert.equal(result.moves[0].id, "latest");
  assert.match(result.moves[0].timeLabel, /^Done ·/);
  assert.deepEqual(result.hardEdge, { id: "meeting", label: "Meet electrician", timeLabel: "1:00 PM–1:30 PM" });
});

test("committed untimed work remains eligible for NEXT and THEN", () => {
  const first = item("first", "Inspect irrigation", "open", 1, null);
  const second = item("second", "Stage repair materials", "open", 2, null);
  const result = buildWorkerClockNeighborhood({ committed: [first, second], ranges: [], reservations: [], nowMinute: 690 });
  assert.deepEqual(result.moves.map((move) => [move.role, move.id]), [["next", "first"], ["then", "second"]]);
  assert.equal(result.moves[0].timeLabel, "Today · timing unresolved");
});
