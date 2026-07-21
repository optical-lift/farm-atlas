import assert from "node:assert/strict";
import test from "node:test";

import { buildFarmOperationalState } from "../lib/atlas/operational-state-core.js";

const rows = [
  {
    farm_id: "farm-elm",
    farm_key: "elm_farm",
    farm_name: "Elm Farm",
    zone_id: "zone-field",
    zone_key: "field_rows",
    zone_label: "Field Rows",
    zone_sort_order: 1,
    object_id: "fr-1",
    object_key: "fr1",
    object_label: "Field Row 1",
    object_type: "bed",
    object_mode: "annual_production",
    object_sort_order: 1,
    length_ft: 30,
    width_ft: 3,
    area_sqft: 90,
    guest_visible: false,
    life_status: "planted",
    weed_pressure: "medium",
    water_status: "okay",
    presentability: "working",
    decision_required: false,
    harvest_confidence: "medium",
    last_action_date: "2026-07-19",
    last_action_label: "Checked",
    current_crop_cycle_id: "cycle-1",
    crop_cycle_key: "fr1-zinnia-2026",
    crop_label: "Zinnia",
    variety: "Giant",
    crop_stage: "growing",
    crop_lifecycle_status: "active",
    planted_date: "2026-06-07",
    expected_harvest_watch_start: "2026-08-10",
    expected_harvest_watch_end: "2026-08-20",
    current_stage: "growing",
    next_task_id: "task-1",
    next_action: "Weed Field Row 1",
    next_task_status: "open",
    next_action_due: "2026-07-21",
    next_work_class: "maintenance",
    next_task_visibility: "assigned_worker",
    assigned_membership_id: "membership-anna",
    blocker: null,
    maintenance_due_count: 1,
    next_maintenance_due: "2026-07-20",
    max_maintenance_priority: 80,
    max_maintenance_risk: 65,
    next_action_source: "task",
    risk_level: "medium",
  },
  {
    farm_id: "farm-elm",
    farm_key: "elm_farm",
    farm_name: "Elm Farm",
    zone_id: "zone-field",
    zone_key: "field_rows",
    zone_label: "Field Rows",
    zone_sort_order: 1,
    object_id: "fr-7",
    object_key: "fr7",
    object_label: "Field Row 7",
    object_type: "bed",
    object_sort_order: 7,
    life_status: "open",
    decision_required: true,
    next_action_source: "none",
    blocker: "Decision required",
    maintenance_due_count: 0,
    risk_level: "critical",
  },
  {
    farm_id: "farm-elm",
    farm_key: "elm_farm",
    farm_name: "Elm Farm",
    zone_id: "zone-main",
    zone_key: "main_garden",
    zone_label: "Main Garden",
    zone_sort_order: 2,
    object_id: "mg-1",
    object_key: "mg1",
    object_label: "Main Garden Bed 1",
    object_type: "bed",
    object_sort_order: 1,
    life_status: "open",
    next_maintenance_type: "weed",
    next_maintenance_condition: "heavy",
    next_maintenance_date: "2026-07-20",
    maintenance_due_count: 2,
    next_maintenance_due: "2026-07-20",
    max_maintenance_priority: 90,
    max_maintenance_risk: 82,
    next_action_source: "maintenance",
    risk_level: "high",
  },
];

test("groups canonical object state by farm and zone", () => {
  const state = buildFarmOperationalState(rows);

  assert.deepEqual(state.farm, {
    id: "farm-elm",
    key: "elm_farm",
    name: "Elm Farm",
  });
  assert.equal(state.counts.zones, 2);
  assert.equal(state.counts.objects, 3);
  assert.equal(state.counts.cropped, 1);
  assert.equal(state.counts.critical, 1);
  assert.equal(state.counts.high, 1);
  assert.equal(state.counts.maintenanceDue, 3);
  assert.equal(state.zones[0].key, "field_rows");
  assert.equal(state.zones[0].objects[0].crop.label, "Zinnia");
  assert.equal(state.zones[0].objects[0].nextAction.assignedMembershipId, "membership-anna");
});

test("uses maintenance as the next action when no task exists", () => {
  const state = buildFarmOperationalState(rows);
  const mainGarden = state.zones.find((zone) => zone.key === "main_garden");
  const object = mainGarden.objects[0];

  assert.equal(object.nextAction.source, "maintenance");
  assert.equal(object.nextAction.label, "Maintain weed");
  assert.equal(object.nextAction.maintenanceCondition, "heavy");
  assert.equal(object.riskLevel, "high");
});

test("keeps undecided empty objects visible as critical farm state", () => {
  const state = buildFarmOperationalState(rows);
  const fieldRows = state.zones.find((zone) => zone.key === "field_rows");
  const undecided = fieldRows.objects.find((object) => object.key === "fr7");

  assert.equal(undecided.crop, null);
  assert.equal(undecided.state.decisionRequired, true);
  assert.equal(undecided.nextAction.blocker, "Decision required");
  assert.equal(undecided.riskLevel, "critical");
});
