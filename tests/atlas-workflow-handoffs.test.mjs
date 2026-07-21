import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const infrastructure = read("supabase/migrations/20260721214054_atlas_unified_workflow_handoffs.sql");
const dataMigration = read("supabase/migrations/20260721214203_atlas_migrate_task_handoffs_and_repair_lemon_basil.sql");
const coverageMigration = read("supabase/migrations/20260721214529_atlas_add_workflow_coverage_audit.sql");

test("workflow events bridge every Atlas operational source", () => {
  for (const source of [
    "task",
    "object",
    "maintenance",
    "crop_cycle",
    "production_succession",
    "field_log",
  ]) {
    assert.match(infrastructure, new RegExp(`'${source}'`));
  }

  for (const emitter of [
    "emit_task_outcome_workflow_event_v1",
    "emit_object_activity_workflow_event_v1",
    "emit_maintenance_workflow_event_v1",
    "emit_field_log_workflow_event_v1",
    "emit_crop_cycle_workflow_event_v1",
    "emit_production_succession_workflow_event_v1",
  ]) {
    assert.match(infrastructure, new RegExp(emitter));
  }
});

test("handoffs may open or schedule downstream work but never complete it", () => {
  assert.match(infrastructure, /effect in \('open_task','schedule_task','record_only'\)/);
  assert.match(infrastructure, /record_task_transition_v1_internal/);
  assert.match(infrastructure, /'rescheduled'/);
  assert.doesNotMatch(infrastructure, /complete_task/);
  assert.match(dataMigration, /Handoffs never silently complete target tasks/);
});

test("downstream work cannot be represented as checklist children", () => {
  assert.match(infrastructure, /guard_downstream_task_not_checklist_child_v1/);
  assert.match(infrastructure, /Downstream workflow tasks cannot use parent_task_id/);
  assert.match(infrastructure, /new\.parent_task_id is not null/);
  assert.match(infrastructure, /'task_follow_up'/);
  assert.match(infrastructure, /'relationship_kind', 'downstream'/);
});

test("known farm chains are migrated through readiness-aware handoffs", () => {
  for (const stableKey of [
    "clear-fr9-to-sow-fr9",
    "clear-fr10-to-sow-fr10",
    "purchase-chantilly-to-start",
    "purchase-crane-kale-to-start",
    "grow-room-basil-readiness-to-transplant",
    "lemon-cuttings-to-root-check",
    "lemon-root-check-to-transplant",
    "chantilly-start-to-readiness",
    "chantilly-readiness-to-plant",
    "crane-kale-start-to-readiness",
    "crane-kale-readiness-to-plant",
  ]) {
    assert.match(dataMigration, new RegExp(stableKey));
  }

  assert.match(dataMigration, /Confirm lemon basil cuttings are rooted enough to plant/);
  assert.match(dataMigration, /workflow-repair:lemon-basil:reopen/);
  assert.match(dataMigration, /preserve_prior_history/);
});

test("coverage audit makes unmodeled sequential work visible", () => {
  assert.match(coverageMigration, /workflow_task_coverage_v1/);
  assert.match(coverageMigration, /generic_handoff_target/);
  assert.match(coverageMigration, /generic_handoff_source/);
  assert.match(coverageMigration, /specialized_engine/);
  assert.match(coverageMigration, /delayed_followup_engine/);
  assert.match(coverageMigration, /uncovered/);
  assert.match(coverageMigration, /invalid_parent_link/);
});
