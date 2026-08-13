import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const board = read("components/atlas/owner-day-schedule-builder.tsx");
const projection = read("components/atlas/owner-interleaved-day-projection.tsx");
const route = read("app/api/atlas/owner-day-commit/route.ts");
const migration = read("supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql");

test("Owner Day inline draft sends one commit request for edits and selected potential work", () => {
  assert.match(board, /data-owner-day-inline-edit-controller/);
  assert.match(projection, /data-owner-potential-day-card/);
  assert.match(board, /fetch\("\/api\/atlas\/owner-day-commit"/);
  assert.match(board, /owner-day-commit-v1/);
  assert.match(board, /edits: editsForCommit\(\)/);
  assert.match(board, /selections: selectedCandidates\.map/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-schedule"/);
});

test("atomic commit route preserves owner and worker-target authorization", () => {
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(route, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(route, /owner-day-commit-v1/);
  assert.match(route, /Nothing from this draft was saved/);
});

test("database commit wraps placement edits and selected work in one transaction boundary", () => {
  assert.match(migration, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /owner_apply_worker_day_edits_api_v1/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2/);
  assert.match(migration, /any failed edit or selection rolls back the entire Day commit/);
  assert.match(migration, /authenticated_rpc_registry/);
});

test("atomic commit registers against the canonical authenticated RPC registry schema", () => {
  assert.match(migration, /classification,/);
  assert.match(migration, /confidence,/);
  assert.match(migration, /review_status,/);
  assert.match(migration, /authenticated_execute_expected,/);
  assert.match(migration, /security_definer_expected,/);
  assert.match(migration, /service_execute_expected,/);
  assert.match(migration, /caller_count,/);
  assert.match(migration, /policy_reference_count,/);
  assert.doesNotMatch(migration, /\bwrite_kind\b/);
  assert.doesNotMatch(migration, /\broute_dependencies\b/);
  assert.doesNotMatch(migration, /\bprotection\b/);
});

test("Owner replanning keeps explicit timing and recovery controls inline", () => {
  assert.match(board, /Tomorrow/);
  assert.match(board, /type="date"/);
  assert.match(board, /Return to Atlas/);
  assert.match(board, /data-owner-day-timing-warning/);
  assert.match(board, /Move anyway/);
  assert.match(board, /Morning/);
  assert.match(board, /Afternoon/);
  assert.match(board, /Evening/);
  assert.match(board, /Move earlier/);
  assert.match(board, /Move later/);
  assert.doesNotMatch(board, /data-owner-day-edit-board/);
});
