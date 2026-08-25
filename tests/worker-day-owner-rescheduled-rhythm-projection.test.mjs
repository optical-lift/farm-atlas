import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/atlas/worker-day-sequence-server.ts", import.meta.url), "utf8");

test("Worker Day suppresses a rhythm preview when the owner has already scheduled that rhythm task on this or a later date", () => {
  assert.match(source, /reconcileOwnerRescheduledRhythmProjections/);
  assert.match(source, /item\.sourceKind === "rhythm"/);
  assert.match(source, /metadata\.rhythm_rule_id/);
  assert.match(source, /metadata\.owner_rescheduled_to/);
  assert.match(source, /ownerRescheduledTo !== row\.due_date/);
  assert.match(source, /\.in\("status", \["open", "blocked"\]\)/);
  assert.match(source, /\.gte\("due_date", dateIso\)/);
  assert.match(source, /automaticWork: plan\.automaticWork\.filter|const automaticWork = plan\.automaticWork\.filter/);
});

test("Owner and Farm Hand projections share the same reschedule reconciliation", () => {
  assert.match(source, /const plan = await reconcileOwnerRescheduledRhythmProjections\(dateIso, planResult\.plan\)/);
  assert.match(source, /const plan = await reconcileOwnerRescheduledRhythmProjections\(dateIso, bundleRead\.value\.plan\)/);
  assert.match(source, /remainingPaidMinutes: Math\.max\(plan\.paidTargetMinutes - plan\.committedPaidMinutes - automaticPaidMinutes, 0\)/);
});
