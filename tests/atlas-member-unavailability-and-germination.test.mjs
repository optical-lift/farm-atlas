import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260803134500_add_member_unavailability_and_repair_germination_delivery.sql",
    import.meta.url,
  ),
  "utf8",
);

test("member unavailability is authoritative for Presented Work", () => {
  assert.match(migration, /create table if not exists atlas\.member_unavailability/);
  assert.match(migration, /v_work_date between unavailable\.unavailable_start and unavailable\.unavailable_end/);
  assert.match(migration, /if exists \([\s\S]*member_unavailability[\s\S]*then\s+return;/);
  assert.match(migration, /anna_tennessee_return_20260803/);
});

test("non-germination work is removed from the Germination collection", () => {
  assert.match(migration, /t\.task_type <> 'germination_check'/);
  assert.match(migration, /- 'collection_member_key'/);
  assert.match(migration, /- 'germination_variety_key'/);
});

test("real Anna germination checks become assigned actionable cards", () => {
  assert.match(migration, /assigned_membership_id = context\.membership_id/);
  assert.match(migration, /assigned_user_id = context\.user_id/);
  assert.match(migration, /visibility_scope = 'assigned_worker'/);
  assert.match(migration, /action_key = 'germination_check'/);
  assert.match(migration, /germination_delivery_repaired_at/);
  assert.match(migration, /planned_work_occurrences/);
});
