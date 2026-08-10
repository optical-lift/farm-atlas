import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assembleTaskMoveCore } from "../lib/atlas/task-move-assembly-core.js";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

function snowInSummerAssembly() {
  return assembleTaskMoveCore({
    task: {
      task_id: "458ab3a9-6cae-457d-8bf2-ae718a9c3a5e",
      title: "Pot up · Snow in Summer",
      task_type: "pot_up",
      status: "open",
      priority: "high",
      metadata: {
        current_truth: "720 Snow in Summer starts are ready for pot-up.",
        after_truth: "720 Snow in Summer starts are potted up for continued growth.",
      },
      objects: [],
      resource_requirements: [
        {
          requirement_id: "tray-200",
          requirement_role: "required",
          move_role: "container",
          quantity_needed: 3,
          unit: "trays",
          status: "needs_check",
          resource_key: "pot_up_tray_200_cell",
          resource_label: "200-Cell Pot-Up Tray",
          resource_type: "container",
          resource_category: "container",
          resource_status: "unknown",
          resource_quantity: null,
          resource_unit: "trays",
          restock_needed: false,
        },
        {
          requirement_id: "tray-120",
          requirement_role: "required",
          move_role: "container",
          quantity_needed: 1,
          unit: "tray",
          status: "needs_check",
          resource_key: "pot_up_tray_120_cell",
          resource_label: "120-Cell Pot-Up Tray",
          resource_type: "container",
          resource_category: "container",
          resource_status: "unknown",
          resource_quantity: null,
          resource_unit: "trays",
          restock_needed: false,
        },
        {
          requirement_id: "potting-mix",
          requirement_role: "required",
          move_role: "growing_medium",
          quantity_needed: null,
          unit: null,
          status: "needs_check",
          resource_key: "potting_mix",
          resource_label: "Potting Mix",
          resource_type: "soil_amendment",
          resource_category: "growing_medium",
          resource_status: "unknown",
          resource_quantity: null,
          resource_unit: null,
          restock_needed: false,
        },
      ],
      action_templates: [{
        template_id: "pot-up-template",
        template_key: "pot_up",
        template_label: "Pot up",
        action_type: "pot_up",
        required_resource_categories: ["container", "growing_medium"],
        optional_resource_categories: ["water"],
        required_resource_keys: [],
        optional_resource_keys: [],
        creates_follow_up_task_types: [],
        hard_parts: [],
        unlocks: [],
        card_language: "Confirm containers and growing medium; destination capacity is resolved separately.",
      }],
    },
    execution: {
      doText: "Pot up · Snow in Summer",
      placeText: "Grow Room",
      howLines: [],
      doneWhen: "All 720 starts are potted up.",
      details: null,
      dueLabel: "Today",
    },
    display: {
      action: "Pot up",
      subject: "Snow in Summer",
      location: "Grow Room",
      route: "propagation",
    },
    dominion: {
      route: "propagation",
      instruction: "Pot up · Snow in Summer",
      placeLabel: "Grow Room",
      dueLabel: "Today",
      whyNow: null,
      stateEffect: null,
    },
    moveContext: null,
  });
}

test("Snow in Summer resolves real container and medium branches without inventing a duplicate missing category", () => {
  const result = snowInSummerAssembly();

  assert.equal(result.version, 2);
  assert.equal(result.requirements.length, 3);
  assert.equal(result.requirements.filter((item) => item.kind === "container").length, 2);
  assert.equal(result.requirements.filter((item) => item.kind === "medium").length, 1);
  assert.equal(result.requirements.some((item) => item.provenance === "action_template"), false);
  assert.equal(result.requirements.find((item) => item.label === "200-Cell Pot-Up Tray").quantity, 3);
  assert.equal(result.requirements.find((item) => item.label === "120-Cell Pot-Up Tray").quantity, 1);
  assert.equal(result.requirements.find((item) => item.label === "Potting Mix").status, "warning");
  assert.equal(result.readiness.status, "warning");
  assert.equal(result.readiness.executable, true);
  assert.equal(result.spine.connection, "continuous");
});

test("Pass 2 records physical resource role separately from obligation semantics", () => {
  const migration = read("supabase/migrations/20260810184239_task_move_resource_roles_and_snow_in_summer_requirements_v1.sql");
  const client = read("lib/atlas/task-cards-client.ts");

  assert.match(migration, /add column if not exists move_role text/i);
  assert.match(migration, /'required', 'container', 3::numeric/);
  assert.match(migration, /'required', 'container', 1::numeric/);
  assert.match(migration, /'required', 'growing_medium'/);
  assert.match(migration, /'move_role', trr\.move_role/);
  assert.match(client, /move_role: string \| null/);
});

test("Pass 2 keeps destination light capacity out of the resource requirement template", () => {
  const migration = read("supabase/migrations/20260810184239_task_move_resource_roles_and_snow_in_summer_requirements_v1.sql");
  assert.match(migration, /destination capacity is resolved separately/i);
  assert.doesNotMatch(migration, /grow_light_sets/);
});

test("container category alignment lets the v2 Task Move template recognize the actual tray requirements", () => {
  const migration = read("supabase/migrations/20260810184911_task_move_container_category_alignment_v1.sql");
  assert.match(migration, /resource_category = 'container'/);
  assert.match(migration, /pot_up_tray_200_cell/);
  assert.match(migration, /pot_up_tray_120_cell/);
});
