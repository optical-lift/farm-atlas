import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const policy = read(
  "supabase/migrations/20260729070000_weeding_rhythm_pilot_policy_v1.sql",
);
const enrollment = read(
  "supabase/migrations/20260729070100_weeding_rhythm_pilot_enrollment_v1.sql",
);
const initialReader = read(
  "supabase/migrations/20260729070200_weeding_rhythm_pilot_reader_v1.sql",
);
const reader = read(
  "supabase/migrations/20260729070300_weeding_pilot_physical_condition_truth_v1.sql",
);
const taskIdentity = read(
  "supabase/migrations/20260729070400_rhythm_task_escalation_identity_v1.sql",
);
const contract = read("lib/atlas/weeding-rhythm-pilot-contract.ts");
const sql = `${policy}\n${enrollment}\n${initialReader}\n${reader}\n${taskIdentity}`;

test("the approved pilot is exactly FR8, FR15, and North Redbud Island", () => {
  assert.match(policy, /'fr_8'::text/);
  assert.match(policy, /'fr_15'::text/);
  assert.match(policy, /'redbud_island_right'::text/);
  assert.match(policy, /elm_weeding_fr8_subject/);
  assert.match(policy, /elm_weeding_fr15_subject/);
  assert.match(policy, /elm_weeding_north_redbud_subject/);
  assert.match(contract, /"fr_8" \| "fr_15" \| "redbud_island_right"/);
});

test("production and ornamental timings match the Owner-approved defaults", () => {
  assert.match(policy, /1512000/); // 17.5 days
  assert.match(policy, /259200/); // 3-day warning
  assert.match(policy, /172800/); // 2-day grace
  assert.match(policy, /3888000/); // 45 days
  assert.match(policy, /604800/); // 7-day warning/grace or inspection extension
  assert.match(policy, /1209600/); // 14-day ornamental inspection extension
  assert.match(policy, /fast_production_soil/);
  assert.match(policy, /mulched_ornamental/);
});

test("full work renews, inspection extends, and partial work only recovers", () => {
  assert.match(policy, /'effect', 'full'/);
  assert.match(policy, /'effect', 'conditional'/);
  assert.match(policy, /'effect', 'partial'/);
  assert.match(policy, /weed:fully_completed/);
  assert.match(policy, /weed:partially_completed/);
  assert.match(policy, /weed_inspection_acceptable/);
  assert.match(policy, /then 'mulch' else 'cultivate'/);
  assert.match(policy, /action:cultivate/);
  assert.match(policy, /action:mulch/);
});

test("failure releases explicit restoration work and preserves the approved scope", () => {
  assert.match(policy, /Restore Field Row 8/);
  assert.match(policy, /Restore Field Row 15/);
  assert.match(policy, /Restore North Redbud Island/);
  assert.match(policy, /\["bed_prep","sow","direct_sow","plant","transplant","succession"\]/);
  assert.match(policy, /'\[\]'::jsonb/);
  assert.match(policy, /unrelated crop production/);
  assert.match(policy, /'physicalConditionClaim', 'unknown_until_observed'/);
});

test("due and failure preserve one occurrence and one canonical task identity", () => {
  assert.match(taskIdentity, /rename to ensure_rhythm_task_v1_base/);
  assert.match(taskIdentity, /v_state\.current_task_id/);
  assert.match(taskIdentity, /v_state\.current_occurrence_id/);
  assert.match(taskIdentity, /'rhythm_task_identity_preserved', true/);
  assert.match(taskIdentity, /'escalated_current_task'/);
  assert.match(taskIdentity, /'updated_current_occurrence_awaiting_capacity'/);
  assert.match(taskIdentity, /title = v_template ->> 'title'/);
  assert.match(taskIdentity, /priority = coalesce\(nullif\(v_template ->> 'priority'/);
  assert.match(taskIdentity, /return atlas\.ensure_rhythm_task_v1_base/);
});

test("notification routing records the approved Bell and push policy without inventing delivery", () => {
  assert.match(policy, /'warning', jsonb_build_object\('bell', true, 'push', false/);
  assert.match(policy, /'due', jsonb_build_object\('bell', true, 'push', true/);
  assert.match(policy, /'failure', jsonb_build_object\('bell', true, 'push', true/);
  assert.match(policy, /assigned_farm_hand','owner'/);
  assert.match(policy, /direct_calm_restorative/);
  assert.doesNotMatch(sql, /insert into atlas\.(bell|push|notification)/i);
});

test("existing canonical completion memory starts each lease instead of migration time", () => {
  assert.match(enrollment, /maintenance\.last_completed_at/);
  assert.match(enrollment, /owner_approved_existing_completion/);
  assert.match(enrollment, /usesMigrationTimeAsSatisfaction', false/);
  assert.match(enrollment, /physicalConditionAtEnrollment', 'not_inferred'/);
  assert.match(enrollment, /satisfaction_kind[\s\S]*'game_master'/);
  assert.match(enrollment, /evaluate_rhythm_binding_v1/);
});

test("pilot subjects leave generic recurrence and expose an explainable prepared reader", () => {
  assert.match(policy, /set active = false/);
  assert.match(policy, /source_kind = 'maintenance_weeding_collection'/);
  assert.match(policy, /Replaced by Owner-authored Clock governance/);
  assert.match(reader, /create or replace function atlas\.weeding_rhythm_pilot_v1/);
  assert.match(reader, /owner_authored_rulebook_clock/);
  assert.match(reader, /latest_qualifying_satisfaction_plus_owner_interval/);
  assert.match(reader, /generic_recurrence/);
  assert.match(reader, /unobserved_physical_condition/);
  assert.match(reader, /atlas\.can_read_rhythm_state_v1/);
  assert.match(reader, /grant execute on function atlas\.weeding_rhythm_pilot_v1\(uuid\) to authenticated/);
});

test("legacy condition defaults remain unknown until a dated observation exists", () => {
  assert.match(reader, /'known', maintenance\.condition_reported_at is not null/);
  assert.match(reader, /case when maintenance\.condition_reported_at is not null then maintenance\.condition else null end/);
  assert.match(reader, /case when maintenance\.condition_reported_at is not null then maintenance\.estimate_source else null end/);
  assert.match(reader, /'inferredFromClock', false/);
  assert.match(contract, /known: boolean/);
});

test("Build 4 does not alter the visual shell", () => {
  assert.doesNotMatch(sql, /\.css|className|style=/);
  assert.doesNotMatch(contract, /\.css|className|style=/);
});
