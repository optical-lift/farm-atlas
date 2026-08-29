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

test("the transplant instrument records production biology without breaking legacy readiness", () => {
  const detail = read("components/atlas/transplant-readiness-task-detail.tsx");

  assert.match(detail, /\/api\/atlas\/transplant-readiness/);
  assert.match(detail, /type ReadinessAction = "ready" \| "not_ready" \| "failed"/);
  assert.match(detail, /isProductionReadiness/);
  assert.match(detail, /production_lot_id/);
  assert.match(detail, /production_tray_batch_id/);
  assert.match(detail, /readyCount: action === "failed" \? 0 : parsedCount/);
  assert.match(detail, /trayCount: productionReadiness/);
  assert.match(detail, /nextCheckDate: productionReadiness && action === "not_ready"/);
  assert.match(detail, /Not ready yet/);
  assert.match(detail, /Ready to plant/);
  assert.match(detail, /All seedlings lost/);
  assert.match(detail, /transplant_ready_seedlings/);
  assert.match(detail, /transplant_readiness_status/);
  assert.match(detail, /window\.location\.assign\(context\.returnHref\)/);
  assert.doesNotMatch(detail, /TaskExecutionBrief|TaskPrimaryResultControls|postAtlasTaskTransition/);
});

test("transplant readiness keeps production and legacy authenticated server paths distinct", () => {
  const route = read("app/api/atlas/transplant-readiness/route.ts");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /ACTIONS = new Set\(\["ready", "not_ready", "failed"\]\)/);
  assert.match(route, /production_lot_tasks/);
  assert.match(route, /link_role", "transplant_readiness"/);
  assert.match(route, /worker_record_production_readiness_v1/);
  assert.match(route, /owner_record_production_readiness_v1/);
  assert.match(route, /owner_operator_record_production_readiness_v1/);
  assert.match(route, /worker_record_transplant_readiness_v1/);
  assert.match(route, /owner_operator_record_transplant_readiness_v1/);
  assert.match(route, /This older readiness card does not support a recheck result/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|createClient\([^)]*service/i);
});
