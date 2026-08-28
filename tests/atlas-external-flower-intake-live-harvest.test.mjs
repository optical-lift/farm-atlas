import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Weekly Harvest exposes the approved External Intake interaction", () => {
  const surface = read("components/atlas/weekly-harvest-task-detail.tsx");

  assert.match(surface, /External intake/);
  assert.match(surface, /Add flowers that did not come from an Elm bed/);
  assert.match(surface, /\["Foraged", "Purchased", "Gifted"\]/);
  assert.match(surface, /\["Stems", "Buckets", "Bundles"\]/);
  assert.match(surface, /useState<IntakeSource \| null>\(null\)/);
  assert.match(surface, /const \[sourceLabel, setSourceLabel\] = useState\(""\)/);
  assert.match(surface, /const \[lines, setLines\] = useState<ExternalIntakeLine\[]>\(\[\]\)/);
  assert.match(surface, /Source \/ place/);
  assert.match(surface, /What came in\?/);
  assert.match(surface, />Flower</);
  assert.match(surface, />Color</);
  assert.match(surface, />Count by</);
  assert.match(surface, /\+ Add flower/);
  assert.match(surface, /line\.quantity > 0/);
  assert.match(surface, /className=\{styles\.intakeCounter\}/);
  assert.match(surface, /Add to harvest custody/);
  assert.match(surface, /\/api\/atlas\/external-flower-intake/);

  assert.doesNotMatch(surface, /Stem count/);
  assert.doesNotMatch(surface, /Condition of flowers/);
});

test("External Intake writes only through the governed custody RPC", () => {
  const route = read("app/api/atlas/external-flower-intake/route.ts");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /same-origin Atlas request/);
  assert.match(route, /external-flower-intake-v1/);
  assert.match(route, /owner_operator_record_external_flower_intake_v1/);
  assert.match(route, /record_external_flower_intake_for_member_v1/);
  assert.match(route, /FQ\/SP are condition labels, not flower identity/);
  assert.match(route, /COUNT_UNITS = new Set\(\["stem", "bucket", "bundle"\]\)/);

  assert.doesNotMatch(route, /record_flower_preparation/);
  assert.doesNotMatch(route, /record_flower_preparation_directive/);
  assert.doesNotMatch(route, /flower_ready_inventory/);
});
