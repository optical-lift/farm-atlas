import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260815141000_harvest_flower_bucket_output_v1.sql");
const route = read("app/api/atlas/harvest-cut/route.ts");
const focus = read("app/task-focus/[taskId]/HarvestCutFocusPage.tsx");

test("flower harvest output has a canonical batch and append-only bucket ledger", () => {
  assert.match(migration, /create table atlas\.flower_harvest_batches/i);
  assert.match(migration, /create table atlas\.flower_harvest_bucket_observations/i);
  assert.match(migration, /flower_harvest_bucket_observations_append_only_v1/i);
  assert.match(migration, /quarter.*half.*three_quarters.*one.*more_than_one/is);
  assert.match(migration, /bucket_equivalent_floor/i);
  assert.match(migration, /more_than_one' and bucket_equivalent_floor=1\.00/i);
  assert.match(migration, /harvested physical truth, not saleable inventory/i);
});

test("bucket tables are membership-readable but not directly writable by authenticated clients", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /using \(atlas\.is_farm_member\(farm_id\)\)/i);
  assert.match(migration, /revoke all on atlas\.flower_harvest_batches from public, anon, authenticated/i);
  assert.match(migration, /revoke all on atlas\.flower_harvest_bucket_observations from public, anon, authenticated/i);
  assert.match(migration, /grant select on atlas\.flower_harvest_batches to authenticated/i);
  assert.match(migration, /grant select on atlas\.flower_harvest_bucket_observations to authenticated/i);
});

test("canonical harvest write preserves task and crop-cycle transition machinery", () => {
  assert.match(migration, /record_flower_harvest_output_core_v1/i);
  assert.match(migration, /record_flower_harvest_output_for_member_v1/i);
  assert.match(migration, /owner_operator_record_flower_harvest_output_v1/i);
  assert.match(migration, /record_task_transition_v1_internal/i);
  assert.match(migration, /enroll_harvest_watch_v1/i);
  assert.match(migration, /current_harvest_task_id=null/i);
  assert.match(migration, /cycle_state=case when p_more_available then 'harvest_watch' else 'finished_harvest'/i);
  assert.match(migration, /'physicalOutputMode','bucket_scale'/i);
});

test("released harvest work asks for physical bucket output rather than a stem count", () => {
  assert.match(migration, /v_title:='Harvest — '/i);
  assert.match(migration, /Record the flower output at bucket scale/i);
  assert.match(migration, /Do not stop to count stems/i);
  assert.match(migration, /'display_action','Harvest'/i);
  assert.match(migration, /'display_detail','Record physical output'/i);
  assert.doesNotMatch(focus, /Harvest \+ Count/);
});

test("harvest API writes bucket bands through membership-scoped RPCs", () => {
  assert.match(route, /flower-harvest-output-v1/);
  assert.match(route, /owner_operator_record_flower_harvest_output_v1/);
  assert.match(route, /record_flower_harvest_output_for_member_v1/);
  assert.match(route, /p_bucket_band/);
  assert.doesNotMatch(route, /marketableQuantity|secondsQuantity|discardedQuantity/);
});

test("worker harvest focus uses five bucket-scale choices and does not ask for accounting precision", () => {
  for (const label of ["¼ bucket", "½ bucket", "¾ bucket", "1 bucket", "1+ bucket"]) {
    assert.match(focus, new RegExp(label.replace(/[+]/g, "\\+")));
  }
  assert.match(focus, /Use the bucket scale\. Don’t stop to count stems\./);
  assert.match(focus, /This records physical harvest, not finished saleable inventory\./);
  assert.doesNotMatch(focus, />Marketable<|>Seconds<|>Discarded<|value="stems"/);
});
