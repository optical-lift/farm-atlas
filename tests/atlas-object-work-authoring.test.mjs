import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/objects/[objectKey]/page.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/atlas/object-work-composer.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/atlas/object-work-client.ts", import.meta.url), "utf8");
const taskStrip = readFileSync(new URL("../components/atlas/object-work-task-strip.tsx", import.meta.url), "utf8");
const taskTrail = readFileSync(new URL("../components/atlas/task-dominion-trail.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/objects/[objectKey]/work/route.ts", import.meta.url), "utf8");
const taskRoute = readFileSync(new URL("../app/api/atlas/object-work/route.ts", import.meta.url), "utf8");
const reservoir = readFileSync(new URL("../docs/atlas-work-reservoir-execution-window.md", import.meta.url), "utf8");
const core = readFileSync(new URL("../supabase/migrations/20260801130000_atlas_object_work_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801130100_atlas_object_work_authoring_v1.sql", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../supabase/migrations/20260801130200_atlas_object_work_bridge_and_governance_v1.sql", import.meta.url), "utf8");
const fkIndexes = readFileSync(new URL("../supabase/migrations/20260801130300_atlas_object_work_fk_indexes_v1.sql", import.meta.url), "utf8");
const stateChange = readFileSync(new URL("../supabase/migrations/20260803203500_object_work_state_change_contract_v1.sql", import.meta.url), "utf8");

const allSql = `${core}\n${authoring}\n${bridge}\n${fkIndexes}\n${stateChange}`;

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

test("farm-day commitment replaces the visible global capacity choice", () => {
  assert.match(composer, /Must happen that day/);
  assert.match(composer, /Can float around that day/);
  assert.match(composer, /Bring into Work now/);
  assert.doesNotMatch(composer, />Put in Work</);
  assert.doesNotMatch(composer, />Hold as planned</);
  assert.match(client, /AtlasObjectWorkDateCommitment = "hard_date" \| "floating"/);
  assert.match(reservoir, /Capacity may control what Atlas presents next/);
  assert.match(reservoir, /maximum_active_safety_tasks/);
});

test("task creators carry the before-and-after state burden", () => {
  assert.match(stateChange, /current_truth text/);
  assert.match(stateChange, /after_truth text/);
  assert.match(stateChange, /create or replace function atlas\.create_object_work_v3/);
  assert.match(route, /object-work-state-change-v1/);
  assert.match(route, /create_object_work_v3/);
  assert.match(route, /p_current_truth: currentTruth/);
  assert.match(route, /p_after_truth: afterTruth/);
  assert.match(client, /currentTruth: string/);
  assert.match(client, /afterTruth: string/);
  assert.match(composer, />Current truth</);
  assert.match(composer, />Truth after completion</);
  assert.match(composer, /currentTruth\.trim\(\) !== afterTruth\.trim\(\)/);
});

test("assigned workers see the state change instead of an instruction manual", () => {
  assert.match(taskTrail, /<ObjectWorkTaskStrip taskId=\{task\.task_id\}/);
  assert.match(taskStrip, /aria-label="Prepared task state change"/);
  assert.match(taskStrip, /<small>Current truth<\/small>/);
  assert.match(taskStrip, /<small>After Done<\/small>/);
  assert.doesNotMatch(taskStrip, /setAtlasObjectWorkStep/);
  assert.doesNotMatch(taskStrip, /workItem\.steps\.map/);
  assert.doesNotMatch(composer, /Checkable steps/);
  assert.doesNotMatch(composer, /placeholder="Add a step"/);
});

test("Done applies the prepared after truth to canonical object state", () => {
  assert.match(stateChange, /operational_truth text/);
  assert.match(stateChange, /record_object_work_truth_v1/);
  assert.match(stateChange, /if new\.status='done'/);
  assert.match(stateChange, /perform atlas\.record_object_work_truth_v1\(v_item\.id,'after',new\.id\)/);
  assert.match(stateChange, /event_type[\s\S]*task_state_applied/);
  assert.match(stateChange, /operational_truth_source = excluded\.operational_truth_source/);
  assert.match(stateChange, /stateChangeApplied/);
});

test("reopening cannot overwrite a newer object truth", () => {
  assert.match(stateChange, /operational_truth_work_item_id=v_item\.id/);
  assert.match(stateChange, /operational_truth_source='object_work_completion'/);
  assert.match(stateChange, /if v_can_restore and v_item\.current_truth is not null/);
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
  assert.match(stateChange, /create or replace function atlas\.sync_object_work_release_v1/);
  assert.match(stateChange, /task_notification_plans/);
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

test("released task status remains the completion trigger", () => {
  assert.match(stateChange, /after update of status on atlas\.tasks|create or replace function atlas\.sync_object_work_from_task_status_v1/);
  assert.match(stateChange, /new\.status='done'/);
  assert.match(stateChange, /status='completed'/);
  assert.match(stateChange, /new\.status in \('skipped','archived'\)/);
  assert.match(authoring, /Released work must be closed from its task card so the result remains canonical/);
});

test("object work tables are service-internal behind governed RPCs", () => {
  for (const table of ["object_work_items", "object_work_steps", "object_work_crop_cycles"]) {
    assert.match(core, new RegExp(`alter table atlas\\.${table} enable row level security`));
    assert.match(core, new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`));
  }
  assert.match(bridge, /authenticated_rpc_registry/);
  assert.match(stateChange, /atlas\.create_object_work_v3\(uuid, text/);
  assert.match(stateChange, /revoke all on function atlas\.record_object_work_truth_v1/);
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

  assert.match(stateChange, /object_state_operational_truth_work_item_idx/);
  assert.match(stateChange, /object_state_operational_truth_task_idx/);
});
