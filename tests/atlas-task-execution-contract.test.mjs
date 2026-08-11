import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

const brief = read("components/atlas/task-execution-brief.tsx");
const results = read("components/atlas/task-primary-result-controls.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");
const checklist = read("components/atlas/execution-checklist-task-detail.tsx");
const mowing = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
const display = read("lib/atlas/task-display.ts");
const migration = read("supabase/migrations/20260810144000_atlas_task_execution_contract_v1.sql");

test("assigned work has one visible do-place-how-done contract", () => {
  for (const label of ["Do", "Place", "How", "Done when", "More instructions"]) {
    assert.ok(brief.includes(label), `shared execution brief keeps ${label}`);
  }
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.doesNotMatch(shell, /TaskDominionTrail/);
  assert.doesNotMatch(shell, /taskConditionRailModel/);
  assert.equal(exists("components/atlas/dominion-assigned-task-detail.tsx"), false);
  assert.equal(exists("components/atlas/task-dominion-trail.tsx"), false);
  assert.equal(exists("lib/atlas/task-condition-rail.ts"), false);
});

test("the primary result language is shared instead of reinvented per card", () => {
  assert.match(results, />\s*Unfinished\s*</);
  assert.match(results, /doneLabel = "Done"/);
  assert.match(shell, /TaskPrimaryResultControls/);
  assert.doesNotMatch(checklist, /TaskPrimaryResultControls/);
  assert.match(mowing, /TaskPrimaryResultControls/);
});

test("mowing is an instruction task, not an operating-system lecture", () => {
  assert.match(mowing, /TaskExecutionBrief/);
  assert.match(mowing, /Mow · \$\{task\.routeLabel\}/);
  assert.doesNotMatch(mowing, /What time means/i);
  assert.doesNotMatch(mowing, /What is physically true/i);
  assert.doesNotMatch(mowing, /Time does not claim/i);
  assert.doesNotMatch(mowing, /full mow renews the cadence/i);
});

test("checklist tasks are a method instrument inside the universal task shell", () => {
  assert.match(checklist, /AssignedTaskExecutionShell/);
  assert.match(checklist, /methodInstrument=\{methodInstrument\}/);
  assert.match(checklist, /data-atlas-method-instrument="execution-checklist"/);
  assert.match(checklist, /doneDisabled=\{checklist\?\.ready !== true\}/);
  assert.match(checklist, /resultPayload=\{resultPayload\}/);
  assert.match(checklist, /atlas-execution-checklist/);
  assert.doesNotMatch(checklist, /TaskExecutionBrief/);
  assert.doesNotMatch(checklist, /postAtlasTaskTransition/);
  assert.doesNotMatch(checklist, /TaskDominionTrail/);
});

test("explicit worker verbs cannot be reclassified by incidental words in the task text", () => {
  assert.match(display, /\["call", "phone", "research"/);
  assert.match(display, /value === "sowing" \|\| value === "sow" \|\| value === "seed_sowing"/);
  assert.ok(display.indexOf('atlasMetaString(task, "display_location")') < display.indexOf('atlasTaskObjectLocation(task)'), "explicit task place outranks attached destination objects");
});

test("current Elm tasks carry worker-facing execution fields without deleting source notes", () => {
  for (const key of ["execution_do", "execution_place", "execution_how", "execution_done_when"]) {
    assert.ok(migration.includes(`'${key}'`));
  }
  assert.match(migration, /Call for free wood-chip \/ weed-suppression sources/);
  assert.match(migration, /Grow Room · Outside hardening area/);
  assert.match(migration, /Berry Walk Flower Rows · Beds 7–8/);
  assert.match(migration, /Riding mower · cut to 4 in/);
});
