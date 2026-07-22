import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function functionBody(source, functionName, nextFunctionName) {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const end = nextFunctionName
    ? source.indexOf(`export async function ${nextFunctionName}`, start + 1)
    : source.length;
  assert.notEqual(end, -1, `${nextFunctionName} must follow ${functionName}`);
  return source.slice(start, end);
}

test("shared operational readers require an active Atlas membership", () => {
  const routes = [
    "app/api/atlas/home-task-cards/route.ts",
    "app/api/atlas/task-cards/route.ts",
    "app/api/atlas/farm-snapshot/route.ts",
    "app/api/atlas/zone-registry/route.ts",
    "app/api/atlas/objects/[objectKey]/route.ts",
    "app/api/atlas/germination-history/route.ts",
    "app/api/atlas/closeout/route.ts",
  ];

  for (const routePath of routes) {
    const route = read(routePath);
    assert.match(route, /requireAtlasApiAccess\(\)/, `${routePath} must require active membership`);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|createClient\([^)]*service/i, `${routePath} must not bypass membership RLS`);
  }
});

test("Day, Week, and Month all use the canonical task-card reader", () => {
  for (const pagePath of [
    "app/day/page.tsx",
    "app/overview/week/page.tsx",
    "app/overview/month/page.tsx",
  ]) {
    const page = read(pagePath);
    assert.match(page, /fetchAtlasTaskCards/, `${pagePath} must use canonical task cards`);
  }

  const client = read("lib/atlas/task-cards-client.ts");
  assert.match(client, /\/api\/atlas\/home-task-cards/);
  assert.match(client, /\/api\/atlas\/task-cards/);
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /cache: "no-store"/);
});

test("Mowing and Weeding stay canonical shared collections", () => {
  const day = read("app/day/page.tsx");
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");
  const collections = read("lib/atlas/work-collections.ts");

  assert.match(day, /atlasBuildMowingCollectionSummary/);
  assert.match(day, /atlasBuildWeedingCollectionSummary/);
  assert.match(week, /atlasBuildMowingCollectionSummary/);
  assert.match(week, /atlasBuildWeedingCollectionSummary/);
  assert.match(month, /atlasBuildMowingCollectionSummary/);
  assert.match(collections, /mowing: "\/collections\/mowing"/);
  assert.match(collections, /weeding: "\/collections\/weeding"/);
  assert.match(collections, /atlasVisibleCollectionTasks/);
});

test("production is shared for reading and Owner-only for mutation", () => {
  for (const routePath of [
    "app/api/atlas/production-plans/route.ts",
    "app/api/atlas/production-dashboard/route.ts",
  ]) {
    const route = read(routePath);
    const getBody = functionBody(route, "GET", "PATCH");
    const patchBody = functionBody(route, "PATCH");

    assert.match(getBody, /requireAtlasApiAccess\(\)/);
    assert.doesNotMatch(getBody, /allowedRoles/);
    assert.match(getBody, /loadSharedProductionPlans/);
    assert.match(getBody, /canManageProduction: role === "owner"/);

    assert.match(patchBody, /requestOrigin !== request\.nextUrl\.origin/);
    assert.match(patchBody, /allowedRoles: \["owner"\]/);
    assert.match(patchBody, /owner_update_production_(?:plan|dashboard)_v1/);
  }

  const rules = read("app/api/atlas/production-rules/route.ts");
  const postBody = functionBody(rules, "POST");
  assert.match(postBody, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(postBody, /allowedRoles: \["owner"\]/);
  assert.match(postBody, /owner_create_production_plan_from_rule_v1/);
});

test("assigned Farm-Hand mutations remain separate from Owner mutations", () => {
  const route = read("app/api/atlas/task-transition/route.ts");
  const core = read("lib/atlas/task-transition-core.js");

  assert.match(route, /requireAtlasApiAccess\(\)/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /worker_record_task_transition_v1/);
  assert.match(route, /owner_record_task_transition_v1/);
  assert.match(core, /"done"/);
  assert.match(core, /"blocked"/);
  assert.match(core, /"unfinished"/);
  assert.match(core, /"rescheduled"/);
});
