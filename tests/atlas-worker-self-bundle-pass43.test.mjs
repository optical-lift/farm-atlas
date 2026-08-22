import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

const migration = read("supabase/migrations/20260814210129_worker_self_day_bundle_fast_path_v1.sql");
const selfPlanServer = read("lib/atlas/worker-self-day-plan-server.ts");
const cardServer = read("lib/atlas/worker-day-operational-task-cards-server.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");

test("Farm Hand bundle composes existing canonical plan and card readers instead of creating new task truth", () => {
  assert.match(migration, /worker_self_day_bundle_api_v1/);
  assert.match(migration, /v_plan := atlas\.worker_self_day_plan_api_v1\(p_farm_id, p_membership_id, p_day\)/);
  assert.match(migration, /v_cards := atlas\.worker_day_operational_task_cards_v2/);
  assert.match(migration, /coalesce\(v_plan->'realWork'/);
  assert.match(migration, /coalesce\(v_plan->'automaticWork'/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks|update atlas\.tasks|delete from atlas\.tasks/i);
});

test("operational card RPC computes Move context only for management", () => {
  assert.match(migration, /v_is_management boolean := false/);
  assert.match(migration, /v_is_management := atlas\.is_farm_manager_or_owner\(p_farm_id\)/);
  assert.match(migration, /and not v_is_management then/);
  assert.match(migration, /if v_is_management then\s+v_move_context := coalesce\(atlas\.task_move_context_batch_v1\(v_ids\)/s);
});

test("Farm Hand bundle removes Move context before crossing the authenticated DB boundary", () => {
  assert.match(migration, /jsonb_agg\(card - 'move_context' order by ord\)/);
  assert.match(migration, /'taskCards', v_safe_cards/);
  assert.match(migration, /revoke all on function atlas\.worker_self_day_bundle_api_v1\(uuid, uuid, date\) from public/);
  assert.match(migration, /grant execute on function atlas\.worker_self_day_bundle_api_v1\(uuid, uuid, date\) to authenticated/);
  assert.match(migration, /atlas\.authenticated_rpc_registry/);
  assert.match(migration, /delegates to worker_self_day_plan_api_v1 self-only Farm Hand authorization/);
});

test("server bundle keeps canonical plan and card normalization while skipping the owner timing re-query on first paint", () => {
  const bundleReader = section(selfPlanServer, "export async function readWorkerSelfDayBundleForTarget", "}");
  assert.match(selfPlanServer, /supabase\.rpc\("worker_self_day_bundle_api_v1"/);
  assert.match(selfPlanServer, /normalizeWorkerDayPlan\(data\)/);
  assert.match(selfPlanServer, /if \(!enrichTiming\) return \{ \.\.\.normalized, suggestions: \[\] \}/);
  assert.match(selfPlanServer, /enrichWorkerDayPlanTiming\(\{ \.\.\.normalized, suggestions: \[\] \}\)/);
  assert.match(bundleReader, /normalizeWorkerSelfPlan\(payload\.plan, false\)/);
  assert.doesNotMatch(bundleReader, /enrichWorkerDayPlanTiming/);
  assert.match(selfPlanServer, /normalizeWorkerDayOperationalTaskCards\(payload\.taskCards, \{ includeMoveContext: false \}\)/);
  assert.match(cardServer, /export function normalizeWorkerDayOperationalTaskCards/);
});

test("Farm Hand sequence has one bundle RPC plus choreography and no sequential card hydration", () => {
  const selfSequence = section(sequenceServer, "async function readWorkerSelfDaySequence", "export async function readWorkerDaySequence");
  assert.match(selfSequence, /Promise\.all\(\[/);
  assert.match(selfSequence, /readWorkerSelfDayBundleForTarget\(dateIso, target\)/);
  assert.match(selfSequence, /readWorkerDayChoreographyForTarget\(dateIso, target\)/);
  assert.match(selfSequence, /taskCards: bundleRead\.value\.taskCards/);
  assert.match(selfSequence, /timing\.taskCardsMs = 0/);
  assert.doesNotMatch(selfSequence, /readWorkerDayOperationalTaskCards/);
});

test("Owner sequence keeps its management card path and Move context", () => {
  const ownerSequence = section(sequenceServer, "export async function readOwnerWorkerDaySequence", "async function readWorkerSelfDaySequence");
  assert.match(ownerSequence, /readWorkerDayOperationalTaskCards\(plan\)/);
  assert.match(ownerSequence, /taskCards: taskCardsRead\.value/);
  assert.doesNotMatch(ownerSequence, /readWorkerSelfDayBundleForTarget/);
});
