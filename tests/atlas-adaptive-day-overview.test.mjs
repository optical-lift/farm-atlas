import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/work/today/page.tsx", import.meta.url), "utf8");
const checkIn = readFileSync(new URL("../components/atlas/work/WorkerDayModeCheckIn.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../lib/atlas/adaptive-day-overview.ts", import.meta.url), "utf8");
const workerHand = readFileSync(new URL("../lib/atlas-data/worker-hand.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/worker-day-routing/route.ts", import.meta.url), "utf8");

test("farm-hand Day Overview is an ordered orientation surface", () => {
  assert.match(page, /Today's order/);
  assert.match(page, /AdaptiveSection title="Now"/);
  assert.match(page, /AdaptiveSection title="Coming up"/);
  assert.match(page, /AdaptiveSection title="Later"/);
  assert.match(page, /AdaptiveSection title="Waiting"/);
  assert.match(page, /Atlas is holding the order/);
});

test("morning check-in asks how Atlas should help rather than grading energy", () => {
  assert.match(checkIn, /How should Atlas help you start today\?/);
  assert.match(checkIn, /I'm ready/);
  assert.match(checkIn, /Keep me moving/);
  assert.match(checkIn, /Make it simple/);
  assert.match(checkIn, /Keep it light physically/);
  assert.doesNotMatch(checkIn, /low energy/i);
});

test("adaptive ordering uses routing and recovery signals", () => {
  assert.match(engine, /activation_demand/);
  assert.match(engine, /ambiguity_load/);
  assert.match(engine, /setup_load/);
  assert.match(engine, /physical_load/);
  assert.match(engine, /recoveryMovesRemaining/);
  assert.match(engine, /Quick win/);
});

test("worker hand exposes metadata through v2 without replacing v1 database contract", () => {
  assert.match(workerHand, /worker_task_hand_v2/);
  assert.match(workerHand, /metadata: Record<string, unknown>/);
});

test("worker day mode API is farm-hand scoped and intent protected", () => {
  assert.match(route, /worker-day-routing-v1/);
  assert.match(route, /membership\.role !== "farm_hand"/);
  assert.match(route, /set_worker_day_routing_mode_v1/);
});
