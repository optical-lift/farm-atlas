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

test("weed work assembles into the canonical what/where/how/done shape", () => {
  const result = assemble({
    task_id: "weed-mg10",
    title: "Weed MG10",
    task_type: "weeding",
    status: "open",
    priority: "normal",
    due_date: "2026-08-10",
    work_class: "maintenance",
    updated_at: "2026-08-10T14:00:00Z",
  }, {
    route: "weed",
    doText: "Weed · MG10",
    placeText: "Main Garden · MG10",
    howLines: ["Clear the assigned bed."],
    doneWhen: "The assigned area is cleared to the task target.",
  });

  assert.equal(result.version, 1);
  assert.equal(result.task.taskType, "weeding");
  assert.equal(result.task.route, "weed");
  assert.equal(result.move.what, "Weed · MG10");
  assert.equal(result.move.where, "Main Garden · MG10");
  assert.deepEqual(result.move.how, ["Clear the assigned bed."]);
  assert.equal(result.move.doneWhen, "The assigned area is cleared to the task target.");
});

test("crop-cycle checks keep their real task type and biological reason", () => {
  const result = assemble({
    task_id: "germination-check-1",
    title: "Check germination · ProCut Orange",
    task_type: "germination_check",
    status: "open",
    priority: "normal",
    due_date: "2026-08-10",
  }, {
    route: "crop_cycle",
    whyNow: "The crop cycle has reached its germination observation gate.",
    stateEffect: "Atlas can release the next crop move from the observed state.",
  });

  assert.equal(result.task.taskType, "germination_check");
  assert.equal(result.task.route, "crop_cycle");
  assert.match(result.context.whyNow, /germination observation gate/);
  assert.match(result.context.stateEffect, /next crop move/);
});

test("project work carries its project path without becoming a second task system", () => {
  const result = assemble({
    task_id: "finish-elm-window-1",
    title: "Clean Exterior Windows + Glass Doors",
    task_type: "project_task",
    status: "open",
    priority: "normal",
    due_date: null,
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

  assert.equal(result.task.taskType, "project_task");
  assert.equal(result.context.projects[0].title, "Finish Elm");
  assert.equal(result.context.projects[0].path[0].title, "Venue Finish Line");
});

test("grow-room care can carry dependency context in the same assembly", () => {
  const result = assemble({
    task_id: "grow-room-care-1",
    title: "Grow Room Care",
    task_type: "grow_room_care",
    status: "open",
    priority: "normal",
    due_date: "2026-08-10",
  }, {
    route: "propagation",
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
  assert.equal(result.context.waitingOn[0].taskId, "watering-check-1");
  assert.equal(result.context.unlocks[0].taskId, "transplant-ready-1");
});

test("the TypeScript adapter reuses Atlas execution and dominion instead of duplicating them", () => {
  const source = read("lib/atlas/task-move-assembly.ts");
  assert.match(source, /taskExecutionModel\(task\)/);
  assert.match(source, /taskDominionModel\(task, null\)/);
  assert.match(source, /task\.move_context/);
  assert.match(source, /export type TaskMoveAssembly/);
});

test("the server resolver uses Atlas membership-scoped card readers plus move context", () => {
  const source = read("lib/atlas/task-move-resolver.ts");
  assert.match(source, /createAtlasServerClient/);
  assert.match(source, /owner_operator_task_cards_v1/);
  assert.match(source, /task_cards_v1/);
  assert.match(source, /effectiveOperatorMembershipId/);
  assert.match(source, /getAtlasSession/);
  assert.match(source, /readAtlasTaskMoveContexts\(\[id\]\)/);
  assert.match(source, /assembleTaskMove/);
  assert.doesNotMatch(source, /atlasSupabase|SUPABASE_SERVICE_ROLE_KEY|v_task_cards/);
});
