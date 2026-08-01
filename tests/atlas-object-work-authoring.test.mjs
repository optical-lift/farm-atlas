import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/objects/[objectKey]/page.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/atlas/object-work-composer.tsx", import.meta.url), "utf8");
const taskStrip = readFileSync(new URL("../components/atlas/object-work-task-strip.tsx", import.meta.url), "utf8");
const taskTrail = readFileSync(new URL("../components/atlas/task-dominion-trail.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/objects/[objectKey]/work/route.ts", import.meta.url), "utf8");
const taskRoute = readFileSync(new URL("../app/api/atlas/object-work/route.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("../supabase/migrations/20260801130000_atlas_object_work_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801130100_atlas_object_work_authoring_v1.sql", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../supabase/migrations/20260801130200_atlas_object_work_bridge_and_governance_v1.sql", import.meta.url), "utf8");
const fkIndexes = readFileSync(new URL("../supabase/migrations/20260801130300_atlas_object_work_fk_indexes_v1.sql", import.meta.url), "utf8");

const allSql = `${core}\n${authoring}\n${bridge}\n${fkIndexes}`;

test("ordinary work authoring starts from a canonical object page", () => {
  assert.match(page, /import ObjectWorkComposer/);
  assert.match(page, /<ObjectWorkComposer[\s\S]*objectKey=\{object\.object_key\}/);
  assert.ok(page.indexOf("<ObjectWorkComposer") < page.indexOf("<MaintenanceDirectiveComposer"));
  assert.match(route, /p_object_key: objectKey\.trim\(\)/);
});

test("the ordinary composer covers decided card families without cloning Weed or Mow", () => {
  for (const action of ["check", "water", "sow", "transplant", "harvest", "repair", "reset", "prepare", "deliver", "other"]) {
    assert.match(composer, new RegExp(`key: \\\"${action}\\\"`));
  }
  assert.doesNotMatch(composer, /key: "weed"/);
  assert.doesNotMatch(composer, /key: "mow"/);
  assert.match(composer, /Weed and Mow remain on their perpetual maintenance cards/);
  assert.match(authoring, /Weeding and mowing belong to their persistent maintenance cards/);
});

test("object work is a durable plan with one canonical released task", () => {
  assert.match(core, /create table if not exists atlas\.object_work_items/);
  assert.match(core, /planned_occurrence_id uuid references atlas\.planned_work_occurrences/);
  assert.match(core, /task_id uuid references atlas\.tasks/);
  assert.match(authoring, /atlas\.plan_work_occurrence_v1\(/);
  assert.match(authoring, /planned_occurrence_id, release_policy_id, released_at, release_reason/);
  assert.match(authoring, /perform atlas\.restore_task_relation_payload_v1/);
  assert.doesNotMatch(authoring, /insert into atlas\.journal_event_index/);
  assert.doesNotMatch(authoring, /insert into atlas\.bell_/);
});

test("manual release and capacity-held planning are explicit, different states", () => {
  assert.match(core, /release_mode in \('put_in_work','hold_for_capacity'\)/);
  assert.match(composer, /Put in Work/);
  assert.match(composer, /Hold as planned/);
  assert.match(composer, /next\.capacity\.farmAtCapacity[\s\S]*hold_for_capacity/);
  assert.match(authoring, /if p_release_mode = 'put_in_work' then/);
  assert.match(authoring, /manual_object_work_capacity_override/);
  assert.match(authoring, /capacityAtAuthoring/);
});

test("every card has a physical done definition and task-side result context", () => {
  assert.match(core, /done_definition text not null/);
  assert.match(authoring, /physical done definition/);
  assert.match(authoring, /'done_definition', btrim\(p_done_definition\)/);
  assert.match(composer, />Done means</);
  assert.match(taskStrip, /<small>Done means<\/small>/);
  assert.match(taskTrail, /<ObjectWorkTaskStrip taskId=\{task\.task_id\}/);
});

test("real object and crop relationships are restored onto the task", () => {
  assert.match(authoring, /'task_objects', jsonb_build_array/);
  assert.match(authoring, /'task_crop_cycles', v_crop_payload/);
  assert.match(authoring, /cycle\.farm_id = p_farm_id and cycle\.object_id = v_object\.id/);
  assert.match(authoring, /'confidence', 'confirmed'/);
  assert.match(authoring, /'source', 'object_work_authoring'/);
});

test("lockscreen delivery comes from the chosen farm window", () => {
  assert.match(authoring, /maintenance_directive_window_v1\(p_work_window_key\)/);
  assert.match(authoring, /insert into atlas\.task_notification_plans/);
  assert.match(authoring, /'object_work_authoring'/);
  assert.match(bridge, /trg_sync_object_work_release_v1/);
  assert.match(bridge, /task_notification_plans/);
});

test("checklist truth is durable and assigned-player scoped", () => {
  assert.match(core, /create table if not exists atlas\.object_work_steps/);
  assert.match(authoring, /set_object_work_step_v1/);
  assert.match(authoring, /v_membership_id is distinct from v_item\.assigned_membership_id/);
  assert.match(taskRoute, /object-work-step-v1/);
  assert.match(taskStrip, /setAtlasObjectWorkStep/);
});

test("owner and manager author; workers execute released work", () => {
  assert.match(route, /allowedRoles: \["owner", "manager"\]/);
  assert.match(authoring, /v_role not in \('owner','manager'\)/);
  assert.match(authoring, /visibility_scope', 'assigned_worker'/);
  assert.match(authoring, /can_read_task_in_journal_v1/);
  assert.match(taskRoute, /requireAtlasApiAccess\(\)/);
});

test("equivalent active cards are prevented and authoring is idempotent", () => {
  assert.match(core, /object_work_items_active_equivalent_idx/);
  assert.match(core, /where status in \('planned','released'\)/);
  assert.match(core, /unique \(farm_id, idempotency_key\)/);
  assert.match(authoring, /'deduplicated', true/);
  assert.match(route, /object_work_duplicate/);
});

test("released task status remains the completion truth", () => {
  assert.match(bridge, /after update of status on atlas\.tasks/);
  assert.match(bridge, /new\.status='done'/);
  assert.match(bridge, /status='completed'/);
  assert.match(bridge, /new\.status in \('skipped','archived'\)/);
  assert.match(authoring, /Released work must be closed from its task card so the result remains canonical/);
});

test("object work tables are service-internal behind governed RPCs", () => {
  for (const table of ["object_work_items", "object_work_steps", "object_work_crop_cycles"]) {
    assert.match(core, new RegExp(`alter table atlas\\.${table} enable row level security`));
    assert.match(core, new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`));
  }
  assert.match(bridge, /authenticated_rpc_registry/);
  assert.match(bridge, /atlas\.create_object_work_v1\(uuid, text/);
  assert.match(bridge, /revoke all on function atlas\.object_work_item_json_v1\(uuid\) from public, anon, authenticated/);
});

test("new foreign keys have leading-column indexes", () => {
  for (const index of [
    "object_work_items_object_status_idx",
    "object_work_items_assignee_status_idx",
    "object_work_items_occurrence_idx",
    "object_work_items_task_idx",
    "object_work_steps_item_idx",
    "object_work_crop_cycles_cycle_idx",
  ]) assert.match(core, new RegExp(index));

  for (const index of [
    "object_work_items_organization_idx",
    "object_work_items_created_by_user_idx",
    "object_work_steps_completed_by_user_idx",
  ]) assert.match(fkIndexes, new RegExp(index));
});
