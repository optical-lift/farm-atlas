import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814174157_worker_self_day_plan_api_v1.sql");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const operationalCards = read("lib/atlas/worker-day-operational-task-cards-server.ts");
const route = read("app/api/atlas/worker-day-sequence/route.ts");
const selfPlanServer = read("lib/atlas/worker-self-day-plan-server.ts");
const workerPlanServer = read("lib/atlas/worker-day-plan-server.ts");

test("Farm Hand self planner delegates to canonical Worker Day truth and strips Owner suggestions", () => {
  assert.match(migration, /worker_self_day_plan_api_v1/);
  assert.match(migration, /membership\.user_id=auth\.uid\(\)/);
  assert.match(migration, /membership\.role='farm_hand'/);
  assert.match(migration, /owner_worker_day_plan_choreographed_v1/);
  assert.match(migration, /jsonb_set\(v_plan,'\{suggestions\}','\[\]'::jsonb,true\)/);
  assert.match(migration, /authenticated_rpc_registry/);
});

test("one Worker Day endpoint serves Owner-managed and Farm Hand self projections", () => {
  assert.match(route, /readWorkerDaySequence/);
  assert.match(route, /worker-day-sequence-v2/);
  assert.match(sequenceServer, /session\.memberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(sequenceServer, /readOwnerWorkerDaySequence\(dateIso, session\)/);
  assert.match(sequenceServer, /readWorkerSelfDaySequence\(dateIso, target\)/);
  assert.match(sequenceServer, /source: "worker_self"/);
});

test("Farm Hand browser no longer owns a second scheduler or rich task-card request", () => {
  assert.match(projectionClient, /\/api\/atlas\/worker-day-sequence/);
  assert.doesNotMatch(projectionClient, /fetchAtlasTaskCards/);
  assert.doesNotMatch(projectionClient, /assembleWorkerDaySequence/);
  assert.doesNotMatch(projectionClient, /\/api\/atlas\/day-choreography/);
  assert.doesNotMatch(projectionClient, /atlasWorkOrderNumber|atlasWorkOrderAnchorForTask|planRow\(/);
});

test("Farm Hand plan and target-scoped choreography run concurrently before selected card hydration", () => {
  const start = sequenceServer.indexOf("async function readWorkerSelfDaySequence");
  const body = sequenceServer.slice(start, sequenceServer.indexOf("export async function readWorkerDaySequence", start));
  assert.match(body, /Promise\.all\(\[/);
  assert.match(body, /readWorkerSelfDayPlanForTarget\(dateIso, target\)/);
  assert.match(body, /readWorkerDayChoreographyForTarget\(dateIso, target\)/);
  assert.ok(body.indexOf("readWorkerDayOperationalTaskCards") > body.indexOf("Promise.all"));
});

test("Farm Hand operational cards exclude Owner move context", () => {
  assert.match(operationalCards, /includeMoveContext\?: boolean/);
  assert.match(operationalCards, /move_context: _moveContext/);
  assert.match(sequenceServer, /includeMoveContext: false/);
});

test("Farm Hand plan passes through the same timing enrichment seam as Owner", () => {
  assert.match(workerPlanServer, /export function normalizeWorkerDayPlan/);
  assert.match(workerPlanServer, /export async function enrichWorkerDayPlanTiming/);
  assert.match(workerPlanServer, /deriveAtlasTimingMobility\(\{ metadata: task\.metadata, potential: false \}\)/);
  assert.match(selfPlanServer, /normalizeWorkerDayPlan\(data\)/);
  assert.match(selfPlanServer, /enrichWorkerDayPlanTiming\(\{ \.\.\.normalized, suggestions: \[\] \}\)/);
  assert.match(selfPlanServer, /suggestions: \[\]/);
});

test("role-aware endpoint reuses its authenticated Owner session", () => {
  const start = sequenceServer.indexOf("export async function readWorkerDaySequence");
  const body = sequenceServer.slice(start);
  assert.equal((body.match(/getAtlasSession\(\)/g) ?? []).length, 1);
  assert.match(body, /readOwnerWorkerDaySequence\(dateIso, session\)/);
  assert.match(workerPlanServer, /readOwnerWorkerDayPlanForSession\(dateIso, session\)/);
  assert.match(workerPlanServer, /resolveOwnerWorkerDayPlanningTargetForSession\(session\)/);
});

test("server projection explicitly carries management capability", () => {
  assert.match(sequenceServer, /canManage: true/);
  assert.match(sequenceServer, /canManage: false/);
  assert.match(projectionClient, /canManage: body\.canManage === true/);
  assert.doesNotMatch(projectionClient, /const ownerProjection = await readOwnerWorkerDayProjection/);
});
