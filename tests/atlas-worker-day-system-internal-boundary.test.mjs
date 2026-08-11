import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811232500_worker_day_system_internal_boundary_v1.sql", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();

test("worker presented work excludes system-internal provenance on normal days", () => {
  assert.match(
    normalized,
    /from atlas\.presented_work_rows_unfiltered_v1\(p_farm_id,p_membership_id,v_work_date\) row join atlas\.tasks task on task\.id=row\.task_id[\s\S]*where task\.visibility_scope<>'system_internal'/,
  );
});

test("Sunday worker override cannot surface a system-internal task", () => {
  const occurrences = migration.match(/task\.visibility_scope<>'system_internal'/g) ?? [];
  assert.ok(occurrences.length >= 2, "normal and Sunday worker paths must both enforce the internal-task boundary");
  assert.match(migration, /owner_sunday_override/);
});

test("the boundary is server-side presentation policy and preserves existing RPC grants", () => {
  assert.match(migration, /create or replace function atlas\.presented_work_rows_v1/);
  assert.match(migration, /security definer/);
  assert.doesNotMatch(migration, /\bgrant\s+execute\b/i);
  assert.doesNotMatch(migration, /\brevoke\s+all\s+on\s+function\b/i);
  assert.doesNotMatch(migration, /Fall cabbage mix/);
  assert.doesNotMatch(migration, /Fall onion mix/);
});
