import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("transplant readiness uses the universal assigned-task shell", () => {
  const detail = read("components/atlas/transplant-readiness-task-detail.tsx");

  assert.match(detail, /AssignedTaskExecutionShell/);
  assert.match(detail, /resultInstrument=\{\(context\) => <TransplantReadinessInstrument context=\{context\} \/>\}/);
  assert.match(detail, /data-atlas-result-instrument="transplant-readiness"/);
  assert.doesNotMatch(detail, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(detail, /createPortal|MutationObserver|document\.querySelector/);
  assert.doesNotMatch(detail, /<main\b/);
});

test("the transplant instrument owns only the crop-result interaction", () => {
  const detail = read("components/atlas/transplant-readiness-task-detail.tsx");

  assert.match(detail, /\/api\/atlas\/transplant-readiness/);
  assert.match(detail, /action: "ready" \| "failed"/);
  assert.match(detail, /readyCount: action === "failed" \? 0 : parsedCount/);
  assert.match(detail, /transplant_ready_seedlings/);
  assert.match(detail, /transplant_readiness_status/);
  assert.match(detail, /Save ready count/);
  assert.match(detail, /All seedlings lost/);
  assert.match(detail, /window\.location\.assign\(context\.returnHref\)/);
  assert.doesNotMatch(detail, /TaskExecutionBrief|TaskPrimaryResultControls|postAtlasTaskTransition/);
});

test("transplant readiness keeps its authenticated server result path", () => {
  const route = read("app/api/atlas/transplant-readiness/route.ts");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /worker_record_transplant_readiness_v1/);
  assert.match(route, /owner_operator_record_transplant_readiness_v1/);
  assert.match(route, /ACTIONS = new Set\(\["ready", "failed"\]\)/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|createClient\([^)]*service/i);
});
