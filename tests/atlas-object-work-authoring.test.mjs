import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

const page = read("app/objects/[objectKey]/page.tsx");
const route = read("app/api/atlas/objects/[objectKey]/work/route.ts");
const taskRoute = read("app/api/atlas/object-work/route.ts");
const core = read("supabase/migrations/20260801130000_atlas_object_work_core_v1.sql");
const bridge = read("supabase/migrations/20260801130200_atlas_object_work_bridge_and_governance_v1.sql");
const stateChange = read("supabase/migrations/20260803203500_object_work_state_change_contract_v1.sql");

test("Object Work no longer owns a presentation surface on canonical object pages", () => {
  assert.doesNotMatch(page, /ObjectWorkComposer/);
  assert.doesNotMatch(page, /object-work-composer/);
  assert.match(page, /MaintenanceDirectiveComposer/);
  assert.match(page, /AtlasTrail/);
  assert.match(page, /ObjectQuickLog/);
  assert.equal(exists("components/atlas/object-work-composer.tsx"), false);
  assert.equal(exists("components/atlas/object-work-task-strip.tsx"), false);
});

test("retirement removes the competing worker strip instead of preserving a second task trail", () => {
  assert.equal(exists("components/atlas/task-dominion-trail.tsx"), false);
  assert.equal(exists("lib/atlas/task-condition-rail.ts"), false);
  assert.equal(exists("lib/atlas/task-dominion.ts"), false);
});

test("legacy Object Work persistence remains isolated behind governed RPCs until data retirement", () => {
  for (const table of ["object_work_items", "object_work_steps", "object_work_crop_cycles"]) {
    assert.match(core, new RegExp(`create table if not exists atlas\\.${table}`));
    assert.match(core, new RegExp(`alter table atlas\\.${table} enable row level security`));
    assert.match(core, new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`));
  }
  assert.match(bridge, /authenticated_rpc_registry/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /allowedRoles: \["owner", "manager"\]/);
  assert.match(route, /create_object_work_v3/);
  assert.match(taskRoute, /requireAtlasApiAccess\(\)/);
});

test("legacy completion semantics are preserved while the empty subsystem is audited for removal", () => {
  assert.match(stateChange, /operational_truth text/);
  assert.match(stateChange, /record_object_work_truth_v1/);
  assert.match(stateChange, /if new\.status='done'/);
  assert.match(stateChange, /operational_truth_source = excluded\.operational_truth_source/);
  assert.match(stateChange, /operational_truth_work_item_id=v_item\.id/);
});
