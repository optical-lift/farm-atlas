import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(
  join(root, "app/api/atlas/company-work/route.ts"),
  "utf8",
);

test("Company Work reads through organization identity, not farm task identity", () => {
  assert.match(route, /membershipForOrganization/);
  assert.match(route, /activeOrganizationId/);
  assert.match(route, /company_work_position_api_v1/);
  assert.doesNotMatch(route, /farmId|workerKey|home_task|worker_day|atlas\.tasks|taskCards/);
});

test("Company Work route never uses the service-role client or legacy fallback", () => {
  assert.match(route, /createAtlasServerClient/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase|createClient\([^)]*service/i);
  assert.doesNotMatch(route, /fallback|legacy task|home-task-cards|task-transition/);
});

test("Company Work is owner-bounded until finer institutional authorization exists", () => {
  assert.match(route, /membership\.role !== "owner"/);
  assert.match(route, /Company Work currently requires organization-owner access/);
});

test("missing database kernel fails closed without disturbing visible Atlas", () => {
  assert.match(route, /company_work_kernel_not_live/);
  assert.match(route, /503/);
  assert.match(route, /Company Work is not live in this database yet/);
});
