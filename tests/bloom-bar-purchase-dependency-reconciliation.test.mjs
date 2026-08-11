import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811200500_atlas_bloom_bar_purchase_dependency_reconciliation_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("Bloom Bar purchase waits on the real Monday handoff instead of prose", () => {
  assert.match(migration, /anna_20260810_check_mail_bank_envelope/);
  assert.match(migration, /Buy bloom-bar \+ coffee supplies/);
  assert.match(migration, /insert into atlas\.task_prerequisites/i);
  assert.match(migration, /'done'/);
  assert.match(migration, /'blocked_visible'/);
  assert.match(migration, /reconcile_task_prerequisite_gate_v1/);
});

test("completed handoff restores the Owner purchase card to open work with the exact shopping list", () => {
  assert.match(migration, /'status','open'/);
  assert.match(migration, /5 snips; 1 cold brew carafe; 1 milk carafe; brown sugar coffee syrup; strawberry coffee syrup; 1 tape dispenser/);
  assert.match(normalized, /-'waiting_on'-'waiting_until'/);
  assert.doesNotMatch(migration, /card number|expiration|cvv|security code/i);
});
