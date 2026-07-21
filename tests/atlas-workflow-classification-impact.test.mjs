import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const classification = read(
  "supabase/migrations/20260721230827_atlas_classify_workflow_handoffs.sql",
);
const impactAudit = read(
  "supabase/migrations/20260721230913_atlas_add_completion_impact_audit.sql",
);
const policyCoverage = read(
  "supabase/migrations/20260721231030_atlas_complete_completion_impact_policy_coverage.sql",
);

test("workflow handoffs use explicit guarded firing modes", () => {
  for (const mode of [
    "automatic",
    "date_window",
    "readiness_confirmed",
    "resource_confirmed",
    "owner_decision",
    "result_dependent",
    "recurring_condition",
  ]) {
    assert.match(classification, new RegExp(`'${mode}'`));
  }

  assert.match(classification, /validate_workflow_handoff_mode_v1/);
  assert.match(classification, /Date-window handoffs must schedule a task/);
  assert.match(classification, /Readiness-confirmed handoffs must originate/);
  assert.match(classification, /Resource-confirmed handoffs must originate/);
  assert.match(classification, /Owner-decision handoffs must originate/);
  assert.match(classification, /Result-dependent handoffs require a non-empty source_filter/);
});

test("purchase completion no longer claims seed is physically available", () => {
  assert.match(classification, /Confirm Chantilly White snapdragon seed is in hand/);
  assert.match(classification, /Confirm Crane White F1 ornamental kale seed is in hand/);
  assert.match(classification, /purchase-chantilly-to-arrival-check/);
  assert.match(classification, /purchase-crane-kale-to-arrival-check/);
  assert.match(classification, /Purchase completion starts a delivery window; it does not prove possession/);
  assert.match(classification, /Seed starting waits for explicit confirmation that seed is physically in hand/);
});

test("completion audit distinguishes records from real farm-state changes", () => {
  assert.match(impactAudit, /task_completion_impact_policies/);
  assert.match(impactAudit, /task_completion_impact_audit_v1/);
  assert.match(impactAudit, /task_completion_impact_summary_v1/);

  for (const stateImpact of [
    "object_event",
    "object_state",
    "maintenance",
    "crop_cycle",
    "planting_claim",
    "production_succession",
    "workflow_handoff",
    "next_task",
  ]) {
    assert.match(impactAudit, new RegExp(`'${stateImpact}'`));
  }

  for (const auditStatus of [
    "pass",
    "state_gap",
    "legacy_state_gap",
    "legacy_unstructured",
    "contextual_review",
    "record_gap",
    "unclassified",
  ]) {
    assert.match(impactAudit, new RegExp(`'${auditStatus}'`));
  }
});

test("biological and maintenance actions require appropriate state impacts", () => {
  assert.match(impactAudit, /Weeding must update the maintained object or maintenance history/);
  assert.match(impactAudit, /Mowing must update the maintained object or maintenance history/);
  assert.match(impactAudit, /Sowing must create or advance a crop record or production succession/);
  assert.match(impactAudit, /Planting must change the real bed or crop record/);
  assert.match(impactAudit, /A germination result must update the crop cycle or create the next response/);
  assert.match(impactAudit, /Harvest must update crop or object history/);
  assert.match(impactAudit, /Propagation must schedule or record the next biological stage/);
});

test("grow-room actions are classified instead of falling through the audit", () => {
  assert.match(policyCoverage, /'grow_room'/);
  assert.match(policyCoverage, /tray or crop stage/);
});
