import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assembleTaskMoveCore } from "../lib/atlas/task-move-assembly-core.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assemble(task, overrides = {}) {
  return assembleTaskMoveCore({
    task,
    execution: {
      doText: overrides.doText ?? task.title,
      placeText: overrides.placeText ?? "Elm Farm",
      howLines: overrides.howLines ?? ["Follow the task instructions."],
      doneWhen: overrides.doneWhen ?? "The requested result is recorded.",
      details: overrides.details ?? null,
      dueLabel: overrides.dueLabel ?? "Today",
    },
    dominion: {
      route: overrides.route ?? "general",
      instruction: overrides.instruction ?? task.title,
      placeLabel: overrides.placeText ?? "Elm Farm",
      dueLabel: overrides.dueLabel ?? "Today",
      whyNow: overrides.whyNow ?? "This move is active now.",
      stateEffect: overrides.stateEffect ?? "Atlas can release the next move.",
    },
    moveContext: overrides.moveContext ?? null,
  });
}

test("current MG10 weed work keeps its real maintenance task identity while routing as weed work", () => {
  const result = assemble({
    task_id: "21a075bd-3dd1-4ee5-b02c-a4278c9c441b",
    title: "Weed MG10",
    task_type: "maintenance",
    status: "open",
    priority: "high",
    due_date: "2026-08-07",
    work_class: "heavy",
    updated_at: "2026-08-10T13:17:00.051845Z",
  }, {
    route: "weed",
    doText: "Weed · MG10",
    placeText: "MG10",
    howLines: ["Clear the assigned bed."],
    doneWhen: "The assigned area is cleared to the task target.",
  });

  assert.equal(result.version, 1);
  assert.equal(result.task.taskType, "maintenance");
  assert.equal(result.task.route, "weed");
  assert.equal(result.task.workClass, "heavy");
  assert.equal(result.move.what, "Weed · MG10");
  assert.equal(result.move.where, "MG10");
  assert.deepEqual(result.move.how, ["Clear the assigned bed."]);
  assert.equal(result.move.doneWhen, "The assigned area is cleared to the task target.");
});

test("current germination checks keep their crop-cycle identity and biological reason", () => {
  const result = assemble({
    task_id: "365bfba7-e2d6-4a66-b7c8-6cd37f3ccbf1",
    title: "Check germination — Sunflower · Barn Bed 8",
    task_type: "germination_check",
    status: "open",
    priority: "high",
    due_date: "2026-08-10",
    work_class: "crop_cycle",
  }, {
    route: "crop_cycle",
    placeText: "Barn Bed 8",
    whyNow: "The crop cycle has reached its germination observation gate.",
    stateEffect: "Atlas can release the next crop move from the observed state.",
  });

  assert.equal(result.task.taskType, "germination_check");
  assert.equal(result.task.route, "crop_cycle");
  assert.equal(result.move.where, "Barn Bed 8");
  assert.match(result.context.whyNow, /germination observation gate/);
  assert.match(result.context.stateEffect, /next crop move/);
});

test("Finish Elm context attaches to real exterior-cleaning work without changing its task type", () => {
  const result = assemble({
    task_id: "30206358-13eb-4729-b371-c53fbb2ba877",
    title: "Gently Pressure Wash Behind the Garage Spirea",
    task_type: "exterior_cleaning",
    status: "open",
    priority: "normal",
    due_date: "2026-08-10",
    work_class: "standard",
  }, {
    route: "venue",
    moveContext: {
      projects: [{
        projectId: "finish-elm",
        projectKey: "finish_elm",
        title: "Finish Elm",
        portfolioType: "project",
        targetDate: null,
        linkRole: "task",
        path: [{
          projectId: "venue-finish-line",
          projectKey: "venue_finish_line",
          title: "Venue Finish Line",
          portfolioType: "project",
        }],
      }],
      waitingOn: [],
      unlocks: [],
    },
  });

  assert.equal(result.task.taskType, "exterior_cleaning");
  assert.equal(result.context.projects[0].title, "Finish Elm");
  assert.equal(result.context.projects[0].path[0].title, "Venue Finish Line");
});

test("current Grow Room Care remains a general task route unless Atlas supplies a more specific route", () => {
  const result = assemble({
    task_id: "7e0f572e-07bf-464f-9791-9dff75ca29f4",
    title: "Grow Room Care",
    task_type: "grow_room_care",
    status: "open",
    priority: "high",
    due_date: "2026-08-10",
    work_class: "standard",
  }, {
    route: "general",
    placeText: "Grow Room",
    moveContext: {
      projects: [],
      waitingOn: [{
        taskId: "watering-check-1",
        title: "Check tray moisture",
        status: "open",
        assigneeName: "Anna",
        requiredStatus: "done",
        holdMode: "blocking",
      }],
      unlocks: [{
        taskId: "transplant-ready-1",
        title: "Check transplant readiness",
        status: "open",
        assigneeName: "Anna",
        requiredStatus: "done",
        holdMode: "release",
      }],
    },
  });

  assert.equal(result.task.taskType, "grow_room_care");
  assert.equal(result.task.route, "general");
  assert.equal(result.move.where, "Grow Room");
  assert.equal(result.context.waitingOn[0].taskId, "watering-check-1");
  assert.equal(result.context.unlocks[0].taskId, "transplant-ready-1");
});

test("blocked work carries the real task blocker in the same canonical assembly", () => {
  const result = assemble({
    task_id: "1ca6c7e6-93bf-4b13-9c3d-48f1e440a643",
    title: "Set bloom bar — round table by windows",
    task_type: "event_setup",
    status: "blocked",
    priority: "high",
    due_date: "2026-08-13",
    blocker_text: "Waiting for Condition + sort Thursday flower buckets",
    work_class: "hospitality_presentability",
  }, {
    route: "venue",
    placeText: "Round table by windows",
  });

  assert.equal(result.task.status, "blocked");
  assert.equal(result.context.blocker, "Waiting for Condition + sort Thursday flower buckets");
});

test("the TypeScript adapter reuses Atlas execution and dominion instead of duplicating them", () => {
  const source = read("lib/atlas/task-move-assembly.ts");
  assert.match(source, /taskExecutionModel\(task\)/);
  assert.match(source, /taskDominionModel\(task, null\)/);
  assert.match(source, /task\.move_context/);
  assert.match(source, /export type TaskMoveAssembly/);
  assert.match(source, /blocker: string \| null/);
});

test("the server resolver uses Atlas membership-scoped card readers plus move context", () => {
  const source = read("lib/atlas/task-move-resolver.ts");
  assert.match(source, /createAtlasServerClient/);
  assert.match(source, /owner_operator_task_cards_v1/);
  assert.match(source, /task_cards_v1/);
  assert.match(source, /effectiveOperatorMembershipId/);
  assert.match(source, /operatorContext\?\.isOperating && !operatorMembershipId/);
  assert.match(source, /session\.memberships\.length === 1/);
  assert.match(source, /UUID_PATTERN\.test\(id\)/);
  assert.match(source, /readAtlasTaskMoveContexts\(\[id\]\)/);
  assert.match(source, /assembleTaskMove/);
  assert.doesNotMatch(source, /atlasSupabase|SUPABASE_SERVICE_ROLE_KEY|v_task_cards/);
});
