import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/task-card-lab/page.tsx");
const specimen = read("app/owner/task-card-lab/MG11ReferencePolygonSpecimen.tsx");

test("Task Card Lab exposes the MG11 reference-polygon fixture", () => {
  assert.match(page, /MG11ReferencePolygonSpecimen/);
  assert.match(page, /id="task-card-mg11-reference"/);
  assert.match(page, />MG11 Map</);
  assert.match(specimen, /data-atlas-task-card-lab-fixture="mg11-reference-polygon"/);
  assert.match(specimen, /data-live-task-binding="none"/);
});

test("MG11 editor fixture stays disconnected from live task and farm-state paths", () => {
  assert.doesNotMatch(specimen, /fetch\s*\(/);
  assert.doesNotMatch(specimen, /\/api\/atlas\//);
  assert.doesNotMatch(specimen, /createAtlasServerClient/);
  assert.doesNotMatch(specimen, /supabase/i);
  assert.doesNotMatch(specimen, /taskId\s*[:=]/);
  assert.doesNotMatch(specimen, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("MG11 fixture preserves the owner reference sketch without inventing crop placement", () => {
  for (const bed of ["MG11", "MG1", "MG2", "MG4", "MG5", "MG7", "MG8", "MG10"]) {
    assert.match(specimen, new RegExp(`key: "${bed}"`));
  }
  for (const mark of ["12", "1:30", "3", "4:30", "6", "7:30", "9", "10:30"]) {
    assert.match(specimen, new RegExp(`label: "${mark.replace(":", "\\:")}"`));
  }
  assert.match(specimen, /Center/);
  assert.match(specimen, /Diamond \/<\/text>/);
  assert.match(specimen, /Clock Face/);
  assert.match(specimen, /MG11 is the wedge between the 10:30 and 12 o'clock walkways/);
  assert.match(specimen, /Placement not recorded in the reference sketch/);
  assert.match(specimen, /Do not guess/);
});
