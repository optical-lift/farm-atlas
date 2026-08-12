import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assembleTaskMoveCore } from "../lib/atlas/task-move-assembly-core.js";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

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
      howLines: overrides.howLines ?? [],
      doneWhen: overrides.doneWhen ?? "The requested result is recorded.",
      details: null,
      dueLabel: "Today",
    },
    display: {
      action: overrides.action ?? "Do",
      subject: overrides.subject ?? task.title,
      location: overrides.placeText ?? "Elm Farm",
      route: overrides.route ?? "general",
    },
    dominion: {
      route: overrides.route ?? "general",
      instruction: overrides.doText ?? task.title,
      placeLabel: overrides.placeText ?? "Elm Farm",
      dueLabel: "Today",
      whyNow: "This move is active now.",
      stateEffect: "Atlas can release the next move.",
    },
    moveContext: overrides.moveContext ?? null,
  });
}

function requirement(result, kind, label) {
  return result.requirements.find((item) => item.kind === kind && item.label === label);
}

test("Snow in Summer keeps requirements parallel and stops the spine on unresolved capacity", () => {
  const result = assemble({
    task_id: "11111111-1111-4111-8111-111111111111",
    title: "Pot up · Snow in Summer",
    task_type: "propagation",
    status: "open",
    priority: "high",
    metadata: {
      current_truth: "720 Snow in Summer starts",
      after_truth: "720 starts potted · Under assigned lights",
      capacity_requirements: [{ label: "4 lit tray positions", required_quantity: 4, unit: "position" }],
    },
    resource_requirements: [
      {
        requirement_id: "tray-200",
        requirement_role: "container",
        quantity_needed: 3,
        unit: "tray",
        status: "ready",
        resource_key: "tray_200_cell",
        resource_label: "3 × 200-cell trays",
        resource_type: "container",
        resource_category: "tray",
        resource_status: "available",
        resource_quantity: 3,
        resource_unit: "tray",
        restock_needed: false,
      },
      {
        requirement_id: "tray-120",
        requirement_role: "container",
        quantity_needed: 1,
        unit: "tray",
        status: "ready",
        resource_key: "tray_120_cell",
        resource_label: "1 × 120-cell tray",
        resource_type: "container",
        resource_category: "tray",
        resource_status: "available",
        resource_quantity: 1,
        resource_unit: "tray",
        restock_needed: false,
      },
      {
        requirement_id: "potting-mix",
        requirement_role: "medium",
        quantity_needed: null,
        unit: null,
        status: "ready",
        resource_key: "potting_mix",
        resource_label: "Potting mix",
        resource_type: "growing_medium",
        resource_category: "growing_medium",
        resource_status: "available",
        resource_quantity: null,
        resource_unit: null,
        restock_needed: false,
      },
    ],
  }, {
    action: "Pot up",
    subject: "Snow in Summer",
    placeText: "Grow Room",
    route: "propagation",
  });

  assert.equal(result.version, 2);
  assert.equal(result.spine.current[0].label, "720 Snow in Summer starts");
  assert.equal(result.spine.move.action.label, "Pot up");
  assert.equal(result.spine.move.subject.label, "Snow in Summer");
  assert.equal(result.spine.after[0].label, "720 starts potted · Under assigned lights");
  assert.equal(requirement(result, "container", "3 × 200-cell trays").status, "resolved");
  assert.equal(requirement(result, "medium", "Potting mix").status, "resolved");
  assert.equal(requirement(result, "capacity", "4 lit tray positions").status, "blocked");
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.readiness.executable, false);
  assert.equal(result.spine.connection, "stops_at_move");
  assert.equal(result.spine.after[0].status, "resolved");
});

test("mowing stays simple: mower and height are branches, not extra transition stages", () => {
  const result = assemble({
    task_id: "22222222-2222-4222-8222-222222222222",
    title: "Mow · Field Rows Back Half",
    task_type: "mowing",
    status: "open",
    priority: "normal",
    metadata: {
      current_truth: "Back Half due for mowing",
      after_truth: "Whole route cut to 4 inches",
      method_constraints: ["4-inch target"],
    },
    resource_requirements: [{
      requirement_id: "mower",
      requirement_role: "equipment",
      status: "ready",
      resource_key: "riding_mower",
      resource_label: "Riding mower",
      resource_type: "equipment",
      resource_category: "mower",
      resource_status: "available",
      resource_quantity: 1,
      restock_needed: false,
    }],
  }, {
    action: "Mow",
    subject: "Field Rows Back Half",
    placeText: "Field Rows Back Half",
    route: "mow",
  });

  assert.equal(result.spine.connection, "continuous");
  assert.equal(result.readiness.status, "ready");
  assert.equal(result.requirements.length, 2);
  assert.equal(requirement(result, "resource", "Riding mower").status, "resolved");
  assert.equal(requirement(result, "method", "4-inch target").status, "resolved");
});

