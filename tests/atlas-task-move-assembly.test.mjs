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
    task: {
      objects: [],
      resource_requirements: [],
      action_templates: [],
      metadata: {},
      ...task,
    },
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

test("one assembly keeps task identity, execution, farm objects, and readiness together", () => {
  const result = assemble({
    task_id: "21a075bd-3dd1-4ee5-b02c-a4278c9c441b",
    title: "Weed MG10",
    task_type: "maintenance",
    status: "open",
    priority: "high",
    due_date: "2026-08-07",
    work_class: "heavy",
    objects: [{
      object_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      object_key: "mg10",
      object_label: "MG10",
      object_type: "bed",
      object_mode: "maintenance",
      life_status: "established",
    }],
  }, {
    route: "weed",
    doText: "Weed · MG10",
    placeText: "Main Garden · MG10",
    howLines: ["Clear the assigned bed."],
    doneWhen: "The assigned area is cleared to the task target.",
  });

  assert.equal(result.version, 1);
  assert.equal(result.task.taskType, "maintenance");
  assert.equal(result.task.route, "weed");
  assert.equal(result.execution.what, "Weed · MG10");
  assert.equal(result.execution.where, "Main Garden · MG10");
  assert.equal(result.linkedObjects[0].label, "MG10");
  assert.equal(result.linkedObjects[0].source, "task_object");
  assert.equal(result.readiness.status, "ready");
});

test("actual task resource requirements are first-class assembly branches", () => {
  const result = assemble({
    task_id: "11111111-1111-4111-8111-111111111111",
    title: "Pot up · Snow in Summer",
    task_type: "propagation",
    status: "open",
    priority: "high",
    resource_requirements: [{
      requirement_id: "tray-requirement",
      requirement_role: "container",
      requirement_source: "owner",
      quantity_needed: 3,
      unit: "tray",
      status: "ready",
      note: null,
      resource_key: "tray_200_cell",
      resource_label: "200-cell tray",
      resource_type: "container",
      resource_category: "tray",
      resource_status: "available",
      resource_quantity: 5,
      resource_unit: "tray",
      condition_notes: null,
      restock_needed: false,
    }],
  }, {
    route: "propagation",
    placeText: "Grow Room",
  });

  assert.equal(result.requirements.resources.length, 1);
  assert.equal(result.requirements.resources[0].role, "container");
  assert.equal(result.requirements.resources[0].label, "200-cell tray");
  assert.equal(result.requirements.resources[0].quantityNeeded, 3);
  assert.equal(result.requirements.resources[0].source, "resource_requirement");
  assert.equal(result.requirements.resources[0].resolution, "resolved");
});

test("action templates surface required resources that have not been attached to the task", () => {
  const result = assemble({
    task_id: "22222222-2222-4222-8222-222222222222",
    title: "Pot up · Snow in Summer",
    task_type: "propagation",
    status: "open",
    priority: "high",
    action_templates: [{
      template_id: "pot-up-template",
      template_key: "pot_up",
      template_label: "Pot up",
      action_type: "pot_up",
      required_resource_categories: ["growing_medium", "tray"],
      optional_resource_categories: [],
      required_resource_keys: [],
      optional_resource_keys: [],
      creates_follow_up_task_types: [],
      hard_parts: [],
      unlocks: [],
      card_language: null,
    }],
    resource_requirements: [{
      requirement_id: "tray-requirement",
      requirement_role: "container",
      requirement_source: "owner",
      quantity_needed: 4,
      unit: "tray",
      status: "ready",
      note: null,
      resource_key: "tray_200_cell",
      resource_label: "200-cell tray",
      resource_type: "container",
      resource_category: "tray",
      resource_status: "available",
      resource_quantity: 4,
      resource_unit: "tray",
      condition_notes: null,
      restock_needed: false,
    }],
  }, {
    route: "propagation",
    placeText: "Grow Room",
  });

  assert.equal(result.requirements.expected.length, 1);
  assert.equal(result.requirements.expected[0].key, "growing_medium");
  assert.equal(result.requirements.expected[0].source, "action_template");
  assert.equal(result.requirements.expected[0].resolution, "missing");
  assert.equal(result.readiness.status, "incomplete");
  assert.equal(result.unresolved[0].kind, "resource_requirement");
});

