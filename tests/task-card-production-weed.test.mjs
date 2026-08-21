import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const detail = read("components/atlas/weed-card-task-focus.tsx");
const styles = read("components/atlas/weed-card-task-focus.module.css");
const contract = read("lib/atlas/weed-card-contract.ts");
const migration = read("supabase/migrations/20260821172800_weed_card_bed_truth_and_trail_v1.sql");

test("Weed header describes the bed's present use and actual last-weeding date", () => {
  assert.match(detail, /familyDetail=\{card\.bedUseCategory\}/);
  assert.match(detail, /Last weeded · \$\{prettyDate\(card\.lastWeededOn\)/);
  assert.match(migration, /'lastWeededOn',v_last_weeded_on/);
  assert.match(migration, /v_state\.last_weeded_at at time zone 'America\/Chicago'/);
});

test("Weed Bed Now reports the newest physical bed observation rather than a target", () => {
  assert.match(detail, /Last logged as \{ATLAS_WEED_CONDITION_LABELS\[card\.lastLoggedCondition\]\}/);
  assert.match(detail, /card\.lastLoggedOn/);
  assert.doesNotMatch(detail, /Target ·|targetCondition/);
  assert.match(migration, /v_latest_session\.work_date >= v_state_logged_on/);
  assert.match(migration, /v_last_logged_on := v_state_logged_on/);
  assert.match(migration, /v_last_logged_condition := coalesce\(v_state_condition/);
});

test("Weed Trail follows completed bed and crop work and can prioritize perennials or an owner-selected crop", () => {
  assert.match(detail, /card\.bedTrail\.map/);
  assert.match(migration, /from atlas\.task_objects x/);
  assert.match(migration, /x\.object_id=v_object\.id/);
  assert.match(migration, /t\.status='done'/);
  assert.match(migration, /weed_trail_primary_crop_cycle_id/);
  assert.match(migration, /life_cycle.*perennial/s);
  assert.doesNotMatch(migration, /'cropLabel',coalesce\(r\.crop_label,nullif\(v_task\.metadata->>'display_subject'/);
});

test("Active Crops uses lifecycle rows and exposes stale germination truth for field confirmation", () => {
  assert.match(detail, />Active Crops</);
  assert.match(detail, /titleCase\(cohort\.lifeCycle\)/);
  assert.match(detail, /Needs field confirmation/);
  assert.match(detail, /Last observed \{cohort\.stageLabel\}/);
  assert.match(detail, /daysBetween\(observedOrEstablished, todayIso\(\)\) > 21/);
  assert.match(detail, /lifecycleRank\(a\.lifeCycle\) - lifecycleRank\(b\.lifeCycle\)/);
  assert.match(styles, /\.cropRows/);
  assert.match(styles, /\.cropRow/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(112px, 0\.78fr\)/);
});

test("Weed result controls are deliberately small and the card cannot be moved by the worker", () => {
  assert.match(detail, /Still rough/);
  assert.match(detail, /Mostly clear/);
  assert.match(detail, /Log it/);
  assert.match(detail, /All clear/);
  assert.doesNotMatch(detail, /Move this card/);
  assert.doesNotMatch(detail, /postAtlasTaskSetAsideToday/);
  assert.doesNotMatch(detail, /Medium pressure|Crop readable|Done weeding today/);
});

test("Weed language collapses raw pressure states into worker-meaningful states", () => {
  assert.match(contract, /heavy: "Still rough"/);
  assert.match(contract, /medium_pressure: "Still rough"/);
  assert.match(contract, /row_readable: "Mostly clear"/);
  assert.match(contract, /mostly_clear: "Mostly clear"/);
  assert.match(contract, /clear: "Clear"/);
});

test("Weed bed-use inference avoids brittle JSON boolean casts", () => {
  assert.match(migration, /perennial_zone',''\)\) in \('true','1','yes','y'\)/);
  assert.match(migration, /landscape_strip',''\)\) in \('true','1','yes','y'\)/);
  assert.doesNotMatch(migration, /perennial_zone'\)::boolean/);
  assert.doesNotMatch(migration, /landscape_strip'\)::boolean/);
});
