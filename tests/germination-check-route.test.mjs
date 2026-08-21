import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("germination cards record biological observations in the selected worker context", () => {
  const route = read("app/api/atlas/germination-check/route.ts");
  const focus = read("app/task-focus/[taskId]/GerminationFocusPage.tsx");
  const failureMigration = read("supabase/migrations/20260821012614_germination_failure_releases_bed_for_crop_decision_v1.sql");
  const patchyMigration = read("supabase/migrations/20260821031258_germination_patchy_observation_consequence_split_v1.sql");
  const originalOperatorMigration = read("supabase/migrations/20260729192345_atlas_owner_operator_worker_parity_and_germination.sql");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /owner_operator_germination_check_source_v1/);
  assert.match(route, /owner_operator_record_germination_observation_v4/);
  assert.match(route, /record_germination_observation_for_member_v4/);
  assert.match(route, /standCondition/);
  assert.match(route, /observedGapInches/);
  assert.match(route, /"failed"/);
  assert.match(route, /"beginning"/);
  assert.match(route, /"failed_or_uncertain"/);
  assert.match(route, /"problem_found"/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /effectiveMembershipId/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);

  assert.match(focus, /AtlasTaskCardFrame/);
  assert.match(focus, /CropCycleTaskCardBody/);
  assert.match(focus, /"Strong"/);
  assert.match(focus, /"Patchy"/);
  assert.match(focus, /"Failed"/);
  assert.match(focus, /"Too early to tell"/);
  assert.match(focus, /choice === "Strong"[\s\S]*action: "germinated", spacingOutcome: "on_target"/);
  assert.match(focus, /choice === "Patchy"[\s\S]*action: "germinated", spacingOutcome: "patch"/);
  assert.match(focus, /choice === "Failed"[\s\S]*action: "failed"/);
  assert.match(focus, /return \{ action: "not_yet" \}/);
  assert.match(focus, /choice === "Failed"\) return "Bed open · choose next crop"/);
  assert.match(focus, /choice !== "Failed"/);
  assert.match(focus, /Planting failed/);
  assert.match(focus, /Bed open · crop decision needed/);
  assert.match(focus, /completion=\{completion\}/);
  assert.doesNotMatch(focus, /choice === "Failed"[\s\S]{0,120}failed_or_uncertain/);
  assert.doesNotMatch(focus, /Failed: "Owner review"/);
  assert.doesNotMatch(focus, /TaskPrimaryResultControls/);
  assert.doesNotMatch(focus, /"Beginning"/);
  assert.doesNotMatch(focus, /Send to Owner/);
  assert.doesNotMatch(focus, /Atlas advanced the crop/);

  assert.match(patchyMigration, /germination_target_spacing_for_task_v1/);
  assert.match(patchyMigration, /germination_observation','patchy'/);
  assert.match(patchyMigration, /stand_condition','patchy'/);
  assert.match(patchyMigration, /p_observed_gap_inches >= v_target\*3/);
  assert.match(patchyMigration, /management_consequence/);
  assert.match(patchyMigration, /patch_required/);
  assert.match(patchyMigration, /released_idempotency_key/);
  assert.match(patchyMigration, /record_germination_observation_for_member_v4/);
  assert.match(patchyMigration, /owner_operator_record_germination_observation_v4/);
  assert.match(patchyMigration, /grant execute[\s\S]*to authenticated, service_role/i);

  assert.match(failureMigration, /record_failed_germination_core_v1/);
  assert.match(failureMigration, /cycle_state='failed'/);
  assert.match(failureMigration, /lifecycle_status='archived'/);
  assert.match(failureMigration, /available_for_new_sowing/);
  assert.match(failureMigration, /decision_required=true/);
  assert.match(failureMigration, /Choose next crop/);
  assert.match(failureMigration, /requires_owner_crop_decision/);
  assert.match(failureMigration, /no_auto_resow/);
  assert.doesNotMatch(failureMigration, /generated_from='germination_restart'|generated_from,'germination_restart'/);

  assert.match(originalOperatorMigration, /owner_operator_record_germination_check_v1/);
  assert.match(originalOperatorMigration, /effective_membership_id/);
  assert.match(originalOperatorMigration, /actor_membership_id/);
  assert.match(originalOperatorMigration, /task\.visibility_scope = 'management'/);
  assert.match(originalOperatorMigration, /grant execute[\s\S]*to authenticated/i);
});
