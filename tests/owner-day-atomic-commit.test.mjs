import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const board = read("components/atlas/owner-day-schedule-builder.tsx");
const route = read("app/api/atlas/owner-day-commit/route.ts");
const workMigration = read("supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql");
const cueMigration = read("supabase/migrations/20260811225500_atlas_owner_day_cue_atomic_commit_v2.sql");

test("Owner Day purple draft sends one commit request for work and cue changes", () => {
  assert.match(board, /Purple is your draft\. Nothing below is worker history until you commit it\./);
  assert.match(board, /fetch\("\/api\/atlas\/owner-day-commit"/);
  assert.match(board, /"x-atlas-intent": "owner-day-commit-v2"/);
  assert.match(board, /edits: editsForCommit\(\)/);
  assert.match(board, /selections: selectedCandidates\.map/);
  assert.match(board, /cueEdits: cueEditsForRequest\(cueDraftEdits\)/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-cue"/);
});

test("atomic commit route preserves owner and worker-target authorization", () => {
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(route, /owner_commit_worker_day_choreography_api_v2/);
  assert.match(route, /owner-day-commit-v2/);
  assert.match(route, /Nothing from this draft was saved/);
});

test("database commit keeps the existing work transaction and extends it across cue edits", () => {
  assert.match(workMigration, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(workMigration, /pg_advisory_xact_lock/);
  assert.match(workMigration, /owner_apply_worker_day_edits_api_v1/);
  assert.match(workMigration, /owner_build_worker_day_schedule_api_v2/);
  assert.match(cueMigration, /owner_commit_worker_day_choreography_api_v2/);
  assert.match(cueMigration, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(cueMigration, /owner_upsert_worker_day_cue_api_v1/);
  assert.match(cueMigration, /owner_delete_worker_day_cue_api_v1/);
  assert.match(cueMigration, /any failed work, selection, cue upsert, or cue delete rolls back the complete Day draft/);
  assert.match(cueMigration, /authenticated_rpc_registry/);
});

test("Owner replanning keeps explicit timing and recovery controls", () => {
  assert.match(board, /Tomorrow/);
  assert.match(board, /Next week/);
  assert.match(board, /type="date"/);
  assert.match(board, /Return to Atlas/);
  assert.match(board, /data-owner-day-timing-warning="true"/);
  assert.match(board, /Move anyway/);
  assert.match(board, /Work/);
  assert.match(board, /Cues/);
  assert.match(board, /Both/);
});
