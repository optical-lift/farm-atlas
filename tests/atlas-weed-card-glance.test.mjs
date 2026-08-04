import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const focus = read("components/atlas/weed-card-task-focus.tsx");
const mapCss = read("components/atlas/crop-occupancy-bed-map.module.css");
const migration = read("supabase/migrations/20260804075000_weed_cards_require_physical_need_and_canonical_titles.sql");
const rhythmMigration = read("supabase/migrations/20260804075100_weed_rhythm_requires_physical_need.sql");
const cleanupMigration = read("supabase/migrations/20260804075200_retire_existing_clear_weed_work.sql");

test("the Weed field sheet says the complete canonical action and bed name", () => {
  assert.match(focus, /instruction=\{`Weed \$\{card\.objectLabel\}`\}/);
  assert.doesNotMatch(focus, /instruction="Weed"/);
  assert.match(migration, /NEW\.title := 'Weed ' \|\| v_object_label/);
  assert.match(migration, /'display_title', NEW\.title/);
  assert.match(migration, /NEW\.generated_from = 'rhythm_clock'/);
  assert.match(migration, /FROM atlas\.task_objects linked/);
});

test("notebook bed maps show crop names instead of ellipsizing them", () => {
  assert.match(mapCss, /\.notebook \.row[\s\S]*white-space: normal/);
  assert.match(mapCss, /\.notebook \.row span,[\s\S]*overflow: visible/);
  assert.match(mapCss, /text-overflow: clip/);
  assert.match(mapCss, /overflow-wrap: anywhere/);
});

test("clear Weed Cards cannot be released as ordinary weeding", () => {
  assert.match(migration, /weed_card_allows_ordinary_work_v1/);
  assert.match(migration, /IF v_condition = 'clear' THEN[\s\S]*RETURN false/);
  assert.match(migration, /guard_care_strategy_weeding_occurrence_v1/);
  assert.match(migration, /guard_care_strategy_weeding_task_v1/);
});

test("the weed-stewardship Clock cannot turn elapsed time into a clear-bed task", () => {
  assert.match(rhythmMigration, /ALTER FUNCTION atlas\.ensure_rhythm_task_v1/);
  assert.match(rhythmMigration, /v_state\.rhythm_key = 'weed_stewardship'/);
  assert.match(rhythmMigration, /weed_card_allows_ordinary_work_v1/);
  assert.match(rhythmMigration, /'action', 'physical_weed_need_not_present'/);
  assert.match(rhythmMigration, /REVOKE ALL ON FUNCTION atlas\.ensure_rhythm_task_v1/);
  assert.match(rhythmMigration, /REVOKE ALL ON FUNCTION atlas\.ensure_rhythm_task_without_physical_gate_v1/);
  assert.match(rhythmMigration, /physical-need bypass is exposed to service_role/);
});

test("rhythm Weed occurrences also receive the canonical bed title", () => {
  assert.match(migration, /NEW\.source_kind = 'rhythm_state'/);
  assert.match(migration, /state\.rhythm_key = 'weed_stewardship'/);
  assert.match(migration, /NEW\.title := 'Weed ' \|\| v_object_label/);
});

test("Field Row 8 is repaired from current Owner-observed physical truth", () => {
  assert.match(migration, /object\.stable_key = 'fr_8'/);
  assert.match(migration, /'already weeded and clear'/);
  assert.match(migration, /SET status = 'skipped'/);
  assert.match(migration, /current_task_id = null/);
  assert.match(migration, /satisfaction_kind,[\s\S]*'full'/);
  assert.match(migration, /care_source_kind = 'observation'/);
  assert.match(migration, /evaluate_rhythm_binding_v1/);
});

test("already released ordinary Weed work is retired when the card is clear", () => {
  assert.match(cleanupMigration, /card\.current_condition = 'clear'/);
  assert.match(cleanupMigration, /directive\.status = 'active'/);
  assert.match(cleanupMigration, /set_config\('atlas\.reservoir_migration', 'on', true\)/);
  assert.match(cleanupMigration, /SET status = 'skipped'/);
  assert.match(cleanupMigration, /current_task_id = null/);
  assert.match(cleanupMigration, /A clear Weed Card still has ordinary active Weed work/);
});
