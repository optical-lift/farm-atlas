import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Worker Today keeps the deployed page structure and lane order", () => {
  const page = read("app/work/today/page.tsx");
  const css = read("app/work/today/work.module.css");

  assert.match(page, /getWorkerHand/);
  assert.match(page, /WorkerTaskActions/);
  assert.match(page, /<WorkerSection title="Blocked"/);
  assert.match(page, /<WorkerSection title="Overdue"/);
  assert.match(page, /<WorkerSection title="Today"/);
  assert.match(page, /<WorkerSection title="Next Useful Actions"/);
  assert.match(page, /hand\.counts\.blocked/);
  assert.match(page, /hand\.counts\.overdue/);
  assert.match(page, /hand\.counts\.today/);
  assert.match(page, /hand\.counts\.undated/);
  assert.doesNotMatch(page, /WorkerTodayBoard/);

  for (const selector of [".summary", ".section", ".task", ".actions", ".actionGrid"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /border-radius: 20px/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test("Worker Today action boxes look the same but use the shared transition client", () => {
  const actions = read("app/work/today/WorkerTaskActions.tsx");

  assert.match(actions, /postAtlasTaskTransition/);
  assert.match(actions, /source: "worker_today"/);
  assert.match(actions, /"Complete"/);
  assert.match(actions, /"Blocked"/);
  assert.match(actions, /"Save note"/);
  assert.match(actions, /styles\.actions/);
  assert.match(actions, /styles\.actionGrid/);
  assert.doesNotMatch(actions, /\/api\/atlas\/work\/tasks/);
});

test("the full task page keeps Anna's familiar Unfinished drawer", () => {
  const detail = read("components/atlas/canonical-assigned-task-detail.tsx");

  for (const label of [
    "Unfinished",
    "What happened?",
    "Partly done",
    "Blocked",
    "Reschedule",
    "Tomorrow",
    "Next week",
    "Pick a date",
    "Close without doing it",
    "Changed plan",
    "Not relevant",
  ]) {
    assert.match(detail, new RegExp(label.replace(/[?]/g, "\\?")));
  }
  assert.match(detail, /scheduleIntent: "next_day"/);
});
