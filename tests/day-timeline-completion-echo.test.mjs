import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/day-timeline-completion-echo.css", import.meta.url), "utf8");

test("Day timeline nodes quick-complete simple tasks and preserve a tappable echo", () => {
  assert.match(page, /function CompletionEcho/);
  assert.match(page, /transition = complete \? "reopened" : "done"/);
  assert.match(page, /day_timeline_quick_complete/);
  assert.match(page, /objectStateBefore/);
  assert.match(page, /function windowedTimeline/);
  assert.match(page, /group\.tasks\.map\(timelineRow\)/);
  assert.match(page, /timelineTasks = useMemo\(\(\) => uniqueTasks\(\[\.\.\.mixedOpenTasks, \.\.\.doneDayTasks\]\)/);
  assert.match(page, /if \(isDoneTask\(task\)\)[\s\S]*<CompletionEcho/);
  assert.doesNotMatch(page, /\bUndo\b/);
});

test("structured-result cards open their result controls instead of blind completion", () => {
  assert.match(page, /function requiresStructuredResult/);
  assert.match(page, /window\.location\.assign\(taskResultHref\(task, returnTo\)\)/);
  assert.match(page, /planting_log_required/);
  assert.match(page, /germination\|harvest\|transplant\|planting\|readiness\|production/);
});

test("the visual dot keeps a full mobile tap target", () => {
  assert.match(styles, /\.atlas-day-task-node,[\s\S]*width: 36px;[\s\S]*height: 36px;/);
  assert.match(styles, /\.atlas-day-completion-echo/);
  assert.match(styles, /background: rgba\(139, 145, 194, 0\.28\)/);
});