test("resource shortages and blockers remain truthful rather than disappearing into prose", () => {
  const result = assemble({
    task_id: "33333333-3333-4333-8333-333333333333",
    title: "Set bloom bar",
    task_type: "event_setup",
    status: "blocked",
    priority: "high",
    blocker_text: "Waiting for Thursday flower buckets",
    resource_requirements: [{
      requirement_id: "bucket-requirement",
      requirement_role: "container",
      requirement_source: "owner",
      quantity_needed: 12,
      unit: "bucket",
      status: "required",
      note: null,
      resource_key: "black_florist_bucket",
      resource_label: "Black florist bucket",
      resource_type: "container",
      resource_category: "bucket",
      resource_status: "available",
      resource_quantity: 7,
      resource_unit: "bucket",
      condition_notes: null,
      restock_needed: true,
    }],
  }, {
    route: "venue",
    placeText: "Dining Room",
  });

  assert.equal(result.requirements.resources[0].resolution, "warning");
  assert.equal(result.readiness.status, "blocked");
  assert.ok(result.unresolved.some((item) => item.kind === "blocker"));
  assert.ok(result.unresolved.some((item) => item.label === "Black florist bucket"));
});

test("project prerequisites stay separate from execution instructions", () => {
  const result = assemble({
    task_id: "44444444-4444-4444-8444-444444444444",
    title: "Set bloom bar",
    task_type: "event_setup",
    status: "open",
    priority: "high",
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
        path: [],
      }],
      waitingOn: [{
        taskId: "condition-flowers",
        title: "Condition Thursday flower buckets",
        status: "open",
        assigneeName: "Anna",
        requiredStatus: "done",
        holdMode: "blocking",
      }],
      unlocks: [],
    },
  });

  assert.equal(result.context.projects[0].title, "Finish Elm");
  assert.equal(result.requirements.prerequisites[0].title, "Condition Thursday flower buckets");
  assert.equal(result.requirements.prerequisites[0].source, "prerequisite");
  assert.equal(result.readiness.status, "blocked");
});

test("legacy execution metadata is visible as provenance rather than mistaken for canonical resource truth", () => {
  const result = assemble({
    task_id: "55555555-5555-4555-8555-555555555555",
    title: "Pot up · Snow in Summer",
    task_type: "propagation",
    status: "open",
    priority: "high",
    metadata: {
      execution_do: "Pot up · Snow in Summer",
      execution_place: "Grow Room",
      execution_how: ["Use the tray plan."],
      execution_done_when: "All starts are potted.",
      current_truth: "Snow in Summer is still in starter cells.",
      after_truth: "Snow in Summer is potted up and placed for continued growth.",
    },
  }, {
    route: "propagation",
    doText: "Pot up · Snow in Summer",
    placeText: "Grow Room",
    howLines: ["Use the tray plan."],
    doneWhen: "All starts are potted.",
  });

  assert.equal(result.transition.currentTruth, "Snow in Summer is still in starter cells.");
  assert.equal(result.transition.resultingTruth, "Snow in Summer is potted up and placed for continued growth.");
  assert.equal(result.execution.provenance.what, "legacy_metadata");
  assert.equal(result.execution.provenance.how, "legacy_metadata");
  assert.equal(result.requirements.resources.length, 0);
});

test("the TypeScript adapter converges existing execution and context layers instead of creating another task model", () => {
  const source = read("lib/atlas/task-move-assembly.ts");
  assert.match(source, /taskExecutionModel\(task\)/);
  assert.match(source, /taskDominionModel\(task, null\)/);
  assert.match(source, /task\.move_context/);
  assert.match(source, /export type TaskMoveAssembly/);
  assert.match(source, /requirements:/);
  assert.match(source, /unresolved:/);
  assert.match(source, /readiness:/);
});

test("the server resolver stays inside Atlas viewer-scoped task-card boundaries", () => {
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
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|v_task_cards/);
});
