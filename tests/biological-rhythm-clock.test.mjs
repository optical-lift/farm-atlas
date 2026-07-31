import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const core = read("supabase/migrations/20260731021000_biological_grow_room_germination_clock_v1.sql");
const reconciliation = read("supabase/migrations/20260731021500_biological_clock_append_only_reconciliation_v1.sql");
const governance = read("supabase/migrations/20260731022000_biological_rhythm_owner_revision_and_audit_v1.sql");
const resultRoute = read("app/api/atlas/germination-check/route.ts");
const controlRoute = read("app/api/atlas/rhythms/control/route.ts");
const manager = read("app/manage/rhythms/BiologicalRhythmManager.tsx");
const page = read("app/manage/rhythms/page.tsx");
const more = read("app/more/page.tsx");

test("Grow Room care and germination use the governed Rulebook and Clock", () => {
  assert.match(core, /'grow_room_care'/);
  assert.match(core, /'germination_watch'/);
  assert.match(core, /elm_grow_room_care_daily/);
  assert.match(core, /elm_germination_observation_daily/);
  assert.match(core, /ensure_rhythm_task_v1|failure_consequence/);
  assert.match(core, /crop_cycles_sync_germination_watch_v1/);
  assert.match(core, /task_crop_cycles_sync_germination_watch_v1/);
  assert.match(core, /grow_room_seed_shelves/);
});

test("time opens work but never claims a physical crop or care condition", () => {
  assert.match(core, /timeClaimsPhysicalCondition',false/);
  assert.match(core, /physicalConditionClaimed',false/);
  assert.match(core, /physicalObservationRecorded',true/);
  assert.match(core, /germination_observed:not_yet/);
  assert.match(core, /germination_observed:beginning/);
  assert.match(core, /germination_observed:germinated/);
  assert.doesNotMatch(core, /sourceEvent','rescheduled'.*effect','full'/s);
});

test("only genuinely sown crops enter germination watch and stale projections reconcile append-only", () => {
  assert.match(core, /cc\.sown_date is not null/);
  assert.match(core, /cycle_state in \('sown','germinating','germination_pending','emerging'\)/);
  assert.match(reconciliation, /on conflict \(farm_id,satisfaction_key\) do nothing/);
  assert.match(reconciliation, /expected_germination_start>=v_cycle\.sown_date/);
  assert.match(reconciliation, /v_cycle\.sown_date\+v_profile_min_days/);
  assert.doesNotMatch(reconciliation, /rhythm_satisfactions\.evidence \|\| excluded\.evidence/);
});

test("germination result grammar advances biology or returns uncertainty to the Owner", () => {
  for (const action of ["not_yet", "beginning", "germinated", "failed_or_uncertain", "problem_found"]) {
    assert.match(resultRoute, new RegExp(`"${action}"`));
  }
  assert.match(core, /cycle_state='emerging'/);
  assert.match(core, /worker_open_task_problem_handoff_v1/);
  assert.match(governance, /operator-biological-handoff/);
  assert.match(governance, /record_task_transition_v1/);
});

test("Owner controls explain, pause, extend, forgive, and version biological rules", () => {
  assert.match(page, /biological_rhythm_dashboard_v1/);
  assert.match(page, /It never uses time alone to claim what is physically happening/);
  assert.match(controlRoute, /owner_control_biological_rhythm_v1/);
  assert.match(controlRoute, /owner_revise_biological_rhythm_rule_v1/);
  assert.match(governance, /create_rhythm_rule_version_v1/);
  assert.match(governance, /owner_rule_revision/);
  assert.match(manager, /Extend 1 day/);
  assert.match(manager, /Forgive \+ restart/);
  assert.match(manager, /Pause this rule/);
  assert.match(manager, /Revise cadence/);
  assert.match(manager, /Owner reason/);
  assert.match(more, /Rulebook \+ Clock/);
});

test("biological controls remain Owner-only and same-origin", () => {
  assert.match(page, /membership\.role === "owner"/);
  assert.match(controlRoute, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(controlRoute, /membership\.role === "owner"/);
  assert.doesNotMatch(controlRoute, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  assert.match(core, /Only a farm Owner may control biological rhythms/);
});
