import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const routing = read("supabase/migrations/20260804034000_calm_collected_operational_bell_v1.sql");
const criticality = read("supabase/migrations/20260804034500_operational_rhythm_criticality_stays_routed_v1.sql");
const view = read("lib/atlas/bell-view.ts");

test("routine operational clocks resolve to an Atlas-owned surface before Bell", () => {
  assert.match(routing, /operational_rhythm_surface_v1/);
  assert.match(routing, /'monitoring_queue'/);
  assert.match(routing, /'queued_work'/);
  assert.match(routing, /'selected_work'/);
  assert.match(routing, /'owner_attention'/);
  assert.match(routing, /'weed_stewardship'/);
  assert.match(routing, /'mowing'/);
  assert.match(routing, /'harvest_watch'/);
  assert.match(routing, /'germination_watch'/);
});

test("monitoring, capacity queues, and selected work do not require human action", () => {
  assert.match(routing, /v_surface in \('monitoring_queue', 'queued_work', 'selected_work', 'resolved'\)/);
  assert.match(routing, /return false;/);
  assert.match(routing, /v_task\.status = 'blocked'/);
  assert.match(routing, /return 'owner_attention'/);
});

test("generic criticality cannot pull already-routed rhythm work back into Bell", () => {
  const rhythmDecision = criticality.indexOf("event.event_kind in ('rhythm_due', 'rhythm_failure')");
  const genericCriticality = criticality.indexOf("event.importance = 'critical'");
  assert.ok(rhythmDecision >= 0 && genericCriticality > rhythmDecision);
  assert.match(criticality, /operational_rhythm_surface_v1\(event\.id\) in \('owner_attention', 'exception'\)/);
});

test("Bell says it needs judgment rather than reporting Atlas bookkeeping", () => {
  assert.match(view, /eyebrow: "Needs you"/);
  assert.match(view, /status: "Calm"/);
  assert.match(view, /Atlas is handling the routine work/);
  assert.match(view, /Nothing needs your judgment/);
  assert.match(view, /Monitoring, queued work, and Anna’s selected work remain collected/);
  assert.doesNotMatch(view, /review date elapsed/i);
});

test("the calm Bell contract contains no farm or member fixtures", () => {
  const build = `${routing}\n${criticality}\n${view}`;
  assert.doesNotMatch(build, /6a503d9f|23e98e5e|4cd799e2/i);
});
