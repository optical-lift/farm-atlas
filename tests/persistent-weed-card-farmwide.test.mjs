import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("every linked weed task is adopted by one place-owned Weed Card", () => {
  const core = read("supabase/migrations/20260729090500_persistent_weed_card_core_v1.sql");

  assert.match(core, /ensure_weed_card_for_object_v1/);
  assert.match(core, /on conflict \(object_id\) do update/);
  assert.match(core, /adopt_linked_weed_task_v1/);
  assert.match(core, /after insert or update of object_id on atlas\.task_objects/);
  assert.match(core, /after insert or update of title, action_key, task_type, status, metadata on atlas\.tasks/);
  assert.match(core, /weed_card_session_task', true/);
  assert.match(core, /persistent_weed_card', true/);
  assert.match(core, /plant_contents_source', 'object_contents'/);
  assert.match(core, /where mo\.maintenance_type = 'weed'/);
  assert.match(core, /having count\(distinct tx\.object_id\) = 1/);
});

test("future maintenance-weeding occurrences are enriched instead of creating standalone prose tasks", () => {
  const core = read("supabase/migrations/20260729090500_persistent_weed_card_core_v1.sql");

  assert.match(core, /create or replace function atlas\.enrich_weed_card_occurrence_v1/);
  assert.match(core, /new\.source_kind <> 'maintenance_weeding_collection'/);
  assert.match(core, /v_card_id := atlas\.ensure_weed_card_for_object_v1/);
  assert.match(core, /- 'display_detail'/);
  assert.match(core, /- 'display_instruction'/);
  assert.match(core, /- 'task_instruction'/);
  assert.match(core, /- 'current_move'/);
});

test("persistent Weed Card reader exposes only current canonical plants", () => {
  const reader = read("supabase/migrations/20260729090600_persistent_weed_card_reader_v1.sql");

  assert.match(reader, /from atlas\.object_contents oc/);
  assert.match(reader, /'plants', v_plants/);
  assert.match(reader, /distinct on \(lower\(raw\.display_label\)\)/);
  assert.match(reader, /btrim\(oc\.variety\) \|\| ' sunflower'/);
  assert.match(reader, /when lower\(oc\.content_label\) in \('bearded iris', 'iris'\) then 'Iris'/);
  assert.match(reader, /'planned', 'reserved'/);
  assert.doesNotMatch(reader, /next_crop_planned/);
});