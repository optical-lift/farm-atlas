import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function filesUnder(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const output = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) output.push(...filesUnder(relative(root, child)));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry)) output.push(relative(root, child).replaceAll("\\", "/"));
  }
  return output;
}

test("interactive Atlas API routes never use the service-role client", () => {
  const offenders = filesUnder("app/api/atlas").filter((path) => {
    const source = read(path);
    return /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/.test(source);
  });
  assert.deepEqual(offenders, []);

  const proxy = read("lib/supabase/proxy.ts");
  assert.match(proxy, /needsAtlasFarmMembership/);
  assert.match(proxy, /farm_memberships/);
  assert.match(proxy, /farm\.stable_key/);
  assert.match(proxy, /elm_farm/);
});

test("zone registry and germination history use membership-scoped readers", () => {
  const zoneRoute = read("app/api/atlas/zone-registry/route.ts");
  const historyRoute = read("app/api/atlas/germination-history/route.ts");
  const migration = read("supabase/migrations/20260721070000_atlas_remove_final_service_role_readers.sql");

  for (const route of [zoneRoute, historyRoute]) {
    assert.match(route, /requireAtlasApiAccess/);
    assert.match(route, /createAtlasServerClient/);
    assert.doesNotMatch(route, /atlasSupabase|SUPABASE_SERVICE_ROLE_KEY/);
  }

  assert.match(zoneRoute, /zone_registry_source_v1/);
  assert.match(historyRoute, /germination_history_source_v1/);
  assert.match(migration, /farm_memberships/);
  assert.match(migration, /assigned_membership_id = v_membership_id/);
  assert.match(migration, /revoke all .* from public, anon/is);
  assert.match(migration, /grant execute .* to authenticated/is);
});

test("all task mutations flow through the shared transition route", () => {
  const sharedRoute = "app/api/atlas/task-transition/route.ts";
  const directRpcRoutes = filesUnder("app/api/atlas").filter((path) => {
    if (path === sharedRoute) return false;
    return /worker_record_task_transition_v1|owner_record_task_transition_v1|record_task_transition_v1/.test(read(path));
  });

  assert.deepEqual(directRpcRoutes, []);
  assert.equal(
    existsSync(join(root, "app/api/atlas/work/tasks/[taskId]/transition/route.ts")),
    false,
  );

  const legacyClientReferences = [
    ...filesUnder("app"),
    ...filesUnder("components"),
    ...filesUnder("lib"),
  ].filter((path) => /\/api\/atlas\/work\/tasks\//.test(read(path)));
  assert.deepEqual(legacyClientReferences, []);
});

test("the homepage reader is membership scoped instead of metadata assigned", () => {
  const route = read("app/api/atlas/home-task-cards/route.ts");
  const migration = read("supabase/migrations/20260721060200_atlas_add_membership_scoped_home_task_cards_reader.sql");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /home_task_cards_v1/);
  assert.doesNotMatch(route, /anna_task|assigned_to|atlasSupabase|SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(migration, /current_farm_role/);
  assert.match(migration, /current_membership_id/);
  assert.match(migration, /assigned_membership_id = v_target_membership_id/);
  assert.match(migration, /visibility_scope = 'farm_shared'/);
  assert.match(migration, /revoke all .* from public, anon/is);
});
