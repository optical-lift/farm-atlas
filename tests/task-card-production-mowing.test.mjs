import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const adapter = read("components/atlas/mow-card-task-detail.tsx");
const focus = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
const body = read("components/atlas/mowing-task-card-body.tsx");
const model = read("lib/atlas/mowing-card-view-model.ts");
const route = read("app/api/atlas/mowing/route.ts");

test("ordinary mowing tasks route into the production Mow card family", () => {
  assert.match(canonical, /task\.task_type === "mowing"/);
  assert.match(canonical, /MowCardTaskDetail/);
  assert.match(adapter, /MowingFocusPage/);
  assert.match(adapter, /task\.resource_requirements/);
  assert.match(adapter, /metadata\?\.target_cut_height_inches/);
  assert.match(adapter, /metadata\?\.equipment_group/);
});

test("Mow card preserves the Task Card Editor recurrence, height, and equipment grammar with live values", () => {
  assert.match(body, /Mowed/);
  assert.match(body, /Next mow/);
  assert.match(body, /Mow height/);
  assert.match(body, /resourceLabel/);
  assert.match(body, /resourceStatus/);
  assert.match(model, /targetCutHeightInches/);
  assert.match(model, /equipmentGroup/);
  assert.match(model, /Battery-powered push mower/);
  assert.match(model, /Riding mower/);
  assert.doesNotMatch(body, />3 in</);
});

test("Mow equipment plus drawer reports through the canonical mowing result contract", () => {
  assert.match(focus, /Won't start/);
  assert.match(focus, /Needs gas/);
  assert.match(focus, /Battery problem/);
  assert.match(focus, /Battery missing/);
  assert.match(body, /Log an issue with/);
  assert.match(body, /Report problem/);
  assert.match(focus, /equipment_or_area_problem/);
  assert.match(focus, /\/api\/atlas\/mowing/);
  assert.match(route, /record_mowing_result_for_member_v1/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
});

test("Mow focus uses the global Atlas shell instead of keeping a private Atlas Work header", () => {
  assert.doesNotMatch(focus, /import Link from "next\/link"/);
  assert.doesNotMatch(focus, /className=\{styles\.top\}/);
  assert.doesNotMatch(focus, /className=\{styles\.close\}/);
});

test("Mow completion remains gated by canonical execution readiness", () => {
  assert.match(focus, /task-execution-readiness/);
  assert.match(focus, /const taskReady = readiness\?\.ok === true && readiness\.executable === true/);
  assert.match(focus, /const completion = taskReady \?/);
  assert.match(focus, /issueDisabled=\{!taskReady \|\| saving\}/);
});
