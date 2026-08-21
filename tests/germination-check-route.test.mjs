import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("germination cards record biological observations in the selected worker context", () => {
  const route = read("app/api/atlas/germination-check/route.ts");
  const focus = read("app/task-focus/[taskId]/GerminationFocusPage.tsx");
  const originalOperatorMigration = read("supabase/migrations/20260729192345_atlas_owner_operator_worker_parity_and_germination.sql");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /owner_operator_germination_check_source_v1/);
  assert.match(route, /owner_operator_record_germination_observation_v2/);
  assert.match(route, /record_germination_observation_for_member_v2/);
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
  assert.match(focus, /choice === "Failed"[\s\S]*action: "failed_or_uncertain"/);
  assert.match(focus, /return \{ action: "not_yet" \}/);
  assert.match(focus, /Failed: "Owner review"/);
  assert.match(focus, /completion=\{completion\}/);
  assert.doesNotMatch(focus, /TaskPrimaryResultControls/);
  assert.doesNotMatch(focus, /"Beginning"/);
  assert.doesNotMatch(focus, /Send to Owner/);
  assert.doesNotMatch(focus, /Atlas advanced the crop/);

  assert.match(originalOperatorMigration, /owner_operator_record_germination_check_v1/);
  assert.match(originalOperatorMigration, /effective_membership_id/);
  assert.match(originalOperatorMigration, /actor_membership_id/);
  assert.match(originalOperatorMigration, /task\.visibility_scope = 'management'/);
  assert.match(originalOperatorMigration, /grant execute[\s\S]*to authenticated/i);
});
