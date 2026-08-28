import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

test("Direct Harvest owner task uses the approved post-harvest card", () => {
  const surface = read("components/atlas/direct-harvest-task-detail.tsx");
  const dispatcher = read("components/atlas/canonical-assigned-task-detail.tsx");
  assert.match(dispatcher, /flower_preparation_directive_review/);
  assert.match(dispatcher, /loadDirectHarvestContext/);
  assert.match(dispatcher, /DirectHarvestTaskDetail/);
  assert.match(surface, /title="Direct Harvest"/);
  assert.match(surface, /Harvest is in/);
  assert.match(surface, /Use what Anna actually logged/);
  assert.match(surface, />Orders</);
  assert.match(surface, /Set the pack-out target/);
  assert.match(surface, /Bunch/);
  assert.match(surface, /Bouquet/);
  assert.match(surface, /Posy/);
  assert.match(surface, /Arrangement/);
  assert.match(surface, /Stems \/ bunch/);
  assert.match(surface, />QTY</);
  assert.match(surface, /Note \(optional\)/);
  assert.doesNotMatch(surface, /\+ note/i);
  assert.match(surface, /Send to Anna/);
  assert.match(surface, /Nothing is released until you send this/);
});

test("Direct Harvest context combines Elm harvest and external custody without inventing stems", () => {
  const context = read("lib/atlas/direct-harvest-context.ts");
  assert.match(context, /flower_harvest_bucket_observations/);
  assert.match(context, /flower_external_intakes/);
  assert.match(context, /flower_external_intake_lines/);
  assert.match(context, /crop_profile_id/);
  assert.match(context, /bucket_halves/);
  assert.match(context, /external row/);
  assert.doesNotMatch(context, /bucketHalves \* 10/);
});

test("Send to Anna crosses only the immutable directive RPC boundary", () => {
  const route = read("app/api/atlas/flower-preparation-directive/route.ts");
  assert.match(route, /allowedRoles: \["owner", "manager"\]/);
  assert.match(route, /same-origin Atlas request/);
  assert.match(route, /record_flower_preparation_directive_v1/);
  assert.match(route, /FQ\/SP are harvest condition labels, not flower identity/);
  assert.doesNotMatch(route, /service_role/);
  assert.doesNotMatch(route, /record_task_transition/);
});
