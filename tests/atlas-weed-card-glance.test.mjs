import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const focus = read("components/atlas/weed-card-task-focus.tsx");
const mapCss = read("components/atlas/crop-occupancy-bed-map.module.css");
const migration = read("supabase/migrations/20260804075000_weed_cards_require_physical_need_and_canonical_titles.sql");

test("the Weed field sheet says the complete canonical action and bed name", () => {
  assert.match(focus, /instruction=\{`Weed \$\{card\.objectLabel\}`\}/);
  assert.doesNotMatch(focus, /instruction="Weed"/);
  assert.match(migration, /NEW\.title := 'Weed ' \|\| v_object_label/);
  assert.match(migration, /'display_title', NEW\.title/);
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

test("Field Row 8 is repaired from current Owner-observed physical truth", () => {
  assert.match(migration, /object\.stable_key = 'fr_8'/);
  assert.match(migration, /'already weeded and clear'/);
  assert.match(migration, /SET status = 'skipped'/);
  assert.match(migration, /current_task_id = null/);
  assert.match(migration, /evaluate_rhythm_binding_v1/);
});
