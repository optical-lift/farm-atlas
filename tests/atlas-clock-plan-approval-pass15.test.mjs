import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const draft = read("lib/atlas/clock-plan-draft.ts");
const editor = read("components/atlas/clock/use-clock-plan-editor.ts");
const block = read("components/atlas/clock/clock-planning-block.tsx");
const bar = read("components/atlas/clock/clock-plan-bar.tsx");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");
const route = read("app/api/atlas/owner-clock-plan-commit/route.ts");
const migration = read("supabase/migrations/20260814005500_owner_clock_plan_atomic_commit_v1.sql");

test("Pass 15 keeps readiness blockers out of Clock mobility", () => {
  assert.match(draft, /constraintClass/);
  assert.match(draft, /fixed_time/);
  assert.match(draft, /window/);
  assert.match(draft, /anchor/);
  assert.match(draft, /overlap/);
  assert.doesNotMatch(draft, /doneDisabled|readiness|blocker/i);
  assert.match(block, /data-clock-readiness-independent="true"/);
});

test("Owner can rearrange and resize both white and purple draft blocks", () => {
  assert.match(block, /mode:\s*"move"\|"resize"/);
  assert.match(block, /onPointerDown/);
  assert.match(block, /onPointerMove/);
  assert.match(block, /Use this/);
  assert.match(block, /Not this/);
  assert.match(block, /Return to Unplaced/);
  assert.match(block, /Override warning/);
  assert.match(block, /Purple stays proposed until Commit plan/);
});

test("Owner can accept the whole proposal or cancel/reset without mutation", () => {
  assert.match(bar, /Use whole plan/);
  assert.match(bar, /Reset/);
  assert.match(bar, /Cancel/);
  assert.match(bar, /Commit plan/);
  assert.match(bar, /Nothing here changes Anna's Clock until Commit plan/);
  assert.match(orchestrator, /canManage&&proposalOpen/);
});

test("Clock plan editor has one atomic mutation seam", () => {
  assert.match(editor, /\/api\/atlas\/owner-clock-plan-commit/);
  assert.match(editor, /owner-clock-plan-commit-v1/);
  assert.doesNotMatch(editor, /owner-day-task-time/);
  assert.doesNotMatch(editor, /owner-day-task-duration/);
  assert.match(editor, /unresolvedWarningCount/);
});

test("atomic endpoint calls only the Clock plan commit RPC", () => {
  assert.match(route, /owner_commit_worker_clock_plan_api_v1/);
  assert.match(route, /owner-clock-plan-commit-v1/);
  assert.doesNotMatch(route, /owner_set_worker_day_task_time_api_v1/);
  assert.doesNotMatch(route, /owner_set_worker_day_task_duration_api_v1/);
});

test("atomic Clock commit changes choreography but never task truth", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /planned_start_at/);
  assert.match(migration, /planned_duration_minutes/);
  assert.match(migration, /America\/Chicago/);
  assert.match(migration, /is distinct from v_expected_start/);
  assert.match(migration, /is distinct from v_expected_duration/);
  assert.match(migration, /owner_clock_plan_commit/);
  assert.doesNotMatch(migration, /update\s+atlas\.tasks\s+set/i);
  assert.doesNotMatch(migration, /due_date/i);
  assert.doesNotMatch(migration, /record_task_transition/i);
});

test("blocked status is not treated as a Clock commit lock", () => {
  assert.match(migration, /\('done','completed','archived','skipped'\)/);
  assert.doesNotMatch(migration, /status[^\n]*blocked/i);
  assert.doesNotMatch(route, /readiness|blocker|doneDisabled/i);
});
