import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812001500_grow_room_round_task_boundary_v1.sql", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();
const eligibleStart = normalized.indexOf("with eligible as (");
const linkedStart = normalized.indexOf("), linked as (", eligibleStart);
const eligible = normalized.slice(eligibleStart, linkedStart);

test("Grow Room round only inlines small care and check work", () => {
  assert.ok(eligibleStart >= 0 && linkedStart > eligibleStart, "eligible candidate query must be present");
  assert.match(eligible, /t\.task_type in \('germination_check', 'grow_room_check'\)/);
  assert.doesNotMatch(eligible, /'pot_up'/);
  assert.doesNotMatch(eligible, /'hardening_off'/);
  assert.doesNotMatch(eligible, /'transplant_readiness'/);
  assert.doesNotMatch(eligible, /'propagation_readiness'/);
});

test("system-internal provenance cannot enter a worker Grow Room round", () => {
  assert.match(eligible, /t\.visibility_scope <> 'system_internal'/);
});

test("existing substantive round links are removed at the choreography layer", () => {
  assert.match(normalized, /delete from atlas\.grow_room_round_requests rr using atlas\.tasks request_task/);
  assert.match(normalized, /request_task\.visibility_scope = 'system_internal'/);
  assert.match(normalized, /request_task\.task_type in \('pot_up', 'hardening_off', 'transplant_readiness', 'propagation_readiness'\)/);
  assert.match(normalized, /rr\.resolved_at is null/);
});

test("the boundary is generic and does not patch the Snow specimen by identity", () => {
  assert.doesNotMatch(migration, /Snow in Summer/i);
  assert.doesNotMatch(migration, /458ab3a9-6cae-457d-8bf2-ae718a9c3a5e/i);
});

test("the canonical Grow Room round function keeps its existing access contract", () => {
  assert.match(migration, /create or replace function atlas\.grow_room_round_v1/);
  assert.match(migration, /security definer/);
  assert.doesNotMatch(migration, /\bgrant\s+execute\b/i);
  assert.doesNotMatch(migration, /\brevoke\s+all\s+on\s+function\b/i);
});
