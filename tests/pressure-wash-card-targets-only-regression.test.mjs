import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/atlas/venue-reset-task-detail.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260822232642_pressure_wash_card_tools_and_targets_only_v1.sql", import.meta.url), "utf8");

test("pressure wash card has a dedicated tools-and-target rendering path", () => {
  assert.ok(component.includes('pressure_wash_card_content_contract'));
  assert.ok(component.includes('tools_and_spray_location_only_v1'));
  assert.ok(component.includes('data-atlas-pressure-wash-content="tools-and-target-only"'));
  assert.ok(component.includes('<small>Tools</small>'));
  assert.ok(component.includes('<small>Spray</small><strong>{location}</strong>'));
});

test("pressure wash dedicated path does not render method or ready sections", () => {
  const branchStart = component.indexOf('{pressureWashTargetsOnly ? (');
  const branchEnd = component.indexOf(') : (', branchStart);
  const pressureWashBranch = component.slice(branchStart, branchEnd);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.doesNotMatch(pressureWashBranch, /Reset work|method|atlas-reset-ready|execution_how|safety/i);
});

test("pressure wash source payloads remove instruction prose while preserving location identity", () => {
  for (const field of ["why_now", "state_effect", "execution_how", "execution_done_when", "gentle_cedar_method"]) {
    assert.ok(migration.includes(`- '${field}'`));
  }
  assert.ok(migration.includes("task_payload = jsonb_set"));
  assert.ok(migration.includes("'pressure_wash_card_content_contract','tools_and_spray_location_only_v1'"));
  assert.ok(migration.includes("q.queue_key=v_queue_key"));
});

test("former pressure wash checklist instruction rows are retired instead of deleted", () => {
  assert.ok(migration.includes("atlas.task_execution_checklist_items"));
  assert.ok(migration.includes("'retired','true'"));
  assert.ok(migration.includes("required=false"));
  assert.ok(migration.includes("checked=false"));
  assert.doesNotMatch(migration, /delete\s+from\s+atlas\.task_execution_checklist_items/i);
});
