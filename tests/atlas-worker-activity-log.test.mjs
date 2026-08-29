import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const shell = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const daySurface = read("app/day/DaySurface.tsx");
const layer = read("app/day/WorkerActivityDayLayer.tsx");
const css = read("app/day/worker-activity.module.css");
const route = read("app/api/atlas/worker-activity/route.ts");
const adapter = read("lib/atlas-data/worker-activity.ts");
const client = read("lib/atlas/worker-activity-client.ts");

test("live Day replaces the global exit X with the one-sentence Log work plus", () => {
  assert.match(shell, /isLiveDayOverview = pathname === "\/day"/);
  assert.match(shell, /aria-label="Log work"/);
  assert.match(shell, /ATLAS_OPEN_WORK_LOG_EVENT/);
  assert.match(shell, />\+<\/button>/);
  assert.match(shell, /atlas-global-exit/);
  assert.match(shell, />×<\/Link>/);
});

test("capture is deliberately tap sentence Done with no task-creation form", () => {
  assert.match(layer, /What did you just get done\?/);
  assert.match(layer, /Just write one sentence\. Atlas will save it to your day\./);
  assert.match(layer, /<textarea/);
  assert.match(layer, /SAVING…/);
  assert.match(layer, /"DONE"/);
  assert.doesNotMatch(layer, /project selector|priority|due date|duration|start time|crop selector|category selector/i);
  assert.doesNotMatch(layer, /postAtlasTaskTransition|manual-task|create task/i);
});

test("worker manual activity uses a dedicated evidence-only API rather than Quick Log mutation semantics", () => {
  assert.match(route, /recordWorkerActivity/);
  assert.match(adapter, /record_worker_activity_log_v1/);
  assert.match(adapter, /worker_activity_logs_for_day_v1/);
  assert.match(adapter, /retract_worker_activity_log_v1/);
  assert.doesNotMatch(route, /recordQuickLog|\/quick-log/);
  assert.doesNotMatch(adapter, /record_quick_log_v1|object_state|object_activity_events|field_log_objects/);
  assert.doesNotMatch(client, /actionTypes|zoneIds|objectIds/);
});

test("Clock NOW is captured server-side as provenance only", () => {
  assert.match(route, /readWorkerDaySequence/);
  assert.match(route, /clockNowSnapshot/);
  assert.match(route, /buildClockTaskRanges/);
  assert.match(route, /clock\.taskId/);
  assert.match(route, /clock\.startAt/);
  assert.match(route, /clock\.endAt/);
  assert.match(route, /clock\.revision/);
  assert.doesNotMatch(route, /commit.*placement|post.*choreography|task transition/i);
});

test("Day separates accomplishment from remaining Atlas work", () => {
  assert.match(layer, /Today so far/);
  assert.match(layer, /thingsDone = plannedDone \+ manualCount/);
  assert.match(layer, /Atlas \{plannedDone === 1 \? "task" : "tasks"\}/);
  assert.match(layer, /you logged/);
  assert.match(layer, /Still needs attention/);
  assert.match(layer, /Atlas tasks/);
});

test("manual logs and completed Atlas tasks share one chronological lived-day record", () => {
  assert.match(layer, /event\.sourceKind === "task"/);
  assert.match(layer, /event\.eventKind === "task_result"/);
  assert.match(layer, /day\.activityLogs\.map/);
  assert.match(layer, /\[\.\.\.atlasRows, \.\.\.manualRows\]\.sort/);
  assert.match(layer, /Atlas task/);
  assert.match(layer, /You logged this/);
  assert.match(layer, /Chronological work record/);
});

test("failed writes retain the sentence and use the same idempotency key for Retry", () => {
  assert.match(layer, /idempotencyRef\.current \?\? `worker-log:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(layer, /Deliberately retain rawText and the idempotency key so Retry is safe/);
  assert.match(layer, /saveError \? "TRY AGAIN"/);
  assert.doesNotMatch(layer, /setRawText\(""\)[\s\S]{0,300}catch/);
  assert.match(route, /worker_activity_write_failed/);
  assert.match(route, /Your sentence has not been discarded/);
});

test("successful capture returns to Day in place and offers Undo instead of a success screen", () => {
  assert.match(layer, /setOpen\(false\)/);
  assert.match(layer, /Added to your day ✓/);
  assert.match(layer, />\{undoing \? "Undoing…" : "Undo"\}<\/button>/);
  assert.match(client, /method: "DELETE"/);
  assert.doesNotMatch(layer, /router\.push|window\.location/);
});

test("DaySurface mounts activity directly beneath the Day command header without touching Clock", () => {
  assert.match(daySurface, /atlasWorkerActivityHost/);
  assert.match(daySurface, /header\.insertAdjacentElement\("afterend", activity\)/);
  assert.match(daySurface, /<WorkerActivityDayLayer/);
  assert.match(daySurface, /projection\?\.identity\.lens === "worker_self"/);
  assert.doesNotMatch(daySurface, /clock\/clock-orchestrator|ClockTimeline/);
  assert.match(css, /\.backdrop[\s\S]*position: fixed/);
  assert.match(css, /\.sheet[\s\S]*border-radius: 24px 24px 0 0/);
});
