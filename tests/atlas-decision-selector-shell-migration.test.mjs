import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("decision selector is a result instrument inside the universal assigned-task shell", () => {
  const source = read("components/atlas/decision-selector-task-detail.tsx");

  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /AssignedTaskResultInstrumentContext/);
  assert.match(source, /data-atlas-result-instrument="decision-selector"/);
  assert.match(source, /return <AssignedTaskExecutionShell \{\.\.\.props\} resultInstrument=\{resultInstrument\} \/>/);
  assert.match(source, /\/api\/atlas\/task-decision/);
});

test("decision selector no longer owns page chrome, weather, or Dominion execution", () => {
  const source = read("components/atlas/decision-selector-task-detail.tsx");

  assert.doesNotMatch(source, /TaskDominionTrail/);
  assert.doesNotMatch(source, /atlas-phone-shell/);
  assert.doesNotMatch(source, /\/api\/atlas\/weather/);
  assert.doesNotMatch(source, /import Link from "next\/link"/);
});

test("decision write path remains membership-scoped and server-authorized", () => {
  const route = read("app/api/atlas/task-decision/route.ts");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /readAtlasOwnerOperatorContext/);
  assert.match(route, /effectiveOperatorMembershipId/);
  assert.match(route, /\.schema\("atlas"\)/);
  assert.match(route, /resolve_task_decision_selector_v1/);
  assert.match(route, /x-atlas-intent/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
