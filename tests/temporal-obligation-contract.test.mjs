import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816013000_work_occurrence_temporal_contract_v1.sql"),
  "utf8",
);

test("durable obligations distinguish target, release, and lawful execution dates", () => {
  for (const column of [
    "earliest_lawful_date",
    "preferred_start_date",
    "preferred_end_date",
    "latest_lawful_date",
    "hard_finish_date",
    "miss_consequence",
    "temporal_contract_source",
  ]) {
    assert.match(migration, new RegExp(column));
  }

  assert.match(migration, /not_before_date[\s\S]*NOT the earliest lawful execution date/i);
  assert.match(migration, /planned_due_date[\s\S]*NOT automatically a latest-lawful date or hard finish deadline/i);
  assert.match(migration, /Never inferred merely from planned_due_date or tasks\.due_date/i);
  assert.match(migration, /Existing rows are intentionally NOT backfilled/i);
});

test("temporal legality stays tri-state when upstream lawful bounds are unknown", () => {
  assert.match(migration, /work_occurrence_temporal_contract_v1/i);
  assert.match(migration, /false = a known lawful bound is violated/i);
  assert.match(migration, /true  = both lower and upper bounds are known/i);
  assert.match(migration, /null  = the contract does not know enough/i);
  assert.match(migration, /'lawfulOnServiceDate',v_lawful/i);
  assert.match(migration, /'plannedDueDate',v_occurrence\.planned_due_date/i);
  assert.match(migration, /'releaseNotBeforeDate',v_occurrence\.not_before_date/i);
});

test("temporal contract writes require an explicit authoritative source", () => {
  assert.match(migration, /replace_work_occurrence_temporal_contract_v1/i);
  assert.match(migration, /A temporal contract source is required when lawful timing or miss consequence is supplied/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
});

test("Production date conflicts are surfaced rather than repaired by Clock", () => {
  assert.match(migration, /Source conflict reporting is observational only/i);
  assert.match(migration, /Clock is not allowed to repair them by changing dates/i);
  for (const code of [
    "production_window_starts_after_final_biological_date",
    "production_preferred_window_exceeds_final_biological_date",
    "production_late_window_exceeds_final_biological_date",
    "production_skip_boundary_exceeds_final_biological_date",
  ]) {
    assert.match(migration, new RegExp(code));
  }
});