test("weeding uses linked bed truth to ground the move without converting the bed into a requirement", () => {
  const result = assemble({
    task_id: "33333333-3333-4333-8333-333333333333",
    title: "Weed · MG10",
    task_type: "maintenance",
    status: "open",
    priority: "high",
    metadata: { after_truth: "MG10 cleared to the weed target" },
    objects: [{
      object_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      object_key: "mg10",
      object_label: "MG10",
      object_type: "bed",
      object_mode: "maintenance",
      life_status: "established",
      state_metadata: { current_state: "MG10 has active weed pressure" },
    }],
  }, {
    action: "Weed",
    subject: "MG10",
    placeText: "Main Garden · MG10",
    route: "weed",
  });

  assert.equal(result.spine.current[0].provenance, "task_object");
  assert.equal(result.spine.current[0].label, "MG10 has active weed pressure");
  assert.equal(result.linkedObjects[0].label, "MG10");
  assert.equal(result.requirements.length, 0);
  assert.equal(result.readiness.status, "ready");
});

test("transplant readiness keeps destination and prerequisite attached to MOVE", () => {
  const result = assemble({
    task_id: "44444444-4444-4444-8444-444444444444",
    title: "Transplant · White snaps",
    task_type: "transplant_readiness",
    status: "open",
    priority: "high",
    metadata: {
      current_truth: "White snaps are hardened and ready to leave propagation",
      after_truth: "White snaps planted in Barn Bed 3",
      destination_object_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
    objects: [{
      object_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      object_key: "bb3",
      object_label: "Barn Bed 3",
      object_type: "bed",
      object_mode: "production",
      life_status: "active",
    }],
  }, {
    action: "Transplant",
    subject: "White snaps",
    placeText: "Barn Bed 3",
    route: "plant",
    moveContext: {
      projects: [],
      unlocks: [],
      waitingOn: [{
        taskId: "prep-bed-3",
        title: "Prepare Barn Bed 3",
        status: "open",
        assigneeName: "Anna",
        requiredStatus: "done",
        holdMode: "blocking",
      }],
    },
  });

  assert.equal(requirement(result, "destination", "Barn Bed 3").provenance, "task_object");
  assert.equal(requirement(result, "prerequisite", "Prepare Barn Bed 3").status, "blocked");
  assert.equal(result.spine.connection, "stops_at_move");
});

test("outreach remains a normal state transition rather than being forced into field-work semantics", () => {
  const result = assemble({
    task_id: "55555555-5555-4555-8555-555555555555",
    title: "Call · The Table",
    task_type: "outreach",
    status: "open",
    priority: "normal",
    metadata: {
      current_truth: "The Table has not been offered Elm's weekly bud-vase package",
      after_truth: "The Table has a recorded yes, no, or follow-up state",
      move_requirements: [{ kind: "method", label: "Use the weekly bud-vase offer script", resolution: "resolved" }],
    },
  }, {
    action: "Call",
    subject: "The Table",
    placeText: "Phone",
    route: "general",
  });

  assert.equal(result.spine.move.action.label, "Call");
  assert.equal(result.spine.move.subject.label, "The Table");
  assert.equal(requirement(result, "method", "Use the weekly bud-vase offer script").status, "resolved");
  assert.equal(result.readiness.status, "ready");
});

test("Finish Elm project hierarchy stays context while blocking work remains a requirement branch", () => {
  const result = assemble({
    task_id: "66666666-6666-4666-8666-666666666666",
    title: "Finish · Cedar preservation",
    task_type: "project_task",
    status: "open",
    priority: "normal",
    metadata: {
      current_truth: "Clean cedar siding is exposed and untreated",
      after_truth: "Cedar siding has its selected preservation finish applied",
    },
  }, {
    action: "Finish",
    subject: "Cedar preservation",
    placeText: "Elm exterior",
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
        taskId: "choose-finish",
        title: "Choose cedar preservation finish",
        status: "open",
        assigneeName: "Owner",
        requiredStatus: "done",
        holdMode: "blocking",
      }],
      unlocks: [],
    },
  });

  assert.equal(result.context.projects[0].title, "Finish Elm");
  assert.equal(result.requirements.some((item) => item.label === "Finish Elm"), false);
  assert.equal(requirement(result, "prerequisite", "Choose cedar preservation finish").status, "blocked");
  assert.equal(result.readiness.status, "blocked");
});

test("contract prevents UI from treating branch array order as a sequence", () => {
  const contract = read("docs/architecture/task-move-assembly-contract.md");
  const adapter = read("lib/atlas/task-move-assembly.ts");
  const resolver = read("lib/atlas/task-move-resolver.ts");

  assert.match(contract, /Branch ordering has no temporal meaning/);
  assert.match(contract, /target AFTER state is \*\*not erased\*\*/);
  assert.match(adapter, /The spine is the state transition/);
  assert.match(adapter, /Requirements remain independent branches/);
  assert.match(adapter, /presentation describes how a human should read the particular operation/);
  assert.match(adapter, /atlasTaskDisplay\(task\)/);
  assert.match(resolver, /resolveTaskMove/);
  assert.match(resolver, /owner_operator_task_cards_v1/);
  assert.match(resolver, /task_cards_v1/);
  assert.doesNotMatch(resolver, /SUPABASE_SERVICE_ROLE_KEY/);
});
